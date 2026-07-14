import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as PlatformError from "effect/PlatformError";
import { Path } from "effect";

// Raw plugin modules, inlined by electron-vite and emitted as one self-contained
// directory next to opencode.json. OpenCode imports index.ts by absolute path; its
// dependencies use relative imports because bare packages cannot resolve from the
// generated state directory.
import honkPluginIndexSource from "./honk-opencode-plugin/index.ts?raw";
import honkPluginParentChatSource from "./honk-opencode-plugin/parent-chat.ts?raw";
import honkPluginPlanSubmitSource from "./honk-opencode-plugin/plan-submit.ts?raw";
import honkPluginTypesSource from "./honk-opencode-plugin/types.ts?raw";

interface HonkPluginModuleSource {
  readonly fileName: string;
  readonly source: string;
}

const HONK_PLUGIN_MODULE_SOURCES = [
  { fileName: "index.ts", source: honkPluginIndexSource },
  { fileName: "parent-chat.ts", source: honkPluginParentChatSource },
  { fileName: "plan-submit.ts", source: honkPluginPlanSubmitSource },
  { fileName: "types.ts", source: honkPluginTypesSource },
] as const satisfies readonly HonkPluginModuleSource[];

// The honk-managed opencode config.
//
// honk drives the renderer against a plain `opencode serve` process (the
// sidecar). Rather than editing the user's own `~/.config/opencode/opencode.json`
// we write a self-contained config into a honk-owned directory and point the
// sidecar at it with `OPENCODE_CONFIG=<file>`. opencode treats `OPENCODE_CONFIG`
// as an ADDITIONAL config that merges on top of the user's global + project
// configs (nearest-wins), so:
//   - the user's own opencode config is never clobbered, and
//   - honk's plugin + mode/oracle agents are always present.
//
// Schema target: `https://opencode.ai/config.json`. The installed binary decodes
// this file with the v1 config schema (`ConfigParse.schema(ConfigV1.Info, ...)`
// in opencode `packages/opencode/src/config/config.ts`). The v1 agent shape
// (`core/src/v1/config/agent.ts`) is:
//   - `model?`      "provider/model" (OPTIONAL — omitting it is legal and is how
//                   mode agents defer model choice to the per-prompt preset pin)
//   - `variant?`    model variant, only meaningful with a configured `model`
//   - `prompt?`     the agent's system prompt. NOTE: when set, opencode uses it
//                   as a full REPLACEMENT of the provider base system prompt
//                   (`session/llm/request.ts`: `agent.prompt ? [agent.prompt] :
//                   SystemPrompt.provider(model)`). So a custom prompt must be
//                   self-contained; the default working mode (honk-build)
//                   deliberately omits it to keep opencode's tuned base prompt.
//   - `description?` used for the `@` menu and agent list
//   - `mode?`       "primary" | "subagent" | "all"
//   - `hidden?`     hide a subagent from the `@` menu
//   - `permission?` v1 permission record (see below)
//
// Permission (`core/src/v1/config/permission.ts`) is a record keyed by tool name
// whose values are an action (`"allow" | "ask" | "deny"`) or, for tools that take
// a target, a `{ pattern: action }` object. Known keys include `read`, `edit`,
// `glob`, `grep`, `list`, `bash`, `task`, `webfetch`, `websearch`, `question`,
// `external_directory`, plus `*` as a wildcard default. opencode normalizes the
// `write`, `edit`, and `patch` tools all onto the single `edit` key, so
// `edit: "deny"` blocks every file-mutation tool at once.

/** The four preset dial stops. Selection pins the per-prompt MODEL bundle. */
export const OPENCODE_PRESET_STOPS = ["low", "medium", "high", "ultra"] as const;
export type OpencodePresetStop = (typeof OPENCODE_PRESET_STOPS)[number];

