import { Effect, Layer, Context } from "effect";

import { TextGeneration, type TextGenerationShape } from "./TextGeneration.service.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/CodexTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;

  return {
    generateCommitMessage: (input) => codex.generateCommitMessage(input),
    generatePrContent: (input) => codex.generatePrContent(input),
    generateBranchName: (input) => codex.generateBranchName(input),
    generateThreadTitle: (input) => codex.generateThreadTitle(input),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer));
