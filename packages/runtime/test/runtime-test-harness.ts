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
  ModelRegistry,
  type ExtensionFactory,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  type Api,
  type AssistantMessage,
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type FauxModelDefinition,
  type FauxResponseStep,
  type Model,
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

export interface RuntimeFauxProvider {
  readonly api: string;
  readonly provider: string;
  readonly models: [Model<string>, ...Model<string>[]];
  readonly state: { callCount: number };
  readonly getModel: (modelId?: string) => Model<string> | undefined;
  readonly setResponses: (responses: FauxResponseStep[]) => void;
  readonly appendResponses: (responses: FauxResponseStep[]) => void;
  readonly getPendingResponseCount: () => number;
  readonly streamSimple: NonNullable<
    Parameters<ModelRegistry["registerProvider"]>[1]["streamSimple"]
  >;
}

export interface RuntimeHarness {
  readonly runtime: ThreadAgentRuntime;
  readonly faux: RuntimeFauxProvider;
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
    readonly provider?: string;
    readonly api?: string;
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

  const faux = createRuntimeFauxProvider({
    ...(options.models ? { models: [...options.models] } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.api ? { api: options.api } : {}),
  });
  faux.setResponses([]);
  const model = faux.getModel();
  if (!model) throw new Error("Expected faux model");
  const authStorage = AuthStorage.inMemory();
  if (options.withConfiguredAuth ?? true) {
    authStorage.setRuntimeApiKey(model.provider, "faux-key");
  }
  const modelRegistry = ModelRegistry.create(authStorage, join(tempDir, "models.json"));
  registerFauxInModelRegistry(modelRegistry, faux);
  const policy = options.policy ?? createFauxModelPolicy(model);

  const runtime = await ThreadAgentRuntime.create({
    threadId:
      options.threadId ??
      ThreadId.make(`thread:${Date.now()}:${Math.random().toString(36).slice(2)}`),
    cwd: tempDir,
    agentDir: tempDir,
    model,
    authStorage,
    modelRegistry,
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
      if (options.removeTempDirOnCleanup !== false && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  };
}

export function registerFauxInModelRegistry(
  modelRegistry: ModelRegistry,
  faux: RuntimeFauxProvider,
): void {
  modelRegistry.registerProvider(faux.provider, {
    name: "Faux",
    baseUrl: "http://localhost:0",
    apiKey: "$HONK_FAUX_API_KEY",
    api: faux.api as Api,
    streamSimple: faux.streamSimple,
    models: faux.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: model.api as Api,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: [...model.input],
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      compat: model.compat,
    })),
  });
}

export function createRuntimeFauxProvider(options: {
  readonly provider?: string;
  readonly api?: string;
  readonly models?: readonly FauxModelDefinition[];
}): RuntimeFauxProvider {
  const api = options.api ?? "faux";
  const provider = options.provider ?? "faux";
  const definitions = options.models?.length ? options.models : [{ id: "faux-1" }];
  const models = definitions.map((definition) => ({
    id: definition.id,
    name: definition.name ?? definition.id,
    api,
    provider,
    baseUrl: "http://localhost:0",
    reasoning: definition.reasoning ?? false,
    input: definition.input ?? ["text"],
    cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: definition.contextWindow ?? 128_000,
    maxTokens: definition.maxTokens ?? 16_384,
  })) as [Model<string>, ...Model<string>[]];
  const state = { callCount: 0 };
  const pendingResponses: FauxResponseStep[] = [];

  return {
    api,
    provider,
    models,
    state,
    getModel(modelId) {
      return modelId ? models.find((model) => model.id === modelId) : models[0];
    },
    setResponses(responses) {
      pendingResponses.splice(0, pendingResponses.length, ...responses);
    },
    appendResponses(responses) {
      pendingResponses.push(...responses);
    },
    getPendingResponseCount() {
      return pendingResponses.length;
    },
    streamSimple(model, context, streamOptions) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        void resolveRuntimeFauxResponse({
          pendingResponses,
          state,
          model: model as Model<string>,
          context,
          streamOptions,
          publish: (message) => {
            stream.push({ type: "start", partial: message });
            if (message.stopReason === "error" || message.stopReason === "aborted") {
              stream.push({ type: "error", reason: message.stopReason, error: message });
            } else {
              stream.push({ type: "done", reason: message.stopReason, message });
            }
          },
        });
      });
      return stream;
    },
  };
}

async function resolveRuntimeFauxResponse(input: {
  readonly pendingResponses: FauxResponseStep[];
  readonly state: { callCount: number };
  readonly model: Model<string>;
  readonly context: Parameters<NonNullable<RuntimeFauxProvider["streamSimple"]>>[1];
  readonly streamOptions: Parameters<NonNullable<RuntimeFauxProvider["streamSimple"]>>[2];
  readonly publish: (message: AssistantMessage) => void;
}): Promise<void> {
  input.state.callCount += 1;
  const step = input.pendingResponses.shift();
  const response = step
    ? typeof step === "function"
      ? await step(input.context, input.streamOptions, input.state, input.model)
      : step
    : fauxAssistantMessage("No more faux responses queued", {
        stopReason: "error",
        errorMessage: "No more faux responses queued",
      });
  input.publish({
    ...response,
    api: input.model.api,
    provider: input.model.provider,
    model: input.model.id,
  });
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
    fast: false,
    thinkingLevel: "high",
    allowedToolNames: [],
    excludedToolNames: [],
  };
}
