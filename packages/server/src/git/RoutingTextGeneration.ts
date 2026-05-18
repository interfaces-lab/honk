/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider instance in each
 * request input.
 *
 * When `modelSelection.instanceId` is `"claudeAgent"` the request is forwarded to
 * the Claude layer; for any other value (including the default `undefined`) it
 * falls through to the Codex layer.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";

import { TextGeneration, type TextGenerationShape } from "./TextGeneration.service.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { AmpTextGenerationLive } from "./AmpTextGeneration.ts";
import { CursorTextGenerationLive } from "./CursorTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "./OpenCodeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/ClaudeTextGen",
) {}

class AmpTextGen extends Context.Service<AmpTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/AmpTextGen",
) {}

class CursorTextGen extends Context.Service<CursorTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/CursorTextGen",
) {}

class OpenCodeTextGen extends Context.Service<OpenCodeTextGen, TextGenerationShape>()(
  "t3/git/RoutingTextGeneration/OpenCodeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const byInstanceId = {
    codex: yield* CodexTextGen,
    claudeAgent: yield* ClaudeTextGen,
    amp: yield* AmpTextGen,
    cursor: yield* CursorTextGen,
    opencode: yield* OpenCodeTextGen,
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

const InternalAmpLayer = Layer.effect(
  AmpTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(AmpTextGenerationLive));

const InternalCursorLayer = Layer.effect(
  CursorTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CursorTextGenerationLive));

const InternalOpenCodeLayer = Layer.effect(
  OpenCodeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(OpenCodeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
  Layer.provide(InternalAmpLayer),
  Layer.provide(InternalCursorLayer),
  Layer.provide(InternalOpenCodeLayer),
);
