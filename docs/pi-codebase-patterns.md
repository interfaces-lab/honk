# pi (earendil-works/pi) — Codebase Patterns: A Learning Document

Source studied: https://github.com/earendil-works/pi (cloned at `/tmp/pi-study`, June 2026, ~155k lines of TypeScript).
pi is Armin Ronacher–school engineering: a coding agent shipped as a 4-package npm monorepo. This document is a spec of _how_ it is written — function patterns, value normalization, function hierarchy, type setup — with real excerpts, so the patterns can be borrowed deliberately.

---

## 1. The shape of the whole thing

```
packages/
├── ai/            # Provider abstraction: stream LLM APIs into one unified message/event model
├── agent/         # Agent loop + Agent class + session harness. Depends only on ai.
├── tui/           # Terminal UI library. Zero coupling to ai/agent. Two external deps total.
└── coding-agent/  # The product. Composes ai + agent + tui. Tools, extensions, modes, config.
```

Strict one-directional layering: `ai → agent → coding-agent`, with `tui` as a standalone leaf consumed only by `coding-agent`. Inside `coding-agent`, the same discipline repeats: `core/` (sessions, tools, extensions) never imports from `modes/` (interactive TUI, print, RPC) — modes depend on core, never back.

**Toolchain choices worth noting:**