// Model catalog IDs in opencode `provider/model` form.
//
// `sol` is OpenAI's GPT-5.6 "Sol" family, reached through opencode's native
// ChatGPT OAuth provider. `fable5` is Anthropic's Claude Fable 5 family, reached
// through the Anthropic auth plugin below. The plugin advertises Claude Code
// credential pickup and browser OAuth through opencode's provider-auth API, and
// patches Anthropic requests to use the resulting Claude Pro/Max credential. The
// `fable-5` slug matches opencode's own model handling
// (`packages/opencode/src/provider/transform.ts`).
//
// NOTE: these exact IDs still need confirmation against live models.dev data once
// the models land in the catalog; see the sidecar impl report.
export const OPENCODE_MODEL_IDS = {
  sol: "openai/gpt-5.6-sol",
  fable5: "anthropic/claude-fable-5",
} as const;

// The default plugin honk always configures for Anthropic provider auth. Pin the
// inspected release: opencode installs npm plugins at runtime, so an unqualified
// latest would make the login and request contract change between app launches.
// The sidecar pre-warms this before the renderer can open Providers.
export const OPENCODE_DEFAULT_PLUGINS = ["opencode-anthropic-login-via-cli@1.4.0"] as const;

interface PresetArm {
  readonly model: string;
  readonly variant: string;
}

interface PresetDefinition {
  readonly stop: OpencodePresetStop;
  /** The per-prompt model bundle a thread pins at birth (sent with every prompt). */
  readonly agent: PresetArm;
  /** The paired deep-reasoning oracle subagent's pinned model bundle. */
  readonly oracle: PresetArm;
}

// The preset table from the settled design decisions. Each stop hard-pins a
// per-prompt model arm and a companion oracle arm (model + variant). A thread
// pins one stop at birth; every prompt resends the pinned model with whichever
// mode agent is currently selected (mode and model are orthogonal).
export const OPENCODE_PRESETS: readonly PresetDefinition[] = [
  {
    stop: "low",
    agent: { model: OPENCODE_MODEL_IDS.sol, variant: "low" },
    oracle: { model: OPENCODE_MODEL_IDS.sol, variant: "medium" },
  },
  {
    stop: "medium",
    agent: { model: OPENCODE_MODEL_IDS.sol, variant: "medium" },
    oracle: { model: OPENCODE_MODEL_IDS.sol, variant: "high" },
  },
  {
    stop: "high",
    agent: { model: OPENCODE_MODEL_IDS.sol, variant: "xhigh" },
    oracle: { model: OPENCODE_MODEL_IDS.fable5, variant: "high" },
  },
  {
    stop: "ultra",
    agent: { model: OPENCODE_MODEL_IDS.fable5, variant: "high" },
    oracle: { model: OPENCODE_MODEL_IDS.sol, variant: "high" },
  },
];

/** Oracle-subagent config key paired to a preset stop. */
export const opencodePresetOracleName = (stop: OpencodePresetStop): string => `honk-oracle-${stop}`;

// The mode dial. Modes are ORTHOGONAL to models: a mode is an opencode agent
// (system prompt + permission posture), while the model comes from the preset
// pin per prompt. Mode is switchable per prompt; the model bundle is not. `build`
// is the default working mode.
export const OPENCODE_MODE_IDS = ["build", "ask", "plan", "debug"] as const;
export type OpencodeModeId = (typeof OPENCODE_MODE_IDS)[number];

/** The mode a fresh thread starts in. */
export const OPENCODE_DEFAULT_MODE: OpencodeModeId = "build";

/** opencode agent config key for a mode (what the renderer sends per prompt). */
export const opencodeModeAgentName = (mode: OpencodeModeId): string => `honk-${mode}`;

/** Whether a mode is the one a fresh thread starts in. */
const isDefaultMode = (mode: OpencodeModeId): boolean => mode === OPENCODE_DEFAULT_MODE;

