import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@honk/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

export interface ServerEnvironmentShape {
  readonly getEnvironmentId: Effect.Effect<EnvironmentId>;
  readonly getDescriptor: Effect.Effect<ExecutionEnvironmentDescriptor>;
  readonly markStartupReady: Effect.Effect<void>;
}

export class ServerEnvironment extends Context.Service<ServerEnvironment, ServerEnvironmentShape>()(
  "honk/environment/ServerEnvironment.service",
) {}
