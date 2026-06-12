import type { OrchestrationMessageRichText } from "@honk/contracts";
import { Data, Effect, Schema } from "effect";

import type { ComposerImageAttachment } from "../../stores/chat-drafts";

const INLINE_COMPOSER_PLACEHOLDER = "\uFFFC";

export const ComposerFileEntity = Schema.Struct({
  type: Schema.Literal("file"),
  path: Schema.String,
  label: Schema.optional(Schema.String),
  lineStart: Schema.optional(Schema.Number),
  lineEnd: Schema.optional(Schema.Number),
});
export type ComposerFileEntity = typeof ComposerFileEntity.Type;

export const ComposerSkillEntity = Schema.Struct({
  type: Schema.Literal("skill"),
  id: Schema.String,
  label: Schema.optional(Schema.String),
  trigger: Schema.optional(Schema.Literals(["mention", "slash"])),
});
export type ComposerSkillEntity = typeof ComposerSkillEntity.Type;

export const ComposerEntity = Schema.Union([ComposerFileEntity, ComposerSkillEntity]);
export type ComposerEntity = typeof ComposerEntity.Type;

export const ComposerValue = Schema.Struct({
  text: Schema.String,
  entities: Schema.Array(ComposerEntity),
});
export type ComposerValue = typeof ComposerValue.Type;

export const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  "[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]";

export type ComposerSubmitContext = {
  prompt: string;
  richText?: OrchestrationMessageRichText | undefined;
  images: readonly ComposerImageAttachment[];
  hasUnresolvedSlashCommand?: boolean | undefined;
};

export type ComposerSubmitState = {
  trimmedPrompt: string;
  hasSendableContent: boolean;
};

export type OptimisticComposerAttachment = {
  type: "image";
  id: ComposerImageAttachment["id"];
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
};

export type PreparedComposerTurnAttachment = {
  type: "image";
  name: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
};

export type CompiledComposerSubmitTurn = ComposerSubmitState & {
  messageTextForSend: string;
  outgoingMessageText: string;
  outgoingRichText?: OrchestrationMessageRichText | undefined;
  optimisticAttachments: OptimisticComposerAttachment[];
  title: string;
};

export class ComposerSubmitReadFileError extends Data.TaggedError("ComposerSubmitReadFileError")<{
  message: string;
  cause: unknown;
}> {}

const decodeFileReaderDataUrl = Schema.decodeUnknownEffect(Schema.String);

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
}): ComposerSubmitState {
  const trimmedPrompt = stripInlineComposerPlaceholders(options.prompt).trim();
  return {
    trimmedPrompt,
    hasSendableContent: trimmedPrompt.length > 0 || options.imageCount > 0,
  };
}

export function compileComposerSubmitTurn(
  input: ComposerSubmitContext,
): CompiledComposerSubmitTurn {
  const sendState = deriveComposerSendState({
    prompt: input.prompt,
    imageCount: input.images.length,
  });
  const messageTextForSend = sendState.trimmedPrompt;
  const outgoingMessageText = messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT;

  return {
    ...sendState,
    messageTextForSend,
    outgoingMessageText,
    ...(outgoingMessageText === messageTextForSend && input.richText !== undefined
      ? { outgoingRichText: input.richText }
      : {}),
    optimisticAttachments: buildOptimisticImageAttachments(input.images),
    title: resolveComposerThreadTitle({
      trimmedPrompt: sendState.trimmedPrompt,
      composerImages: input.images,
    }),
  };
}

export function buildOptimisticImageAttachments(
  images: readonly ComposerImageAttachment[],
): OptimisticComposerAttachment[] {
  return images.map((image) => {
    const attachment: OptimisticComposerAttachment = {
      type: "image",
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      previewUrl: image.previewUrl,
    };
    return attachment;
  });
}

export function prepareComposerTurnAttachmentsEffect(
  images: readonly ComposerImageAttachment[],
): Effect.Effect<PreparedComposerTurnAttachment[], ComposerSubmitReadFileError> {
  return Effect.all(images.map(prepareComposerTurnAttachmentEffect));
}

export function prepareComposerTurnAttachments(
  images: readonly ComposerImageAttachment[],
): Promise<PreparedComposerTurnAttachment[]> {
  return Effect.runPromise(prepareComposerTurnAttachmentsEffect(images));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return Effect.runPromise(readFileAsDataUrlEffect(file));
}

function prepareComposerTurnAttachmentEffect(
  image: ComposerImageAttachment,
): Effect.Effect<PreparedComposerTurnAttachment, ComposerSubmitReadFileError> {
  return Effect.map(readFileAsDataUrlEffect(image.file), (dataUrl) => {
    const attachment: PreparedComposerTurnAttachment = {
      type: "image",
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl,
    };
    return attachment;
  });
}

function readFileAsDataUrlEffect(file: File): Effect.Effect<string, ComposerSubmitReadFileError> {
  return Effect.callback<string, ComposerSubmitReadFileError>((resume) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () => {
        resume(
          decodeFileReaderDataUrl(reader.result).pipe(
            Effect.mapError(
              (cause) =>
                new ComposerSubmitReadFileError({
                  message: "Could not read image data.",
                  cause,
                }),
            ),
          ),
        );
      },
      { once: true },
    );
    reader.addEventListener(
      "error",
      () => {
        resume(
          Effect.fail(
            new ComposerSubmitReadFileError({
              message: "Failed to read image.",
              cause: reader.error,
            }),
          ),
        );
      },
      { once: true },
    );
    reader.addEventListener(
      "abort",
      () => {
        resume(
          Effect.fail(
            new ComposerSubmitReadFileError({
              message: "Image read was aborted.",
              cause: file,
            }),
          ),
        );
      },
      { once: true },
    );
    reader.readAsDataURL(file);

    return Effect.sync(() => {
      if (reader.readyState === FileReader.LOADING) {
        reader.abort();
      }
    });
  });
}

const THREAD_TITLE_MAX_LENGTH = 50;

export function resolveComposerThreadTitle(input: {
  trimmedPrompt: string;
  composerImages: readonly ComposerImageAttachment[];
}): string {
  const seed = resolveComposerThreadTitleSeed(input);
  return trimThreadTitle(seed);
}

function resolveComposerThreadTitleSeed(input: {
  trimmedPrompt: string;
  composerImages: readonly ComposerImageAttachment[];
}): string {
  if (input.trimmedPrompt) return input.trimmedPrompt;

  const firstComposerImage = input.composerImages[0];
  if (firstComposerImage) {
    return `Image: ${firstComposerImage.name}`;
  }

  return "New thread";
}

function trimThreadTitle(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= THREAD_TITLE_MAX_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, THREAD_TITLE_MAX_LENGTH)}...`;
}

function stripInlineComposerPlaceholders(prompt: string): string {
  return prompt.replaceAll(INLINE_COMPOSER_PLACEHOLDER, "");
}
