import {
  attachEnvironmentDescriptor,
  createKnownEnvironment,
  type KnownEnvironment,
} from "~/lib/environment-scope";
import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@honk/shared/environment";
import { EnvironmentId as EnvironmentIdSchema } from "@honk/shared/environment";
import { create } from "zustand";

import { BootstrapHttpError, retryTransientBootstrap } from "./auth";

import {
  readDesktopLocalEnvironmentBootstrap,
  readPrimaryEnvironmentTarget,
  resolvePrimaryEnvironmentHttpUrl,
} from "./target";
import { useStore } from "~/stores/thread-store";

const PRIMARY_CORE_ENVIRONMENT_ID = EnvironmentIdSchema.make("core");

interface PrimaryEnvironmentBootstrapState {
  readonly descriptor: ExecutionEnvironmentDescriptor | null;
  readonly setDescriptor: (descriptor: ExecutionEnvironmentDescriptor | null) => void;
  readonly reset: () => void;
}

const usePrimaryEnvironmentBootstrapStore = create<PrimaryEnvironmentBootstrapState>()((set) => ({
  descriptor: null,
  setDescriptor: (descriptor) => set({ descriptor }),
  reset: () => set({ descriptor: null }),
}));

let primaryEnvironmentDescriptorPromise: Promise<ExecutionEnvironmentDescriptor> | null = null;

function createPrimaryKnownEnvironment(input: {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
}): KnownEnvironment | null {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (!descriptor) {
    return null;
  }

  return attachEnvironmentDescriptor(
    createKnownEnvironment({
      id: descriptor.environmentId,
      label: descriptor.label,
      source: input.source,
      target: input.target,
    }),
    descriptor,
  );
}

async function fetchPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/core/v1/health"));
    if (!response.ok) {
      throw new BootstrapHttpError({
        message: `Failed to load core health (${response.status}).`,
        status: response.status,
      });
    }

    const health = (await response.json()) as { readonly version?: unknown };
    const descriptor: ExecutionEnvironmentDescriptor = {
      environmentId: PRIMARY_CORE_ENVIRONMENT_ID,
      label: readDesktopLocalEnvironmentBootstrap()?.label ?? "Core",
      platform: {
        os: "unknown",
        arch: "other",
      },
      serverVersion: typeof health.version === "string" ? health.version : "unknown",
      capabilities: {
        repositoryIdentity: false,
      },
      startupStatus: "ready",
    };
    writePrimaryEnvironmentDescriptor(descriptor);
    return descriptor;
  });
}

export function readPrimaryEnvironmentDescriptor(): ExecutionEnvironmentDescriptor | null {
  return usePrimaryEnvironmentBootstrapStore.getState().descriptor;
}

export function usePrimaryEnvironmentId(): EnvironmentId | null {
  return usePrimaryEnvironmentBootstrapStore((state) => state.descriptor?.environmentId ?? null);
}

export function writePrimaryEnvironmentDescriptor(
  descriptor: ExecutionEnvironmentDescriptor | null,
): void {
  usePrimaryEnvironmentBootstrapStore.getState().setDescriptor(descriptor);
  if (descriptor) {
    useStore.getState().setActiveEnvironmentId(descriptor.environmentId);
  }
}

export function getPrimaryKnownEnvironment(): KnownEnvironment | null {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    return null;
  }

  return createPrimaryKnownEnvironment({
    source: primaryTarget.source,
    target: primaryTarget.target,
  });
}

export function resolveInitialPrimaryEnvironmentDescriptor(): Promise<ExecutionEnvironmentDescriptor> {
  const descriptor = readPrimaryEnvironmentDescriptor();
  if (descriptor) {
    return Promise.resolve(descriptor);
  }

  if (primaryEnvironmentDescriptorPromise) {
    return primaryEnvironmentDescriptorPromise;
  }

  const nextPromise = fetchPrimaryEnvironmentDescriptor();
  primaryEnvironmentDescriptorPromise = nextPromise;
  return nextPromise.finally(() => {
    if (primaryEnvironmentDescriptorPromise === nextPromise) {
      primaryEnvironmentDescriptorPromise = null;
    }
  });
}

export function __resetPrimaryEnvironmentBootstrapForTests(): void {
  primaryEnvironmentDescriptorPromise = null;
  usePrimaryEnvironmentBootstrapStore.getState().reset();
}

export const resetPrimaryEnvironmentDescriptorForTests = __resetPrimaryEnvironmentBootstrapForTests;

export const __resetPrimaryEnvironmentDescriptorBootstrapForTests =
  __resetPrimaryEnvironmentBootstrapForTests;