- TypeScript with `"strict": true` **and `"erasableSyntaxOnly": true`** — the code must run under Node's strip-types mode. This single compiler flag _bans_ `enum`, `namespace`, parameter properties, and `import =`. It mechanically forces several style patterns described below (string-literal unions instead of enums, explicit constructor field assignment).
- Biome for lint+format: tabs, indent width 3, line width 120. `noNonNullAssertion` off (they use `!` where they've proven non-null), `noExplicitAny` off (pragmatic `any` allowed at generic boundaries).
- Direct external deps are **pinned to exact versions**; lockfile changes are treated as reviewed code; `npm install --ignore-scripts` always. Dependency count is treated as a liability — tui has two runtime deps (`marked`, `get-east-asian-width`).
- Generated code is committed (`models.generated.ts`) but never hand-edited; the generator script is the source of truth.
- The repo carries an `AGENTS.md` with explicit rules: "No inline imports (`await import()`)", "Inline single-line helpers that have only one call site", "No `any` unless absolutely necessary", "Do not preserve backward compatibility unless asked".

---

## 2. Type setup

### 2.1 Interface-first; type aliases only for unions and shapes-with-operators

457 `export interface` vs 224 `export type` across src. The split is principled, not random:

- **`interface`** for every named object shape: messages, options bags, contexts, tool details, compat settings.
- **`type`** for unions, `Extract`/`Omit` compositions, function signatures, and tagged-union members.

```ts
// types: unions and derivations
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export type Message = UserMessage | AssistantMessage | ToolResultMessage;
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

// interfaces: object shapes
export interface ToolResultMessage<TDetails = any> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: TDetails;
  isError: boolean;
  timestamp: number; // Unix timestamp in milliseconds
}
```

### 2.2 Zero enums. Open string unions via `(string & {})`

There is not one `enum` in 155k lines. Every enumeration is a string-literal union, and unions that must accept unknown future values use the autocomplete-preserving open union trick:

```ts
// ai/src/types.ts
export type KnownApi = "openai-completions" | "anthropic-messages" | "google-generative-ai" | /* … */;
export type Api = KnownApi | (string & {});   // accepts any string, IDE still suggests the known ones

export type KnownProvider = "anthropic" | "openai" | "google" | /* ~35 more */;
export type Provider = KnownProvider | string;
```

`Known*` is the closed set used for typed registry lookups; the open alias is what flows through runtime APIs so custom providers are first-class.

### 2.3 Discriminated unions for everything that varies

Three discriminator field conventions, used consistently:

- `type:` for content blocks and **events** (`"text" | "thinking" | "toolCall"`, `"agent_start" | "turn_end" | …`)
- `role:` for messages (`"user" | "assistant" | "toolResult"`)
- `kind:` for **internal intermediate states** inside an algorithm:

```ts
// agent/src/agent-loop.ts — local pipeline states, not exported
type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
};
type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
};
```

Event unions are written as single `type` aliases with inline object members and section comments:

```ts
export type AgentEvent =
  // Agent lifecycle
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  // Turn lifecycle - a turn is one assistant response + any tool calls/results
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: any;
      isError: boolean;
    };
```

### 2.4 Schema-first tool typing: TypeBox + `Static<typeof schema>`

The runtime validation schema is the single source of truth; the static type is _derived from it_, never written twice:

```ts
// coding-agent/src/core/tools/read.ts
const readSchema = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(
    Type.Number({ description: "Line number to start reading from (1-indexed)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
export type ReadToolInput = Static<typeof readSchema>;
```

The generic chain threads the schema type all the way through execution, so `execute` receives statically-typed params:

```ts
// agent/src/types.ts
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = any,
> extends Tool<TParameters> {
  label: string;
  prepareArguments?: (args: unknown) => Static<TParameters>; // pre-validation normalization shim
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}
```

Descriptions for the LLM live _in the schema options_, not in separate prompt files.

### 2.5 Generics parameterized by capability, with conditional refinement

`Model<TApi>` carries its API in the type, and the `compat` field's type is _conditionally selected_ by which API it is:

```ts
export interface Model<TApi extends Api> {
  id: string;
  api: TApi;
  provider: Provider;
  baseUrl: string;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  compat?: TApi extends "openai-completions"
    ? OpenAICompletionsCompat
    : TApi extends "openai-responses"
      ? OpenAIResponsesCompat
      : TApi extends "anthropic-messages"
        ? AnthropicMessagesCompat
        : never;
}
```

And registry lookups recover the literal API type from generated data via an inference type:

```ts
// ai/src/models.ts — getModel("anthropic", "claude-...") returns Model<"anthropic-messages">, statically
type ModelApi<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]> =
  (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi } ? (TApi extends Api ? TApi : never) : never;

export function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(
  provider: TProvider, modelId: TModelId): Model<ModelApi<TProvider, TModelId>> { … }
```

### 2.6 Extension points via declaration merging

Downstream apps add their own message types without the core package knowing about them:

```ts
// agent/src/types.ts
export interface CustomAgentMessages {
  // Empty by default - apps extend via declaration merging
}
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

The core loop works with `AgentMessage[]` throughout and only narrows to LLM `Message[]` at the provider boundary via a caller-supplied `convertToLlm` function (see §5.3).

### 2.7 Interfaces that encode behavioral contracts, not just shape

Two notable moves:

**Accessor properties in an interface** to express copy-on-assign semantics in the _type_:

```ts
export interface AgentState {
  /** Available tools. Assigning a new array copies the top-level array. */
  set tools(tools: AgentTool<any>[]);
  get tools(): AgentTool<any>[];
  readonly isStreaming: boolean;
  readonly pendingToolCalls: ReadonlySet<string>;
}
```

The implementation is a closure-based object literal with real getters/setters that `.slice()` on assignment (`createMutableAgentState`). Internally, the class uses a `MutableAgentState = Omit<AgentState, readonly fields> & { …mutable }` derived type rather than a second hand-written interface.

**JSDoc "Contract:" blocks** that state non-throw obligations as part of the API:

```ts
/**
 * Stream function used by the agent loop.
 * Contract:
 * - Must not throw or return a rejected promise for request/model/runtime failures.
 * - Failures must be encoded in the returned stream via protocol events and a
 *   final AssistantMessage with stopReason "error" or "aborted" and errorMessage.
 */
export type StreamFn = (…) => …;
```

Every callback in `AgentLoopConfig` documents its contract this way ("must not throw or reject. Return [] when no steering messages are available."). Merge semantics are spelled out exhaustively ("`content`: if provided, replaces the tool result content array in full … There is no deep merge").

---

## 3. Function patterns

### 3.1 `function` declarations, near-absolutely

Counted across all of src: **547 `export function` declarations vs 1 exported arrow-const**. Arrow consts appear in exactly two situations:

1. When a value must be _typed as_ a function type (the exception that proves the rule):

```ts
// the function IS an instance of a named contract type
export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (model, context, options) => { … };
```

2. Trivial one-line lambdas at module level:

```ts
const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));
```

Everything else — helpers, entry points, factories — is `function name(…): ReturnType` with explicit return types on exports.

### 3.2 Classes have exactly four jobs

91 classes, and every one falls into one of these buckets:

| Bucket                   | Examples                                                                                         | Why a class                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Stateful runtime objects | `Agent`, `AgentSession`, `SessionManager`, `SettingsManager`, `ModelRegistry`, `ExtensionRunner` | own mutable state + lifecycle + subscriptions |
| UI components            | `Text`, `Editor`, `SelectList`, ~40 `*Component` in coding-agent                                 | per-instance render caches and input state    |
| Generic data structures  | `EventStream<T,R>`, `UndoStack<S>`, `KillRing`, `PendingMessageQueue`                            | small, self-contained, reusable               |
| Error taxonomy           | `AgentHarnessError`, `CompactionError`, `SessionError` … `extends Error`                         | catch-by-instanceof                           |

Nothing else is a class. There are no "service classes" wrapping pure logic, no static-method namespaces. Pure logic is module functions; classes appear when identity + mutation + time are intrinsic. Constructors do plain field assignment (no parameter properties — banned by `erasableSyntaxOnly`), with options normalized inline:

```ts
constructor(options: AgentOptions = {}) {
  this._state = createMutableAgentState(options.initialState);
  this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
  this.streamFn = options.streamFn ?? streamSimple;
  this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
  this.transport = options.transport ?? "auto";
  this.toolExecution = options.toolExecution ?? "parallel";
}
```

Note the pattern: **defaults are applied with `??` exactly once, in the constructor/factory** — never re-defaulted downstream.

### 3.3 File anatomy: a consistent vertical order

Every substantial module reads top-to-bottom the same way (`anthropic.ts` is the canonical example):

```
imports (external first, then internal, type-only marked `import type`)
module constants (UPPER_SNAKE / camelCase lookup tables)
small private helpers (function declarations)
exported option/compat types co-located with what consumes them
THE exported entry point(s)
more private helpers used only by the entry point, below it
```

Private helpers are **module-level siblings**, never nested inside the function that calls them, and never exported just for tests. A 1,200-line provider file is considered fine _because_ it is one self-contained unit: ~25 small named functions orbiting one exported stream function.

### 3.4 Function hierarchy: orchestrator → phase functions → leaf helpers

The agent loop is the masterclass. The public surface is two thin wrappers; below them, each conceptual phase is its own named function with a typed intermediate result:

```
agentLoop() / agentLoopContinue()        ← sugar: wrap runAgentLoop in an EventStream
  runAgentLoop() / runAgentLoopContinue() ← set up context, emit start events
    runLoop()                             ← while-loops: turns, steering, follow-ups
      streamAssistantResponse()           ← the ONLY place AgentMessage[] → Message[] happens
      executeToolCalls()                  ← dispatch: sequential vs parallel strategy
        executeToolCallsSequential() / executeToolCallsParallel()
          prepareToolCall()      → PreparedToolCall | ImmediateToolCallOutcome   (kind-tagged)
          executePreparedToolCall() → ExecutedToolCallOutcome
          finalizeExecutedToolCall() → FinalizedToolCallOutcome
          emitToolExecutionEnd(), createToolResultMessage(), emitToolResultMessage()
