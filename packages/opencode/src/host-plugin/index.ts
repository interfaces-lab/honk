// Loaded from Honk's state directory. Canonical agents plus OpenCode pairing hooks.

import {
  HONK_BASE_SYSTEM,
  HONK_FUSION_AGENTS,
  HONK_MODES,
  HONK_PRESET_AGENTS,
  HONK_PRIMARY_SYSTEM,
  HONK_SIDE_CHAT_PROMPT,
  HONK_SIDEKICK_PROMPT,
  honkModeAgentName,
  honkPresetAgentByName,
  type HonkPermissionConfig,
} from "./agents";
import {
  HONK_AGENT_PAIRINGS,
  HONK_CLAUDE_MODEL_COSTS,
  HONK_MODEL_IDS,
  honkPairingForFusionAgent,
  honkPairingForSidekick,
  honkSidekickAgentName,
  type HonkAgentPairing,
} from "./pairing";
import { createParentChatTool } from "./parent-chat";
import { createNativeCompactionRuntime } from "./native-compaction";
import { syncPlanTodoIDs } from "./plan-todo-sync";
import { createSidekickTools } from "./sidekick-tools";
import { terminalTools } from "./terminal-tools";
import type { Hooks, PermissionRule, PluginContext, PluginInput } from "./types";

const HONK_PLUGIN_ID = "honk";
const AGENT_BUILD = honkModeAgentName("build");
const AGENT_ASK = honkModeAgentName("ask");
const AGENT_PLAN = honkModeAgentName("plan");
const AGENT_DEBUG = honkModeAgentName("debug");

const NON_EDITING_AGENTS = new Set<string>([AGENT_ASK, AGENT_PLAN, AGENT_DEBUG]);
// Side chats inherit their parent's primary mode agent; sidekick task sessions do not.
const PRIMARY_MODE_AGENTS = new Set<string>([
  ...HONK_MODES.map((mode) => mode.agent),
  ...HONK_FUSION_AGENTS.map((fusion) => fusion.agent),
]);
const EDIT_TOOLS = new Set<string>(["edit", "write", "patch", "apply_patch"]);
const PRESET_AGENT_NAMES = HONK_PRESET_AGENTS.map((definition) => definition.agent).join(", ");

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = record(value)?.[key];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function mainDirective(pairing: HonkAgentPairing): string {
  const sidekick = honkSidekickAgentName(pairing.stop);
  const modeGuidance = `You choose each task's mode: background: true runs async so you keep orchestrating while it works (monitor with sidekick_status, interrupt with sidekick_stop); background: false waits for the result when your next decision depends on it. Unspecified tasks default to ${pairing.defaultBackground ? "async" : "sync"}. Pass task_id: "new" only to abandon a wedged or context-poisoned sidekick session; otherwise the persistent session keeps its cache.`;
  // Gated on multiple tasks so a one-line request does not pay for plan-tracker ceremony.
  const planGuidance =
    "You own the TodoWrite plan tracker. When the prompt carries several requested tasks or an attached plan, initialize it with one item per entry, never collapsing unrelated requests into one; update it as each result lands, and do not finish while any item is still pending or in_progress.";
  // Claw pairs Fable with Opus and pushes delegation much harder: the main
  // stays an orchestrator and Opus does the hands-on work by default.
  if (pairing.stop === "claw") {
    return `Build mode: orchestrate, don't implement. Delegate every implementation, investigation, and verification task to ${sidekick} with the task tool by default — including work you could do yourself — and keep only decomposition, review, and integration. When the judgment is the deliverable — subtle product intent, a design call, the final review — do that part yourself. ${modeGuidance} Review the sidekick's work before answering. ${planGuidance}`;
  }
  return `Build mode: delegate scoped implementation and verification to ${sidekick} with the task tool, then review its work before answering. ${modeGuidance} ${planGuidance}`;
}

function permissionRules(permission: HonkPermissionConfig): PermissionRule[] {
  const rules: PermissionRule[] = [];
  for (const [action, rule] of Object.entries(permission)) {
    if (typeof rule === "string") {
      rules.push({ action, resource: "*", effect: rule });
      continue;
    }
    for (const [resource, effect] of Object.entries(rule)) {
      rules.push({ action, resource, effect });
    }
  }
  return rules;
}

function addPermissionRules(permissions: PermissionRule[], rules: readonly PermissionRule[]): void {
  for (const rule of rules) {
    const exists = permissions.some(
      (current) =>
        current.action === rule.action &&
        current.resource === rule.resource &&
        current.effect === rule.effect,
    );
    if (!exists) permissions.push(rule);
  }
}