// Permission action + rule shapes, matching `core/src/v1/config/permission.ts`.
type OpencodePermissionAction = "allow" | "ask" | "deny";
type OpencodePermissionRule =
  | OpencodePermissionAction
  | Readonly<Record<string, OpencodePermissionAction>>;
type OpencodePermissionConfig = Readonly<Record<string, OpencodePermissionRule>>;

// Minimal typing of the slice of opencode's v1 agent config honk authors. This is
// a hand-written subset of `https://opencode.ai/config.json` (not imported: the
// opencode package is only present as the spawned binary, not a build dep).
interface OpencodeAgentConfig {
  readonly mode: "primary" | "subagent" | "all";
  readonly description: string;
  /** Omitted for mode agents; the model is pinned per prompt by the preset. */
  readonly model?: string;
  readonly variant?: string;
  /** Full replacement of the provider base prompt when set (see file header). */
  readonly prompt?: string;
  readonly permission?: OpencodePermissionConfig;
  readonly hidden?: boolean;
}

export interface HonkOpencodeConfig {
  readonly $schema: string;
  readonly plugin: readonly string[];
  /** The default primary agent when a request omits one; kept as the build mode. */
  readonly default_agent: string;
  readonly agent: Readonly<Record<string, OpencodeAgentConfig>>;
}

interface ModeDefinition {
  readonly id: OpencodeModeId;
  /** opencode agent config key (`honk-<id>`). */
  readonly agent: string;
  /** Renderer-facing label. */
  readonly label: string;
  /** One-line description for menus and the agent list. */
  readonly description: string;
  /** True for the mode a fresh thread starts in. */
  readonly isDefault: boolean;
  /** Full replacement system prompt, or null to keep opencode's base prompt. */
  readonly prompt: string | null;
  /** v1 permission posture layered on top of opencode's build defaults. */
  readonly permission: OpencodePermissionConfig;
}

// honk-ask: pure read-only Q&A. `edit: "deny"` blocks write/edit/patch. `bash:
// "ask"` gates every shell command for approval — "mutating bash" cannot be
// classified statically, so all bash is gated and the prompt forbids mutation.
// read/grep/glob/list/webfetch stay allowed via opencode's `*: allow` default.
const ASK_PROMPT = `You are a read-only coding assistant answering questions about this codebase. You can read files, search with grep and glob, list directories, and fetch reference material, but you must not change anything.

Guidelines:
- Investigate before answering: read the relevant files and search the code rather than guessing.
- You may run read-only shell commands, but every bash command is gated for approval. Never run a command that writes, deletes, moves, installs, or otherwise changes the system or repository state.
- Do not edit, create, or delete files. Do not run git commands that mutate state (commit, checkout, reset, push).
- Answer concisely and technically. Cite concrete file paths and line references so the user can verify.
- If a request requires changes, explain what you would change and suggest switching to build mode instead of doing it.

For clear communication, avoid using emojis.`;

// honk-plan: read-only research that ends in a structured plan submitted through the
// honk plugin's `plan_submit` tool (not free-form final text). `edit: "deny"` blocks
// all file mutation; bash stays allowed for read-only inspection (the prompt forbids
// mutating commands). This mirrors opencode's native plan agent, which denies edits and
// relies on its prompt to forbid mutating bash. The honk plugin appends a matching
// "call plan_submit exactly once" directive at request time; keeping the instruction in
// the prompt too makes the agent self-contained if the plugin is absent.
const PLAN_PROMPT = `You are a planning agent. Your job is to research this codebase and produce a concrete, actionable implementation plan. You must not modify any files or system state.

Workflow:
- Read and search the code to understand the request and the affected areas before planning. You may run read-only shell commands to inspect the repo, but never run commands that change files or system state.
- Ask the user clarifying questions when the intent or tradeoffs are ambiguous. Do not make large assumptions.

When the plan is ready, call the plan_submit tool exactly once with:
- title: a short title for the plan.
- summary: one or two sentences on the intended outcome.
- steps: an ordered list of concrete steps; each step's title names what to do, and its detail names the specific files or functions to modify and how.
- files: the repo-relative paths the plan touches (may be empty).

Do not write the plan out as prose in your message — put it entirely in the plan_submit call. After submitting, reply with a single short closing line. Do not begin implementation; planning only.

For clear communication, avoid using emojis.`;

