import type { OpenCodeClient, OpenCodeSessionRef } from "@honk/opencode";
import * as React from "react";

export type ThreadRuntime = {
  readonly ref: OpenCodeSessionRef;
  readonly client: OpenCodeClient | null;
  readonly tabKey: string;
};

export const ThreadRuntimeContext = React.createContext<ThreadRuntime | null>(null);

export function useThreadRuntime(): ThreadRuntime {
  const runtime = React.useContext(ThreadRuntimeContext);
  if (runtime === null) throw new Error("Thread runtime is not available.");
  return runtime;
}
