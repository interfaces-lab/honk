import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AccountId,
  AuthProviderId,
  ModelId,
  ThreadId,
  type AgentModelPolicy,
  type AgentRuntimeEvent,
} from "@honk/contracts";
import {
  AuthStorage,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type FauxModelDefinition,
  type FauxProviderRegistration,
  type FauxResponseStep,
  type Model,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import { ThreadAgentRuntime, type SendMessageOptions } from "../src/thread-agent-runtime";

export const EMPTY_SEND_MESSAGE_OPTIONS = {
  clientMessageId: null,
  replacesClientMessageId: null,
  interactionMode: "agent",
  sourceProposedPlan: null,
  images: [],
  expandPromptTemplates: null,
  source: null,
  streamingBehavior: null,
} satisfies SendMessageOptions;

export function waitForEvent(
  runtime: ThreadAgentRuntime,
  type: AgentRuntimeEvent["type"],
  action: () => void | Promise<void>,
): Promise<void>;
export function waitForEvent<T>(
  runtime: ThreadAgentRuntime,
  type: AgentRuntimeEvent["type"],
  action: () => T | Promise<T>,
): Promise<T>;
export function waitForEvent<T>(
  runtime: ThreadAgentRuntime,
  type: AgentRuntimeEvent["type"],
  action: () => T | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let actionResult: Promise<T> | null = null;
    const unsubscribe = runtime.subscribe((event) => {
      if (event.type === type) {
        unsubscribe();
        if (actionResult === null) {
          reject(new Error(`Runtime event ${type} fired before the test action started.`));
          return;
        }
        actionResult.then(resolve, reject);
      }
    });

    actionResult = Promise.resolve().then(action);
    actionResult.catch((error: unknown) => {
      unsubscribe();
      reject(error);
    });
  });
}

export interface RuntimeHarness {
  readonly runtime: ThreadAgentRuntime;
  readonly faux: FauxProviderRegistration;
  readonly tempDir: string;
  readonly model: Model<string>;
  readonly setResponses: (responses: FauxResponseStep[]) => void;
  readonly cleanup: () => void;
}

export async function createRuntimeHarness(
  options: {
    readonly tempDir?: string;
    readonly threadId?: ThreadId;
    readonly removeTempDirOnCleanup?: boolean;
    readonly models?: readonly FauxModelDefinition[];
    readonly customTools?: readonly ToolDefinition[];
    readonly tools?: readonly string[];
    readonly excludeTools?: readonly string[];
    readonly extensionFactories?: readonly ExtensionFactory[];
    readonly withConfiguredAuth?: boolean;
    readonly policy?: AgentModelPolicy;
  } = {},
): Promise<RuntimeHarness> {
  const tempDir =
    options.tempDir ??
    join(tmpdir(), `honk-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });

  const faux = registerFauxProvider(options.models ? { models: [...options.models] } : {});
  faux.setResponses([]);
  const model = faux.getModel();
  const authStorage = AuthStorage.inMemory();
  if (options.withConfiguredAuth ?? true) {
    authStorage.setRuntimeApiKey(model.provider, "faux-key");
  }
  const policy = options.policy ?? createFauxModelPolicy(model);

  const runtime = await ThreadAgentRuntime.create({
    threadId:
      options.threadId ??
      ThreadId.make(`thread:${Date.now()}:${Math.random().toString(36).slice(2)}`),
    cwd: tempDir,
    agentDir: tempDir,
    model,
    authStorage,
    ...(options.customTools ? { customTools: options.customTools } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.excludeTools ? { excludeTools: options.excludeTools } : {}),
    extensionFactories: options.extensionFactories ? [...options.extensionFactories] : [],
    policy,
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
      if (options.removeTempDirOnCleanup !== false && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}

function createFauxModelPolicy(model: Model<string>): AgentModelPolicy {
  const authProviderId = AuthProviderId.make(model.provider);
  return {
    agentMode: "deep",
    interactionMode: "agent",
    modelSelection: {
      type: "explicit",
      authProviderId,
      accountId: AccountId.make(`${authProviderId}:default`),
      modelId: ModelId.make(`${model.provider}/${model.id}`),
    },
    thinkingLevel: "high",
    allowedToolNames: [],
    excludedToolNames: [],
  };
}
