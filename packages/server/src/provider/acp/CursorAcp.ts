import { type CursorSettings, type ProviderOptionSelection } from "@multi/contracts";
import { Effect, Layer, Scope } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import { CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES } from "../CursorProvider.ts";
import { resolveCursorAgentCliModelId } from "./CursorAcpModel.ts";
import {
  AcpRuntime,
  type AcpRuntimeOptions,
  type AcpRuntimeShape,
  type AcpSpawnInput,
} from "./AcpRuntime.ts";

type CursorAcpRuntimeCursorSettings = Pick<CursorSettings, "apiEndpoint" | "binaryPath">;

export interface CursorAcpRuntimeInput extends Omit<
  AcpRuntimeOptions,
  "authMethodId" | "clientCapabilities" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly spawnModel?: string | null | undefined;
  readonly spawnSelections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}

export function buildCursorAcpSpawnInput(
  cursorSettings: CursorAcpRuntimeCursorSettings | null | undefined,
  cwd: string,
  spawn?: {
    readonly model?: string | null | undefined;
    readonly selections?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
    readonly environment?: NodeJS.ProcessEnv | undefined;
  },
): AcpSpawnInput {
  const cliModel = spawn
    ? resolveCursorAgentCliModelId(spawn.model ?? null, spawn.selections)
    : undefined;
  return {
    command: cursorSettings?.binaryPath || "agent",
    args: [
      ...(cursorSettings?.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
      ...(cliModel ? (["--model", cliModel] as const) : []),
      "acp",
    ],
    cwd,
    ...(spawn?.environment !== undefined ? { env: spawn.environment } : {}),
  };
}

export const makeCursorAcpRuntime = (
  input: CursorAcpRuntimeInput,
): Effect.Effect<AcpRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpRuntime.layer({
        ...input,
        spawn: buildCursorAcpSpawnInput(input.cursorSettings, input.cwd, {
          model: input.spawnModel ?? null,
          selections: input.spawnSelections,
          ...(input.environment !== undefined ? { environment: input.environment } : {}),
        }),
        authMethodId: "cursor_login",
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpRuntime).pipe(Effect.provide(acpContext));
  });
