import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "./OrchestrationReactor.service.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(function* () {});

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
