import { type AmpSettings, type ProviderInstanceEnvironment } from "@multi/contracts";
import { Effect, Layer, Scope } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";

type AmpAcpRuntimeSettings = Pick<AmpSettings, "apiKey" | "binaryPath"> & {
  readonly environment?: ProviderInstanceEnvironment;
};

export interface AmpAcpRuntimeInput
  extends Omit<AcpSessionRuntimeOptions, "authMethodId" | "clientCapabilities" | "spawn"> {
  readonly ampSettings: AmpAcpRuntimeSettings | null | undefined;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
}

export function makeAmpProcessEnv(
  ampSettings: AmpAcpRuntimeSettings | null | undefined,
): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const variable of ampSettings?.environment ?? []) {
    const name = variable.name.trim();
    if (name.length === 0 || variable.valueRedacted === true) {
      continue;
    }
    env[name] = variable.value;
  }

  const apiKey = ampSettings?.apiKey.trim();
  if (apiKey) {
    env.AMP_API_KEY = apiKey;
  }

  return env;
}

export function buildAmpAcpSpawnInput(
  ampSettings: AmpAcpRuntimeSettings | null | undefined,
  cwd: string,
): AcpSpawnInput {
  const env = makeAmpProcessEnv(ampSettings);
  const hasEnv = Object.keys(env).length > 0;
  return {
    command: ampSettings?.binaryPath || "amp-acp",
    args: [],
    cwd,
    ...(hasEnv ? { env } : {}),
  };
}

const AMP_CLIENT_CAPABILITIES = {
  auth: {
    terminal: true,
  },
  fs: {
    readTextFile: false,
    writeTextFile: false,
  },
  terminal: false,
} satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

export const makeAmpAcpRuntime = (
  input: AmpAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildAmpAcpSpawnInput(input.ampSettings, input.cwd),
        authMethodId: "setup",
        clientCapabilities: AMP_CLIENT_CAPABILITIES,
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });
