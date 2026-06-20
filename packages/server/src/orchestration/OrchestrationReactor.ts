import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "./OrchestrationReactor.service.ts";

export const makeOrchestrationReactor = Effect.sync(() => {
  const start: OrchestrationReactorShape["start"] = Effect.fn("start")(() => Effect.void);

  return {
    start,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