// honk-debug: diagnosis. bash is allowed (repros, tests, log inspection) and
// edits are ask-gated (`edit: "ask"`) so a confirmed diagnosis can be verified
// with a minimal fix only after the user approves, rather than freely editing.
const DEBUG_PROMPT = `You are a debugging and diagnosis agent. Your job is to find the root cause of a problem and explain it, not to ship a finished feature. Favor evidence over speculation.

Approach:
- Reproduce and observe first: read the relevant code, run tests, inspect logs, and use shell commands to gather evidence. Bash is available for repros, tests, and inspection.
- Form a hypothesis, then confirm or falsify it with a concrete observation before concluding.
- Trace the failure to its root cause. Distinguish the underlying cause from its symptoms.

Edits are gated: you may propose a fix and, once the user approves the edit, apply a minimal targeted change to verify the diagnosis. Do not make broad or speculative edits; prefer explaining the fix and letting the user confirm.

Report the root cause, the evidence that supports it, and the recommended fix with the specific files and lines involved.

For clear communication, avoid using emojis.`;

// The mode table. `build` keeps opencode's tuned provider base prompt (prompt =
// null) and full permissions; the constrained modes install a self-contained
// prompt plus a permission posture. Exported for the renderer to import-mirror.
export const OPENCODE_MODES: readonly ModeDefinition[] = [
  {
    id: "build",
    agent: opencodeModeAgentName("build"),
    label: "Build",
    description: "Full-permission working mode: reads, runs, and edits to complete the task.",
    isDefault: isDefaultMode("build"),
    prompt: null,
    // Full working mode. Enabling the question tool matches opencode's native
    // build agent; the rest inherits opencode's `*: allow` build defaults.
    permission: { question: "allow" },
  },
  {
    id: "ask",
    agent: opencodeModeAgentName("ask"),
    label: "Ask",
    description: "Read-only Q&A: answers questions about the code without changing anything.",
    isDefault: isDefaultMode("ask"),
    prompt: ASK_PROMPT,
    permission: { edit: "deny", bash: "ask", question: "allow" },
  },
  {
    id: "plan",
    agent: opencodeModeAgentName("plan"),
    label: "Plan",
    description:
      "Read-only research that produces a concrete implementation plan as its final message.",
    isDefault: isDefaultMode("plan"),
    prompt: PLAN_PROMPT,
    permission: { edit: "deny", question: "allow" },
  },
  {
    id: "debug",
    agent: opencodeModeAgentName("debug"),
    label: "Debug",
    description:
      "Diagnosis-focused: runs repros and traces root cause; edits are gated behind approval.",
    isDefault: isDefaultMode("debug"),
    prompt: DEBUG_PROMPT,
    permission: { edit: "ask", bash: "allow", question: "allow" },
  },
];

const oracleDescription = (stop: OpencodePresetStop): string =>
  `Deep-reasoning oracle for the "${stop}" preset. Consult for architecture calls, ` +
  `tricky debugging, and verifying risky changes before acting.`;

/** Directory and entrypoint of the emitted Honk plugin. */
export const HONK_OPENCODE_PLUGIN_DIRECTORY = "honk-opencode-plugin";
export const HONK_OPENCODE_PLUGIN_ENTRY_FILE = "index.ts";

