import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadId } from "@multi/contracts";
import { AuthStorage, type ExtensionFactory, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  type FauxModelDefinition,
  type FauxProviderRegistration,
  type FauxResponseStep,
  type Model,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import { ThreadAgentRuntime } from "../src/thread-agent-runtime";

export interface RuntimeHarness {
  readonly runtime: ThreadAgentRuntime;
  readonly faux: FauxProviderRegistration;
  readonly tempDir: string;
  readonly model: Model<string>;
  readonly setResponses: (responses: FauxResponseStep[]) => void;
  readonly cleanup: () => void;
}

export async function createRuntimeHarness(options: {
  readonly models?: readonly FauxModelDefinition[];
  readonly customTools?: readonly ToolDefinition[];
  readonly tools?: readonly string[];
  readonly excludeTools?: readonly string[];
  readonly extensionFactories?: readonly ExtensionFactory[];
  readonly withConfiguredAuth?: boolean;
} = {}): Promise<RuntimeHarness> {
  const tempDir = join(tmpdir(), `multi-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });

  const faux = registerFauxProvider(options.models ? { models: [...options.models] } : {});
  faux.setResponses([]);
  const model = faux.getModel();
  const authStorage = AuthStorage.inMemory();
  if (options.withConfiguredAuth ?? true) {
    authStorage.setRuntimeApiKey(model.provider, "faux-key");
  }

  const runtime = await ThreadAgentRuntime.create({
    threadId: ThreadId.make(`thread:${Date.now()}:${Math.random().toString(36).slice(2)}`),
    cwd: tempDir,
    agentDir: tempDir,
    model,
    authStorage,
    ...(options.customTools ? { customTools: options.customTools } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.excludeTools ? { excludeTools: options.excludeTools } : {}),
    ...(options.extensionFactories ? { extensionFactories: options.extensionFactories } : {}),
  });

  return {
    runtime,
    faux,
    tempDir,
    model,
    setResponses: faux.setResponses,
    cleanup() {
      runtime.dispose();
      faux.unregister();
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}