export async function setup(context: PluginContext): Promise<void> {
  await context.agent.transform((draft) => {
    for (const mode of HONK_MODES) {
      draft.update(mode.agent, (agent) => {
        agent.description = mode.description;
        agent.mode = "primary";
        agent.hidden = false;
        agent.system = HONK_PRIMARY_SYSTEM;
        addPermissionRules(agent.permissions, permissionRules(mode.permission));
      });
    }

    for (const fusion of HONK_FUSION_AGENTS) {
      draft.update(fusion.agent, (agent) => {
        agent.description = fusion.description;
        agent.mode = "primary";
        agent.hidden = false;
        agent.system = HONK_PRIMARY_SYSTEM;
        addPermissionRules(agent.permissions, permissionRules(fusion.permission));
      });
    }

    for (const pairing of HONK_AGENT_PAIRINGS) {
      draft.update(honkSidekickAgentName(pairing.stop), (agent) => {
        agent.model = pairing.sidekick;
        agent.system = HONK_BASE_SYSTEM;
        agent.description = `Persistent execution sidekick for the ${pairing.stop} preset.`;
        agent.mode = "subagent";
        agent.hidden = true;
        addPermissionRules(agent.permissions, [
          { action: "task", resource: "*", effect: "deny" },
          { action: "todowrite", resource: "*", effect: "deny" },
          { action: "honk_plan_submit", resource: "*", effect: "deny" },
          { action: "honk_debug_submit", resource: "*", effect: "deny" },
          { action: "parent_chat", resource: "*", effect: "deny" },
          { action: "sidekick_status", resource: "*", effect: "deny" },
          { action: "sidekick_stop", resource: "*", effect: "deny" },
        ]);
      });
    }

    for (const preset of HONK_PRESET_AGENTS) {
      draft.update(preset.agent, (agent) => {
        agent.model = preset.model;
        agent.system = HONK_BASE_SYSTEM;
        agent.description = preset.description;
        agent.mode = "subagent";
        agent.hidden = false;
        addPermissionRules(agent.permissions, [
          { action: "edit", resource: "*", effect: "deny" },
          { action: "task", resource: "*", effect: "deny" },
          { action: "todowrite", resource: "*", effect: "deny" },
          { action: "honk_plan_submit", resource: "*", effect: "deny" },
          { action: "honk_debug_submit", resource: "*", effect: "deny" },
          { action: "parent_chat", resource: "*", effect: "deny" },
          { action: "sidekick_status", resource: "*", effect: "deny" },
          { action: "sidekick_stop", resource: "*", effect: "deny" },
        ]);
      });
    }
  });
}

function sidekickSessionFromPart(
  part: Readonly<Record<string, unknown>>,
  sidekick: string,
): string | undefined {
  if (part.type !== "tool" || part.tool !== "task") return undefined;
  const state = record(part.state);
  const input = record(state?.input);
  if (input?.subagent_type !== sidekick) return undefined;

  const metadata = record(state?.metadata) ?? record(part.metadata);
  return (
    stringField(metadata, "sessionId") ??
    stringField(metadata, "sessionID") ??
    stringField(input, "task_id")
  );
}

async function findSidekickSession(
  plugin: PluginInput,
  parentSessionID: string,
  sidekick: string,
): Promise<string | undefined> {
  const result = await plugin.client.session.messages({
    path: { id: parentSessionID },
    query: { directory: plugin.directory },
  });
  if (result.data === undefined) {
    throw new Error("honk: failed to inspect the parent session for its paired sidekick.");
  }

  for (const message of [...result.data].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const sessionID = sidekickSessionFromPart(part, sidekick);
      if (sessionID !== undefined) return sessionID;
    }
  }
  return undefined;
}

function sidekickSessionKey(parentSessionID: string, sidekick: string): string {
  return `${parentSessionID}:${sidekick}`;
}