/**
 * Build the honk-managed opencode config object. Pure — no IO. The renderer sends
 * the selected mode agent by name with the preset's pinned model per prompt;
 * opencode merges this on top of the user's own config, so anything here can be
 * overridden by a nearer config.
 *
 * `honkPluginPath` is the absolute path of the emitted plugin entrypoint. It is
 * added to the plugin list as a file spec (opencode accepts absolute local paths there;
 * `isPathPluginSpec` in opencode's plugin loader). The honk plugin registers the
 * plan_submit tool, appends per-mode system directives, and backstops permissions.
 */
export function buildHonkOpencodeConfig(honkPluginPath: string): HonkOpencodeConfig {
  const agent: Record<string, OpencodeAgentConfig> = {};

  // Four mode agents (no pinned model — model comes per prompt from the preset).
  for (const mode of OPENCODE_MODES) {
    agent[mode.agent] = {
      mode: "primary",
      description: mode.description,
      ...(mode.prompt !== null ? { prompt: mode.prompt } : {}),
      permission: mode.permission,
    };
  }

  // Per-stop oracle subagents keep their pinned model bundles.
  for (const preset of OPENCODE_PRESETS) {
    agent[opencodePresetOracleName(preset.stop)] = {
      model: preset.oracle.model,
      variant: preset.oracle.variant,
      mode: "subagent",
      description: oracleDescription(preset.stop),
    };
  }

  return {
    $schema: "https://opencode.ai/config.json",
    plugin: [...OPENCODE_DEFAULT_PLUGINS, honkPluginPath],
    default_agent: opencodeModeAgentName(OPENCODE_DEFAULT_MODE),
    agent,
  };
}

export interface HonkOpencodeConfigLocation {
  /** honk-owned directory holding the generated config (never the user's dir). */
  readonly configDir: string;
  /** Absolute path of the written `opencode.json`. */
  readonly configPath: string;
  /** Absolute path of the emitted plugin module directory. */
  readonly pluginDir: string;
  /** Absolute path of the emitted plugin entrypoint (referenced by the config). */
  readonly pluginPath: string;
}

/**
 * Resolve where the honk-managed config lives. Kept under honk's own state dir so
 * it is isolated from `~/.config/opencode`; the sidecar references it via
 * `OPENCODE_CONFIG`, not by making it the global config dir.
 */
export const resolveHonkOpencodeConfigLocation = Effect.fn(
  "desktop.opencodeConfig.resolveLocation",
)(function* (input: {
  readonly stateDir: string;
}): Effect.fn.Return<HonkOpencodeConfigLocation, never, Path.Path> {
  const path = yield* Path.Path;
  const configDir = path.join(input.stateDir, "opencode");
  const pluginDir = path.join(configDir, HONK_OPENCODE_PLUGIN_DIRECTORY);
  return {
    configDir,
    configPath: path.join(configDir, "opencode.json"),
    pluginDir,
    pluginPath: path.join(pluginDir, HONK_OPENCODE_PLUGIN_ENTRY_FILE),
  };
});

/**
 * Write the honk-managed config and plugin module directory to disk. Returns the
 * location so the caller can set `OPENCODE_CONFIG`.
 *
 * The desktop main process is bundled, so the source directory does not exist at
 * runtime. The raw module manifest materializes every relative dependency before
 * publishing opencode.json, which keeps dev and packaged loading identical.
 */
export const writeHonkOpencodeConfig = Effect.fn("desktop.opencodeConfig.write")(function* (input: {
  readonly stateDir: string;
}): Effect.fn.Return<
  HonkOpencodeConfigLocation,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const location = yield* resolveHonkOpencodeConfigLocation({ stateDir: input.stateDir });
  const config = buildHonkOpencodeConfig(location.pluginPath);
  yield* fileSystem.makeDirectory(location.pluginDir, { recursive: true });
  yield* Effect.all(
    HONK_PLUGIN_MODULE_SOURCES.map(({ fileName, source }) =>
      fileSystem.writeFileString(path.join(location.pluginDir, fileName), source),
    ),
    { concurrency: "unbounded", discard: true },
  );
  yield* fileSystem.writeFileString(location.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return location;
});
