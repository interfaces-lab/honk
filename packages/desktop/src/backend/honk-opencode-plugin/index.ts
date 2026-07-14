// OpenCode imports this entrypoint from Honk's generated state directory. The
// desktop emitter writes this file and every relative module together; bare package
// imports remain forbidden because that directory has no node_modules ancestor.
// The v1 hook surface is intentional: v2 does not expose these tool and policy hooks.

import { createParentChatTool } from "./parent-chat";
import { planSubmitTool } from "./plan-submit";
import type { Hooks, PluginInput } from "./types";

const HONK_PLUGIN_ID = "honk";

// Keep these stable keys aligned with opencodeModeAgentName in opencode-config.ts.
const AGENT_BUILD = "honk-build";
const AGENT_ASK = "honk-ask";
const AGENT_PLAN = "honk-plan";
const AGENT_DEBUG = "honk-debug";

const READONLY_AGENTS = new Set<string>([AGENT_ASK, AGENT_PLAN]);
const EDIT_TOOLS = new Set<string>(["edit", "write", "patch", "apply_patch"]);

const DIRECTIVES: Readonly<Record<string, string>> = {
  [AGENT_BUILD]:
    "honk build mode: you are the full-permission working agent. Complete the task end to end — read, run, and edit as needed — then verify your change. Keep edits minimal and focused.",
  [AGENT_ASK]:
    "honk ask mode: strictly read-only. Do not modify files or system state. Answer concisely and cite concrete file paths and line references.",
  [AGENT_PLAN]:
    "honk plan mode: investigate the codebase read-only, then call the plan_submit tool exactly once with the finished implementation plan. After you have submitted the plan, your final text should be one short closing line — do not restate the plan.",
  [AGENT_DEBUG]:
    "honk debug mode: reproduce and observe before concluding. Trace the failure to its root cause; propose a fix and apply only a minimal, approved edit to verify it.",
};

function carriesSideChatGuardrail(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  const message = Reflect.get(output, "message");
  if (typeof message !== "object" || message === null) return false;
  const system = Reflect.get(message, "system");
  return typeof system === "string" && system.includes("<side_chat_guardrail>");
}

async function server(plugin: PluginInput): Promise<Hooks> {
  // chat.message carries the prompt's agent, while the later policy hooks do not.
  const agentBySession = new Map<string, string>();
  const sideChatSessions = new Set<string>();

  return {
    tool: {
      parent_chat: createParentChatTool(plugin),
      plan_submit: planSubmitTool,
    },

    async "chat.message"(input, output) {
      if (input.agent) agentBySession.set(input.sessionID, input.agent);
      if (carriesSideChatGuardrail(output)) sideChatSessions.add(input.sessionID);
    },

    async "experimental.chat.system.transform"(input, output) {
      const agent = input.sessionID ? agentBySession.get(input.sessionID) : undefined;
      if (agent === AGENT_BUILD && input.sessionID && sideChatSessions.has(input.sessionID)) {
        // The per-prompt guardrail owns side-chat posture; the general build directive
        // would otherwise reintroduce an instruction to edit.
        return;
      }
      const directive = agent ? DIRECTIVES[agent] : undefined;
      if (directive) output.system.push(directive);
    },

    // The generated config is the live read-only permission layer. This hook is a
    // forward-compatible backstop for OpenCode versions that dispatch permission.ask.
    async "permission.ask"(input, output) {
      const agent = agentBySession.get(input.sessionID);
      if (agent && READONLY_AGENTS.has(agent) && input.permission === "edit") {
        output.status = "deny";
      }
    },

    async "tool.execute.before"(input) {
      const agent = agentBySession.get(input.sessionID);
      if (agent && READONLY_AGENTS.has(agent) && EDIT_TOOLS.has(input.tool)) {
        throw new Error(
          `honk: ${agent} is a read-only mode; the ${input.tool} tool is disabled here.`,
        );
      }
    },

    async dispose() {
      agentBySession.clear();
      sideChatSessions.clear();
    },
  };
}

export const id = HONK_PLUGIN_ID;
export { server };
export default { id: HONK_PLUGIN_ID, server };