export async function server(plugin: PluginInput): Promise<Hooks> {
  const nativeCompaction = createNativeCompactionRuntime(plugin);
  // chat.message carries the agent. Later hooks only see the session.
  const agentBySession = new Map<string, string>();
  const sidekickSessionByParent = new Map<string, string>();
  const activeTaskCallBySession = new Map<string, string>();
  // parentID needs an API round-trip, so cache whether a session is a side chat once resolved.
  const sideChatBySession = new Map<string, boolean>();

  const resolveSideChat = async (sessionID: string, agent: string | undefined): Promise<void> => {
    if (agent === undefined || !PRIMARY_MODE_AGENTS.has(agent)) return;
    if (sideChatBySession.has(sessionID)) return;
    const result = await plugin.client.session.get({
      path: { id: sessionID },
      query: { directory: plugin.directory },
    });
    sideChatBySession.set(
      sessionID,
      typeof result.data?.parentID === "string" && result.data.parentID.length > 0,
    );
  };

  const resolveSidekickSession = async (
    parentSessionID: string,
    sidekick: string,
  ): Promise<string | undefined> => {
    const key = sidekickSessionKey(parentSessionID, sidekick);
    const cached = sidekickSessionByParent.get(key);
    if (cached !== undefined) return cached;
    const recovered = await findSidekickSession(plugin, parentSessionID, sidekick);
    if (recovered !== undefined) sidekickSessionByParent.set(key, recovered);
    return recovered;
  };

  return {
    async config(config) {
      const models = config.provider?.[HONK_MODEL_IDS.opus5.providerID]?.models;
      if (models === undefined) return;

      const fable = models[HONK_MODEL_IDS.fable5.id];
      if (fable !== undefined) {
        models[HONK_MODEL_IDS.fable5.id] = {
          ...fable,
          cost: {
            ...fable.cost,
            input: HONK_CLAUDE_MODEL_COSTS.fable5.input,
            output: HONK_CLAUDE_MODEL_COSTS.fable5.output,
            cache_read: HONK_CLAUDE_MODEL_COSTS.fable5.cacheRead,
            cache_write: HONK_CLAUDE_MODEL_COSTS.fable5.cacheWrite,
          },
        };
      }

      const opus = models[HONK_MODEL_IDS.opus5.id];
      if (opus === undefined) return;
      const normalizedOpus = {
        ...opus,
        cost: {
          ...opus.cost,
          input: HONK_CLAUDE_MODEL_COSTS.opus5.input,
          output: HONK_CLAUDE_MODEL_COSTS.opus5.output,
          cache_read: HONK_CLAUDE_MODEL_COSTS.opus5.cacheRead,
          cache_write: HONK_CLAUDE_MODEL_COSTS.opus5.cacheWrite,
        },
      };
      models[HONK_MODEL_IDS.opus5.id] = normalizedOpus;

      models[HONK_MODEL_IDS.opus5Fast.id] = {
        ...normalizedOpus,
        id: HONK_MODEL_IDS.opus5Fast.id,
        name: "Claude Opus 5 Fast (10×)",
        cost: {
          ...opus.cost,
          input: HONK_CLAUDE_MODEL_COSTS.opus5Fast.input,
          output: HONK_CLAUDE_MODEL_COSTS.opus5Fast.output,
          cache_read: HONK_CLAUDE_MODEL_COSTS.opus5Fast.cacheRead,
          cache_write: HONK_CLAUDE_MODEL_COSTS.opus5Fast.cacheWrite,
        },
      };
    },

    tool: {
      parent_chat: createParentChatTool(plugin),
      ...terminalTools,
      ...createSidekickTools(plugin, resolveSidekickSession),
    },

    async event(input) {
      const properties = record(input.event.properties);
      if (input.event.type === "session.deleted") {
        const sessionID = stringField(properties?.info, "id");
        if (sessionID !== undefined) nativeCompaction.remove(sessionID);
        return;
      }
      if (input.event.type === "session.compacted") {
        const sessionID = stringField(properties, "sessionID");
        if (sessionID !== undefined) nativeCompaction.complete(sessionID);
        return;
      }
      if (input.event.type === "session.error") {
        const sessionID = stringField(properties, "sessionID");
        if (sessionID !== undefined) {
          nativeCompaction.fail(sessionID);
          activeTaskCallBySession.delete(sessionID);
        }
        return;
      }
      if (input.event.type !== "message.part.updated") return;

      const part = record(properties?.part);
      const state = record(part?.state);
      if (part?.type !== "tool" || part.tool !== "task" || state?.status !== "error") return;

      const sessionID = stringField(part, "sessionID");
      const callID = stringField(part, "callID");
      if (sessionID !== undefined && activeTaskCallBySession.get(sessionID) === callID) {
        activeTaskCallBySession.delete(sessionID);
      }
    },

    async "chat.message"(input) {
      if (input.agent !== undefined) agentBySession.set(input.sessionID, input.agent);
      await nativeCompaction.observeMessage(input);
      // Resolve (once) whether this is a side chat so later hooks stay off the API hot path.
      await resolveSideChat(input.sessionID, input.agent);
      activeTaskCallBySession.delete(input.sessionID);
    },

    async "chat.headers"(input, output) {
      await nativeCompaction.prepareHeaders(input, output);
    },

    async "experimental.session.compacting"(input, output) {
      await nativeCompaction.prepareCompaction(input.sessionID, output);
    },

    async "experimental.chat.system.transform"(input, output) {
      const agent = input.sessionID ? agentBySession.get(input.sessionID) : undefined;
      const isSideChat =
        input.sessionID !== undefined && sideChatBySession.get(input.sessionID) === true;
      const fusionPairing = honkPairingForFusionAgent(agent);

      if ((agent === AGENT_BUILD || fusionPairing !== undefined) && input.sessionID !== undefined) {
        // A side chat must never be told to delegate to a sidekick; it stays in-thread.
        if (isSideChat) {
          output.system.push(HONK_SIDE_CHAT_PROMPT);
          return;
        }
        if (fusionPairing !== undefined) output.system.push(mainDirective(fusionPairing));
        return;
      }

      if (honkPairingForSidekick(agent) !== undefined) {
        output.system.push(HONK_SIDEKICK_PROMPT);
        return;
      }

      const presetAgent = honkPresetAgentByName(agent);
      if (presetAgent !== undefined) {
        output.system.push(presetAgent.prompt);
        return;
      }

      const mode = HONK_MODES.find((item) => item.agent === agent);
      if (mode?.prompt !== null && mode?.prompt !== undefined) output.system.push(mode.prompt);
      if (isSideChat) output.system.push(HONK_SIDE_CHAT_PROMPT);
    },

    async "permission.ask"(input, output) {
      const agent = agentBySession.get(input.sessionID);
      if (agent !== undefined && NON_EDITING_AGENTS.has(agent) && input.permission === "edit") {
        output.status = "deny";
      }
    },

    async "tool.execute.before"(input, output) {
      const agent = agentBySession.get(input.sessionID);
      if (agent !== undefined && NON_EDITING_AGENTS.has(agent) && EDIT_TOOLS.has(input.tool)) {
        throw new Error(
          `honk: ${agent} does not edit directly; the ${input.tool} tool is disabled here.`,
        );
      }
      if (input.tool !== "task") return;

      if (sideChatBySession.get(input.sessionID) === true) {
        throw new Error(
          "honk: side chats cannot delegate; answer in this thread or use parent_chat to consult the parent conversation.",
        );
      }
      if (agent === undefined) return;
      if (honkPairingForSidekick(agent) !== undefined) {
        throw new Error("honk: the paired sidekick cannot delegate to another agent.");
      }
      if (honkPresetAgentByName(agent) !== undefined) {
        throw new Error("honk: preset agents cannot delegate to other agents.");
      }
      if (!PRIMARY_MODE_AGENTS.has(agent)) return;

      const args = record(output.args);
      if (args === undefined) throw new Error("honk: task arguments must be an object.");

      // Preset agents pass through untouched for every primary mode.
      const requested = args.subagent_type;
      if (typeof requested === "string" && honkPresetAgentByName(requested) !== undefined) return;

      const pairing = honkPairingForFusionAgent(agent);
      if (pairing === undefined) {
        throw new Error(
          `honk: ${agent} can delegate only to preset agents (${PRESET_AGENT_NAMES}).`,
        );
      }

      const activeCall = activeTaskCallBySession.get(input.sessionID);
      if (activeCall !== undefined && activeCall !== input.callID) {
        throw new Error("honk: the main can run only one paired sidekick task at a time.");
      }
      activeTaskCallBySession.set(input.sessionID, input.callID);

      try {
        const sidekick = honkSidekickAgentName(pairing.stop);
        // task_id: "new" abandons the persistent session (wedged, or poisoned context);
        // the fresh session recorded by tool.execute.after becomes the persistent one.
        const fresh = args.task_id === "new";
        if (fresh) sidekickSessionByParent.delete(sidekickSessionKey(input.sessionID, sidekick));
        const taskID = fresh ? undefined : await resolveSidekickSession(input.sessionID, sidekick);
        args.subagent_type = sidekick;
        if (taskID === undefined) delete args.task_id;
        else args.task_id = taskID;
        // The main chooses sync vs async per task; the stop only supplies the default.
        if (typeof args.background !== "boolean") args.background = pairing.defaultBackground;
      } catch (error) {
        activeTaskCallBySession.delete(input.sessionID);
        throw error;
      }
    },

    async "tool.execute.after"(input, output) {
      if (input.tool === "todowrite" || input.tool === "todoread") {
        await syncPlanTodoIDs(plugin, input.sessionID, input.args, output);
        return;
      }
      if (input.tool !== "task") return;
      const wasPairedCall = activeTaskCallBySession.get(input.sessionID) === input.callID;
      if (wasPairedCall) {
        activeTaskCallBySession.delete(input.sessionID);
      }

      const pairing = honkPairingForFusionAgent(agentBySession.get(input.sessionID));
      if (!wasPairedCall || pairing === undefined) return;

      const sessionID =
        stringField(output.metadata, "sessionId") ?? stringField(output.metadata, "sessionID");
      if (sessionID !== undefined) {
        const sidekick = honkSidekickAgentName(pairing.stop);
        sidekickSessionByParent.set(sidekickSessionKey(input.sessionID, sidekick), sessionID);
      }
    },

    async dispose() {
      nativeCompaction.dispose();
      agentBySession.clear();
      sidekickSessionByParent.clear();
      activeTaskCallBySession.clear();
      sideChatBySession.clear();
    },
  };
}

export const id = HONK_PLUGIN_ID;
export default { id: HONK_PLUGIN_ID, setup, server };