```

Rules you can extract from this:

- **Each phase returns a named, locally-declared type** (`PreparedToolCall`, `FinalizedToolCallOutcome`) instead of positional tuples or mutated shared state. The types live next to the functions, not in `types.ts`, because they're implementation detail.
- **Branching strategies become sibling functions** (`…Sequential` / `…Parallel`) sharing the same leaf helpers, selected by one small dispatcher.
- **Effects are injected**: the loop never knows who's listening — it receives `emit: AgentEventSink` and a `streamFn` as parameters. The `Agent` class is just one possible wiring of state + queues around the pure-ish loop functions.
- **The sync/async duality is layered**, not mixed: `agentLoop` (returns `EventStream`) is implemented by calling `runAgentLoop` (async, takes a sink) and pushing into the stream. One implementation, two consumption styles.

### 3.5 Factories + pluggable Operations for dependency injection

No DI container. Two cooperating conventions instead:

**`create*` factory functions** that close over normalized options and return interface-shaped objects:

```ts
export function createReadToolDefinition(cwd: string, options?: ReadToolOptions): ToolDefinition<typeof readSchema, …> {
  const autoResizeImages = options?.autoResizeImages ?? true;   // normalize once
  const ops = options?.operations ?? defaultReadOperations;
  return { name: "read", label: "read", parameters: readSchema, async execute(…) { …uses ops… } };
}
```

**`*Operations` interfaces** as the seam for swapping the outside world (local fs vs SSH vs sandbox), always paired with a `default*Operations` const:

```ts
export interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}
const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

Adapters between layer vocabularies are tiny explicit `wrap*` functions, not inheritance (`wrapToolDefinition(definition) → AgentTool`).

### 3.6 Naming taxonomy

The verb prefix tells you the function's category at a glance:

