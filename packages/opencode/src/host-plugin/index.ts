// Loaded from Honk's state directory. Canonical agents plus OpenCode pairing hooks.

import {
  HONK_BASE_SYSTEM,
  HONK_MODES,
  HONK_SIDEKICK_PROMPT,
  honkModeAgentName,
  type HonkPermissionConfig,
} from "./agents";
import {
  HONK_AGENT_PAIRINGS,
  honkPairingForMain,
  honkPairingForSidekick,
  honkSidekickAgentName,
  type HonkAgentPairing,
} from "./pairing";
import { planSubmitTool } from "./plan-submit";
import type { Hooks, PermissionRule, PluginContext, PluginInput } from "./types";

const HONK_PLUGIN_ID = "honk";
const AGENT_BUILD = honkModeAgentName("build");
const AGENT_ASK = honkModeAgentName("ask");
const AGENT_PLAN = honkModeAgentName("plan");
const AGENT_DEBUG = honkModeAgentName("debug");

const READONLY_AGENTS = new Set<string>([AGENT_ASK, AGENT_PLAN]);
const NON_DELEGATING_AGENTS = new Set<string>([AGENT_ASK, AGENT_PLAN, AGENT_DEBUG]);
const EDIT_TOOLS = new Set<string>(["edit", "write", "patch", "apply_patch"]);

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
  return `Build mode: delegate scoped implementation and verification to ${honkSidekickAgentName(pairing.stop)} with the task tool, then review its work before answering.`;
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

function addPermissionRules(
  permissions: PermissionRule[],
  rules: readonly PermissionRule[],
): void {
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
        agent.system = HONK_BASE_SYSTEM;
        addPermissionRules(agent.permissions, permissionRules(mode.permission));
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
          { action: "plan_submit", resource: "*", effect: "deny" },
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
  // chat.message carries agent/model. Later hooks only see the session.
  const agentBySession = new Map<string, string>();
  const pairingBySession = new Map<string, HonkAgentPairing>();
  const sidekickSessionByParent = new Map<string, string>();
  const activeTaskCallBySession = new Map<string, string>();

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
    tool: {
      plan_submit: planSubmitTool,
    },

    async "chat.message"(input) {
      if (input.agent !== undefined) agentBySession.set(input.sessionID, input.agent);
      if (input.agent === AGENT_BUILD) {
        const pairing = honkPairingForMain(input.model, input.variant);
        if (pairing === undefined) pairingBySession.delete(input.sessionID);
        else pairingBySession.set(input.sessionID, pairing);
      }
      activeTaskCallBySession.delete(input.sessionID);
    },

    async "experimental.chat.system.transform"(input, output) {
      const agent = input.sessionID ? agentBySession.get(input.sessionID) : undefined;
      if (agent === AGENT_BUILD && input.sessionID !== undefined) {
        const pairing = pairingBySession.get(input.sessionID);
        if (pairing !== undefined) output.system.push(mainDirective(pairing));
        return;
      }

      if (honkPairingForSidekick(agent) !== undefined) {
        output.system.push(HONK_SIDEKICK_PROMPT);
        return;
      }

      const mode = HONK_MODES.find((item) => item.agent === agent);
      if (mode?.prompt !== null && mode?.prompt !== undefined) output.system.push(mode.prompt);
    },

    async "permission.ask"(input, output) {
      const agent = agentBySession.get(input.sessionID);
      if (agent !== undefined && READONLY_AGENTS.has(agent) && input.permission === "edit") {
        output.status = "deny";
      }
    },

    async "tool.execute.before"(input, output) {
      const agent = agentBySession.get(input.sessionID);
      if (agent !== undefined && READONLY_AGENTS.has(agent) && EDIT_TOOLS.has(input.tool)) {
        throw new Error(
          `honk: ${agent} is a read-only mode; the ${input.tool} tool is disabled here.`,
        );
      }
      if (input.tool !== "task") return;

      if (agent !== undefined && NON_DELEGATING_AGENTS.has(agent)) {
        throw new Error(`honk: ${agent} cannot delegate tasks in this mode.`);
      }
      if (honkPairingForSidekick(agent) !== undefined) {
        throw new Error("honk: the paired sidekick cannot delegate to another agent.");
      }
      if (agent !== AGENT_BUILD) return;

      const pairing = pairingBySession.get(input.sessionID);
      if (pairing === undefined) {
        throw new Error("honk: could not resolve the selected main/sidekick preset.");
      }
      const activeCall = activeTaskCallBySession.get(input.sessionID);
      if (activeCall !== undefined && activeCall !== input.callID) {
        throw new Error("honk: the main can run only one paired sidekick task at a time.");
      }
      activeTaskCallBySession.set(input.sessionID, input.callID);

      try {
        const args = record(output.args);
        if (args === undefined) throw new Error("honk: task arguments must be an object.");
        const sidekick = honkSidekickAgentName(pairing.stop);
        const taskID = await resolveSidekickSession(input.sessionID, sidekick);
        args.subagent_type = sidekick;
        if (taskID === undefined) delete args.task_id;
        else args.task_id = taskID;
        if (args.background === undefined) args.background = true;
      } catch (error) {
        activeTaskCallBySession.delete(input.sessionID);
        throw error;
      }
    },

    async "tool.execute.after"(input, output) {
      if (input.tool !== "task") return;
      const wasPairedCall = activeTaskCallBySession.get(input.sessionID) === input.callID;
      if (wasPairedCall) {
        activeTaskCallBySession.delete(input.sessionID);
      }

      const pairing = pairingBySession.get(input.sessionID);
      if (
        !wasPairedCall ||
        agentBySession.get(input.sessionID) !== AGENT_BUILD ||
        pairing === undefined
      ) {
        return;
      }
      const sessionID =
        stringField(output.metadata, "sessionId") ?? stringField(output.metadata, "sessionID");
      if (sessionID !== undefined) {
        const sidekick = honkSidekickAgentName(pairing.stop);
        sidekickSessionByParent.set(sidekickSessionKey(input.sessionID, sidekick), sessionID);
      }
    },

    async dispose() {
      agentBySession.clear();
      pairingBySession.clear();
      sidekickSessionByParent.clear();
      activeTaskCallBySession.clear();
    },
  };
}

export const id = HONK_PLUGIN_ID;
export default { id: HONK_PLUGIN_ID, setup, server };
