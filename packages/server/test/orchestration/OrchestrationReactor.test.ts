import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ProviderCommandReactor } from "../../src/orchestration/ProviderCommandReactor.service.ts";
import { ProviderRuntimeIngestionService } from "../../src/orchestration/ProviderRuntimeIngestion.service.ts";
import { OrchestrationReactor } from "../../src/orchestration/OrchestrationReactor.service.ts";
import { makeOrchestrationReactor } from "../../src/orchestration/OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("starts provider ingestion and provider command reactors", async () => {
    const started: string[] = [];

    runtime = ManagedRuntime.make(
      Layer.effect(OrchestrationReactor, makeOrchestrationReactor).pipe(
        Layer.provideMerge(
          Layer.succeed(ProviderRuntimeIngestionService, {
            start: () => {
              started.push("provider-runtime-ingestion");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderCommandReactor, {
            start: () => {
              started.push("provider-command-reactor");
              return Effect.void;
            },
            drain: Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(OrchestrationReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));

    expect(started).toEqual(["provider-runtime-ingestion", "provider-command-reactor"]);

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