| Prefix                     | Meaning                                                      | Examples                                                                       |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `create*`                  | factory returning a new value/closure                        | `createReadTool`, `createAssistantMessageEventStream`, `createErrorToolResult` |
| `build*`                   | assemble a request/derived structure from parts              | `buildParams`, `buildBaseOptions`, `buildSessionContext`                       |
| `resolve*`                 | compute an effective value from option → env → default chain | `resolveCacheRetention`, `resolveApiProvider`, `resolveConfigValue`            |
| `normalize*`               | canonicalize an input into the accepted form                 | `normalizePromptInput`, `normalizeToolCallId`, `normalizeKeys`                 |
| `clamp*`                   | force into a supported range with graceful fallback          | `clampThinkingLevel`, `clampReasoning`                                         |
| `convert*` / `transform*`  | map between layer vocabularies                               | `convertToLlm`, `convertMessages`, `convertTools`, `transformMessages`         |
| `with*`                    | return augmented copy of options                             | `withEnvApiKey`                                                                |
| `get*`                     | lookup/derive, no mutation                                   | `getModel`, `getAnthropicCompat`, `getSupportedThinkingLevels`                 |
| `is*` / `has*` / `should*` | boolean predicates, including type guards                    | `isRecord`, `hasExplicitApiKey`, `shouldTerminateToolBatch`                    |
| `prepare*` / `finalize*`   | pipeline phases                                              | `prepareToolCall`, `finalizeExecutedToolCall`                                  |
| `emit*`                    | event-sink side effects                                      | `emitToolExecutionEnd`                                                         |

Files are kebab-case and named after the one thing they export (`select-list.ts` → `SelectList`). Suffix conventions in coding-agent: `*ToolInput` / `*ToolDetails` / `*ToolOptions` / `*Operations` / `*Context` / `*Event` / `*Handler`.

---

## 4. Value normalization — the deepest house specialty

pi's central design problem is "many providers × many models × messy LLM output", and the answer everywhere is: **normalize at the boundary, exactly once, into one canonical internal model — then never check again downstream.**

### 4.1 One unified internal model

Every provider, no matter how alien its wire format, is forced into the same `AssistantMessage` / `AssistantMessageEvent` shapes (ai/types.ts). Usage tokens, costs, stop reasons, thinking blocks, tool calls — one vocabulary. Providers also _receive_ the canonical form and convert outward in their own `convertMessages`/`convertTools` helpers. Nothing between the provider and the UI ever switches on the provider name for message handling.

### 4.2 Effective-value resolution: option → env → default

The pattern for any setting with multiple sources is a tiny pure `resolve*` function:

```ts
function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
  if (cacheRetention) return cacheRetention; // explicit option
  if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") return "long"; // env
  return "short"; // default
}
```

### 4.3 Compat resolution: sparse overrides → fully-resolved record

Per-model quirk flags are optional on `Model.compat`, but consumers never deal with `undefined`. One function collapses sparse user overrides + provider auto-detection into a `Required<…>` value:

```ts
function getAnthropicCompat(model: Model<"anthropic-messages">): Required<Omit<AnthropicMessagesCompat, "forceAdaptiveThinking">> {
  const isFireworks = model.provider === "fireworks";
  return {
    supportsEagerToolInputStreaming: model.compat?.supportsEagerToolInputStreaming ?? !isFireworks,
    supportsLongCacheRetention:      model.compat?.supportsLongCacheRetention ?? !isFireworks,
    supportsCacheControlOnTools:     model.compat?.supportsCacheControlOnTools ?? !isFireworks,
    supportsTemperature:             model.compat?.supportsTemperature ?? true,
    …
  };
}
```

The `Required<>` return type is the trick: after this function, the type system _guarantees_ no downstream `??`.

### 4.4 Clamping with graceful nearest-neighbor fallback

Numeric/level inputs are never rejected — they're snapped to the nearest supported value:

```ts
// models.ts — try requested level, then upward, then downward, then first available
export function clampThinkingLevel(model, level): ModelThinkingLevel {
  const availableLevels = getSupportedThinkingLevels(model);
  if (availableLevels.includes(level)) return level;
  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
  for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i++) { if (availableLevels.includes(EXTENDED_THINKING_LEVELS[i])) return EXTENDED_THINKING_LEVELS[i]; }
  for (let i = requestedIndex - 1; i >= 0; i--) { … }
  return availableLevels[0] ?? "off";
}
```

In the TUI, constructor inputs get the same treatment — validate, floor, clamp, fall back:

