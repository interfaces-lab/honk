import { Effect, Layer, Context } from "effect";

import { TextGeneration, type TextGenerationShape } from "./TextGeneration.service.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/ClaudeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const byInstanceId = {
    codex: yield* CodexTextGen,
    claudeAgent: yield* ClaudeTextGen,
  };
  const resolve = (instanceId: string): TextGenerationShape =>
    byInstanceId[instanceId as keyof typeof byInstanceId] ?? byInstanceId.codex;

  return {
    generateCommitMessage: (input) =>
      resolve(input.modelSelection.instanceId).generateCommitMessage(input),
    generatePrContent: (input) => resolve(input.modelSelection.instanceId).generatePrContent(input),
    generateBranchName: (input) =>
      resolve(input.modelSelection.instanceId).generateBranchName(input),
    generateThreadTitle: (input) =>
      resolve(input.modelSelection.instanceId).generateThreadTitle(input),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
);
