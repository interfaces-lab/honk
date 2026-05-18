import { Effect, Layer, Option, Ref, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  TextGenerationError,
  type ChatAttachment,
  type ModelSelection,
} from "@multi/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@multi/shared/git";

import { resolveAttachmentPath } from "../attachment-store.ts";
import { ServerConfig } from "../config.ts";
import { makeAmpAcpRuntime } from "../provider/acp/AmpAcpSupport.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { resolveAmpSettings } from "../provider/provider-settings.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./Prompts.ts";
import { type TextGenerationShape, TextGeneration } from "./TextGeneration.service.ts";
import {
  extractJsonObject,
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "./Utils.ts";
import { FileSystem } from "effect";

const AMP_TIMEOUT_MS = 180_000;

type AmpTextGenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

function mapAmpAcpError(
  operation: AmpTextGenerationOperation,
  detail: string,
  cause: unknown,
): TextGenerationError {
  return new TextGenerationError({
    operation,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });
}

function isTextGenerationError(error: unknown): error is TextGenerationError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "TextGenerationError"
  );
}

function denyPermissionRequest(
  request: EffectAcpSchema.RequestPermissionRequest,
): EffectAcpSchema.RequestPermissionResponse {
  const rejectOption =
    request.options.find((option) => option.kind === "reject_always") ??
    request.options.find((option) => option.kind === "reject_once");
  if (rejectOption?.optionId) {
    return {
      outcome: {
        outcome: "selected",
        optionId: rejectOption.optionId,
      },
    };
  }
  return {
    outcome: {
      outcome: "cancelled",
    },
  };
}

const makeAmpTextGeneration = Effect.gen(function* () {
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfig = yield* ServerConfig;
  const serverSettingsService = yield* ServerSettingsService;

  const buildPromptParts = Effect.fn("AmpTextGeneration.buildPromptParts")(function* (input: {
    readonly operation: AmpTextGenerationOperation;
    readonly prompt: string;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) {
    const promptParts: Array<EffectAcpSchema.ContentBlock> = [
      {
        type: "text",
        text: input.prompt,
      },
    ];
    for (const attachment of input.attachments ?? []) {
      const attachmentPath = resolveAttachmentPath({
        attachmentsDir: serverConfig.attachmentsDir,
        attachment,
      });
      if (!attachmentPath) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: `Invalid attachment id '${attachment.id}'.`,
        });
      }
      const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: cause.message,
              cause,
            }),
        ),
      );
      promptParts.push({
        type: "image",
        data: Buffer.from(bytes).toString("base64"),
        mimeType: attachment.mimeType,
      });
    }
    return promptParts;
  });

  const runAmpJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    modelSelection,
    attachments,
  }: {
    readonly operation: AmpTextGenerationOperation;
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly modelSelection: ModelSelection;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const ampSettings = yield* Effect.map(serverSettingsService.getSettings, (settings) =>
        resolveAmpSettings(settings, modelSelection.instanceId),
      ).pipe(
        Effect.orElseSucceed(() => ({
          enabled: true,
          binaryPath: "amp-acp",
          apiKey: "",
          environment: [],
        })),
      );

      const outputRef = yield* Ref.make("");
      const runtime = yield* makeAmpAcpRuntime({
        ampSettings,
        childProcessSpawner,
        cwd,
        clientInfo: { name: "multi-git-text", version: "0.0.0" },
      });

      yield* runtime.handleRequestPermission((request) => Effect.succeed(denyPermissionRequest(request)));
      yield* Stream.runForEach(runtime.getEvents(), (event) =>
        event._tag === "ContentDelta"
          ? Ref.update(outputRef, (current) => current + event.text)
          : Effect.void,
      ).pipe(Effect.forkScoped);

      const promptParts = yield* buildPromptParts({
        operation,
        prompt,
        attachments,
      });

      const promptResult = yield* Effect.gen(function* () {
        yield* runtime.start();
        return yield* runtime.prompt({
          prompt: promptParts,
        });
      }).pipe(
        Effect.timeoutOption(AMP_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation,
                  detail: "Amp ACP request timed out.",
                }),
              ),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : mapAmpAcpError(operation, "Amp ACP request failed.", cause),
        ),
      );

      const rawResult = (yield* Ref.get(outputRef)).trim();
      if (!rawResult) {
        return yield* new TextGenerationError({
          operation,
          detail:
            promptResult.stopReason === "cancelled"
              ? "Amp ACP request was cancelled."
              : "Amp returned empty output.",
        });
      }

      return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(
        extractJsonObject(rawResult),
      ).pipe(
        Effect.catchTag("SchemaError", (cause) =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "Amp returned invalid structured output.",
              cause,
            }),
          ),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : mapAmpAcpError(operation, "Amp ACP text generation failed.", cause),
      ),
      Effect.scoped,
    );

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "AmpTextGeneration.generateCommitMessage",
  )(function* (input) {
    if (input.modelSelection.instanceId !== "amp") {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runAmpJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "AmpTextGeneration.generatePrContent",
  )(function* (input) {
    if (input.modelSelection.instanceId !== "amp") {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });
    const generated = yield* runAmpJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "AmpTextGeneration.generateBranchName",
  )(function* (input) {
    if (input.modelSelection.instanceId !== "amp") {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runAmpJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "AmpTextGeneration.generateThreadTitle",
  )(function* (input) {
    if (input.modelSelection.instanceId !== "amp") {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runAmpJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});

export const AmpTextGenerationLive = Layer.effect(TextGeneration, makeAmpTextGeneration);