```ts
const maxVisible = options.autocompleteMaxVisible ?? 5;
this.autocompleteMaxVisible = Number.isFinite(maxVisible)
  ? Math.max(3, Math.min(20, Math.floor(maxVisible)))
  : 5;
```

Budget arithmetic normalizes interdependent values (`adjustMaxTokensForThinking`: merge default+custom budgets, fit thinking inside the model cap, guarantee `minOutputTokens` headroom).

### 4.5 Trust-nothing LLM input: coerce → validate → formatted error

Tool arguments from a model are hostile input. `validateToolArguments` (ai/utils/validation.ts) is the full pattern:

1. `structuredClone(toolCall.arguments)` — never mutate the original;
2. `Value.Convert(schema, args)` — TypeBox's own type coercion;
3. for non-TypeBox raw JSON schemas, a hand-written recursive `coerceWithJsonSchema` (string→number, `"true"`→true, null→defaults, per-property/per-item recursion, `anyOf` resolved by _trying each candidate on a clone and keeping the first that validates_);
4. compiled validators cached in a `WeakMap` keyed by schema object;
5. on failure, throw one Error whose message is formatted _for the model to read_: dotted paths, per-field messages, and the received arguments echoed back as JSON.

A second hook, `AgentTool.prepareArguments?(args: unknown)`, runs _before_ validation as a compatibility shim (e.g., accepting Claude-Code-style `file_path` for a tool whose schema says `path`).

### 4.6 Transcript normalization for cross-model replay

`transformMessages` (providers/transform-messages.ts) makes any stored transcript valid for any target model. It's a two-pass pure function:

- Pass 1, per-message mapping: images downgraded to placeholder text for non-vision models (with run-length dedupe of placeholders); thinking blocks kept only for the same model (signatures required), converted to plain text cross-model, redacted thinking dropped; provider-specific fields (`thoughtSignature`) stripped; tool-call IDs renamed via injected `normalizeToolCallId` with an ID-map so tool results follow.
- Pass 2, structural repair: errored/aborted assistant messages skipped entirely; **synthetic error tool-results inserted for orphaned tool calls** (`"No result provided"`) whenever a user message interrupts, a new assistant message starts, or the transcript ends.

The signature tells the philosophy: `(messages, model, normalizeToolCallId?) => Message[]` — pure data-in/data-out, provider-specific behavior injected as a function.

### 4.7 Sanitization at the wire

Strings get `sanitizeSurrogates(...)` exactly where they leave for the API; streaming tool-call JSON is parsed incrementally with `parseStreamingJson` and repaired with `parseJsonWithRepair` rather than waiting for completion or failing.

### 4.8 Config: tiered merge with explicit semantics

Settings come from defaults → global file → project file, merged by a `deepMergeSettings` with documented, _bounded_ semantics: `undefined` never overrides, plain objects merge one level, arrays and primitives replace. Config string values support three forms — literal, `$ENV_VAR`, `!shell command` — collapsed by one `resolveConfigValue`.

---

## 5. Error handling and the streaming/event model

### 5.1 Errors are data on the happy path; exceptions are for programmer error

The most distinctive architectural rule. Network failures, provider errors, aborts — none of these throw. They become a final `AssistantMessage` with `stopReason: "error" | "aborted"` and `errorMessage`, delivered through the same event stream as success:

```ts
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | …
  | { type: "done";  reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };
```

Genuine misuse, by contrast, throws immediately with instructive messages: `"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."`

The division of labor for tools: **tools throw freely** ("Throw on failure instead of encoding errors in `content`"), and the _loop_ catches and converts to `{ content: [{type:"text", text: message}], isError: true }` tool results. Authors write natural code; the boundary owns the encoding. Aborts are checked between phases (`if (signal?.aborted) break`), and even `Agent.handleRunFailure` replays a full synthetic event sequence (`message_start → message_end → turn_end → agent_end`) so consumers see one protocol no matter what happened.

### 5.2 `EventStream<T, R>`: one 60-line primitive instead of a streaming library

```ts
export class EventStream<T, R = T> implements AsyncIterable<T> {
  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) { … }
  push(event: T): void { … }     // producer side
  async *[Symbol.asyncIterator]() // consumer side: for-await
  result(): Promise<R>            // or just await the final value
}
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> { … }
```

Push-based, queue + waiting-resolvers, terminal-event predicate passed to the constructor. Every event carries the full accumulating `partial` snapshot, so consumers can be stateless — render the snapshot, ignore deltas, never reconstruct.

### 5.3 Layer boundaries are functions, named as conversions

The loop works on `AgentMessage[]` (app vocabulary, may include UI-only types) and converts to `Message[]` (LLM vocabulary) at exactly one point, with the conversion _supplied by the caller_:

```ts
// the ONLY place AgentMessage[] → Message[] happens (agent-loop.ts, streamAssistantResponse)
let messages = context.messages;
if (config.transformContext) messages = await config.transformContext(messages, signal); // prune/inject, same vocabulary
const llmMessages = await config.convertToLlm(messages); // change vocabulary
```

Hooks (`beforeToolCall` / `afterToolCall` / `shouldStopAfterTurn` / `prepareNextTurn`) all follow the same grammar: receive a typed context object + the abort signal, return a partial override or undefined, with replace-not-merge semantics documented per field.

### 5.4 Registry pattern for open extension

Providers register into module-level `Map`s, with a thin wrapper validating invariants at registration time and `sourceId` tags so an extension's registrations can be bulk-removed (`unregisterApiProviders(sourceId)`). Entry points (`streamSimple`) are then two lines: resolve from registry, delegate. Built-ins self-register via a side-effect import (`import "./providers/register-builtins.ts"`).

---

## 6. State, persistence, and testing (briefly)

- **Sessions are append-only JSONL** with a typed header + tagged entries (`message`, `compaction`, `custom`, …), forming a _tree_ via `id`/`parentId` for branching. A `version` field plus in-place `migrateV1ToV2 → migrateV2ToV3` chain runs at load (`migrateToCurrentVersion` returns whether anything changed). Extension data rides in `CustomEntry<T>` without schema changes.
- **Testing uses a faux provider**, not mocks-per-test: `createFauxStreamFn(responses)` takes a declarative script of responses (`string | { text?, toolCalls?, thinking?, error?, delayMs? }`), replays them as realistic token-level delta streams, and records every context it was called with for assertions. A `Harness` factory bundles session + agent + faux state + recorded events + `cleanup()`. House rule: regression tests live in `test/suite/regressions/<issue-number>-<slug>.test.ts`.
- **TUI rendering** is `render(width): string[]` + line-diffing against the previous frame — components cache their rendered lines keyed by inputs and expose `invalidate()`. No virtual DOM, no framework.

---

## 7. The spec, distilled

If you want code that reads like pi:

1. **Layer packages one-way** (provider abstraction → engine → product; UI standalone) and repeat the discipline inside each package (`core/` never imports `modes/`).
2. **`function` declarations for everything**; arrow consts only to inhabit a named function type or for one-liners. Explicit return types on exports.
3. **Classes only for** stateful runtimes, UI components with caches, generic containers, and `Error` subclasses. Pure logic is never a class.
4. **Interfaces for object shapes, `type` for unions.** No enums — string-literal unions, with `Known* | (string & {})` when the set must stay open.
5. **Discriminate everything**: `type` for events/content, `role` for messages, `kind` for internal pipeline states. Declare pipeline-state types next to the functions that use them, not in `types.ts`.
6. **Schema is the source of truth** for any externally-supplied structure: TypeBox `Type.Object` with LLM-facing descriptions inline, `Static<typeof schema>` for the type, compiled-validator cache, coercion before validation, error messages formatted for the caller (including an LLM) to act on.
7. **Normalize at the boundary, once**: `resolve*` (option → env → default), `getXCompat` returning `Required<…>`, `clamp*` with nearest-supported fallback, `normalize*`/`prepare*` shims for messy input, `??`-defaults applied at exactly one point (constructor or factory).
8. **Decompose orchestration into phase functions** with typed intermediate results (`prepare → execute → finalize`, each returning a named type) and inject effects (`emit` sinks, `streamFn`, `*Operations` objects with `default*` implementations) rather than importing them.
9. **Expected failures are data** (stop reasons + error messages flowing through the same event protocol as success); **misuse throws** with messages that tell the caller what to do instead. Tool/leaf code throws naturally; the boundary converts.
10. **One small primitive over a dependency**: a 60-line `EventStream`, a 25-line `PendingMessageQueue`, a hand-rolled fuzzy matcher. Dependencies are pinned exactly, installed with `--ignore-scripts`, and counted.
11. **Document contracts, not mechanics**: JSDoc states must-not-throw obligations, default values, and merge semantics ("replaces in full, no deep merge"); inline comments explain _why_ (provider quirks, API requirements), never _what_.
12. **Persist as versioned, tagged, append-only entries** with explicit in-place migrations; leave a `CustomEntry<T>` escape hatch so extensions never force schema changes.
