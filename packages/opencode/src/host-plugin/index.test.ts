import { defaultModels } from "@khalilgharbaoui/opencode-claude-code-plugin";
import { describe, expect, it } from "vitest";

import {
  buildHonkOpencodeConfig,
  HONK_CLAUDE_CATALOG_STABLE_GUARD_FILE,
  HONK_CLAUDE_CODE_PLUGIN,
  HONK_CLAUDE_FAST_WRAPPER_FILE,
} from "../host";
import { guardStableClaudeCatalog } from "./claude-catalog-stable-guard";
import { server, setup } from "./index";
import {
  HONK_BASE_SYSTEM,
  HONK_PRESET_AGENTS,
  HONK_PRIMARY_SYSTEM,
  HONK_SIDE_CHAT_PROMPT,
} from "./agents";
import { HONK_AGENT_PAIRINGS, honkFusionAgentName } from "./pairing";
import type {
  AgentInfo,
  PluginConfigModel,
  PluginContext,
  PluginInput,
  PluginMessageGroup,
} from "./types";

function pluginWithMessages(
  messages: readonly PluginMessageGroup[],
  parentID?: string,
  aborted?: string[],
): PluginInput {
  return {
    directory: "/repo",
    client: {
      session: {
        get: async (options) => ({
          data:
            parentID === undefined ? { id: options.path.id } : { id: options.path.id, parentID },
        }),
        messages: async () => ({ data: messages }),
        abort: async (options) => {
          aborted?.push(options.path.id);
          return { data: true };
        },
      },
    },
  };
}

async function routeAgent(plugin: PluginInput, agent: string) {
  const hooks = await server(plugin);
  await hooks["chat.message"]?.({ sessionID: "ses_parent", agent }, {});
  return hooks;
}

const FUSION_MEDIUM = honkFusionAgentName("medium");

describe("Honk main + sidekick plugin", () => {
  it("enables native compaction by default for OpenAI sessions", async () => {
    const hooks = await server(pluginWithMessages([]));
    const sessionID = "ses_native_compaction_default";
    await hooks["chat.message"]?.(
      {
        sessionID,
        model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      },
      {},
    );
    const compaction = { context: [] as string[] };
    await hooks["experimental.session.compacting"]?.({ sessionID }, compaction);
    const headers = { headers: {} as Record<string, string> };
    await hooks["chat.headers"]?.(
      {
        sessionID,
        agent: "compaction",
        model: { providerID: "openai", id: "gpt-5.6-sol" },
        provider: {},
        message: {},
      },
      headers,
    );

    expect(compaction.context.join("\n")).toContain("<honk_native_compaction_v2/>");
    expect(headers.headers["x-opencode-title"]).toBe("true");
    expect(headers.headers["x-codex-beta-features"]).toContain("remote_compaction_v2");
    await hooks.dispose?.();
  });

  it("normalizes Claude costs and adds Fast Opus after the Claude plugin authors its models", async () => {
    const hooks = await server(pluginWithMessages([]));
    const models: Record<string, PluginConfigModel> = {
      "claude-fable-5": {
        id: "claude-fable-5",
        name: "Claude Fable 5 (10×)",
        cost: { input: 0.00001, output: 0.00005, cache_read: 0.000001, cache_write: 0.0000125 },
      },
      "claude-opus-5": {
        id: "claude-opus-5",
        name: "Claude Opus 5 (5×)",
        cost: { input: 0.000005, output: 0.000025, cache_read: 0.0000005, cache_write: 0.00000625 },
        variants: { high: { reasoningEffort: "high" } },
      },
    };
    const config = {
      provider: {
        "claude-code": {
          models,
        },
      },
    };

    await hooks.config?.(config);

    expect(models["claude-fable-5"]?.cost).toEqual({
      input: 10,
      output: 50,
      cache_read: 1,
      cache_write: 12.5,
    });
    expect(models["claude-opus-5"]?.cost).toEqual({
      input: 5,
      output: 25,
      cache_read: 0.5,
      cache_write: 6.25,
    });
    expect(models["claude-opus-5-fast"]).toEqual({
      id: "claude-opus-5-fast",
      name: "Claude Opus 5 Fast (10×)",
      cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
      variants: { high: { reasoningEffort: "high" } },
    });
  });

  it("keeps the static Claude catalog for V2 but removes it before stable plugin setup", async () => {
    const models: Record<string, PluginConfigModel> = {
      "claude-opus-5": { id: "claude-opus-5" },
      "claude-opus-5-fast": { id: "claude-opus-5-fast" },
    };
    const config = { provider: { "claude-code": { models } } };
    const hooks = await guardStableClaudeCatalog(pluginWithMessages([]));

    await hooks.config?.(config);

    expect(config.provider["claude-code"].models).toBeUndefined();
  });

  it("pins fusion task calls to one paired sidekick and reuses it", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), FUSION_MEDIUM);
    const system = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_parent", model: {} },
      system,
    );
    expect(system.system.join("\n")).toContain("honk-sidekick-medium");

    const firstArgs: Record<string, unknown> = {
      description: "Implement the change",
      prompt: "Do the scoped work",
      subagent_type: "general",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args: firstArgs },
    );
    expect(firstArgs).toMatchObject({
      subagent_type: "honk-sidekick-medium",
      background: false,
    });
    expect(firstArgs).not.toHaveProperty("task_id");

    await hooks["tool.execute.after"]?.(
      {
        tool: "task",
        sessionID: "ses_parent",
        callID: "call_1",
        args: firstArgs,
      },
      {
        title: "Implement the change",
        output: "Background task started",
        metadata: { sessionId: "ses_sidekick" },
      },
    );

    const followupArgs: Record<string, unknown> = {
      description: "Run verification",
      prompt: "Verify the implementation",
      subagent_type: "explore",
      task_id: "ses_wrong",
      background: true,
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: followupArgs },
    );
    expect(followupArgs).toMatchObject({
      subagent_type: "honk-sidekick-medium",
      task_id: "ses_sidekick",
      background: true,
    });
  });

  it("lets the main choose sync or async and defaults the mode per stop", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), honkFusionAgentName("claw"));
    const defaultArgs: Record<string, unknown> = { description: "Implement", prompt: "Do it" };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args: defaultArgs },
    );
    expect(defaultArgs).toMatchObject({ subagent_type: "honk-sidekick-claw", background: true });

    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1", args: defaultArgs },
      {
        title: "Implement",
        output: "Background task started",
        metadata: { sessionId: "ses_side" },
      },
    );

    const syncArgs: Record<string, unknown> = {
      description: "Verify",
      prompt: "Check it",
      background: false,
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: syncArgs },
    );
    expect(syncArgs).toMatchObject({ background: false, task_id: "ses_side" });
  });

  it('abandons the persistent session when the main passes task_id "new"', async () => {
    const messages: readonly PluginMessageGroup[] = [
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { subagent_type: "honk-sidekick-medium" },
              metadata: { sessionId: "ses_wedged" },
            },
          },
        ],
      },
    ];
    const hooks = await routeAgent(pluginWithMessages(messages), FUSION_MEDIUM);
    const freshArgs: Record<string, unknown> = {
      description: "Restart",
      prompt: "Start over",
      task_id: "new",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args: freshArgs },
    );
    expect(freshArgs).not.toHaveProperty("task_id");

    await hooks["tool.execute.after"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1", args: freshArgs },
      { title: "Restart", output: "Background task started", metadata: { sessionId: "ses_fresh" } },
    );
    const nextArgs: Record<string, unknown> = { description: "Continue", prompt: "Go on" };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: nextArgs },
    );
    expect(nextArgs.task_id).toBe("ses_fresh");
  });

  it("stops the paired sidekick with sidekick_stop and reports it with sidekick_status", async () => {
    const aborted: string[] = [];
    const messages: readonly PluginMessageGroup[] = [
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { subagent_type: "honk-sidekick-medium" },
              metadata: { sessionId: "ses_existing" },
            },
          },
        ],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool", tool: "bash", state: { status: "running", title: "pnpm test" } }],
      },
    ];
    const hooks = await routeAgent(pluginWithMessages(messages, undefined, aborted), FUSION_MEDIUM);

    const status = await hooks.tool?.sidekick_status?.execute(
      {},
      { sessionID: "ses_parent", agent: FUSION_MEDIUM },
    );
    expect(status).toMatchObject({ metadata: { sessionID: "ses_existing", busy: true } });
    expect(typeof status === "object" && status.output).toContain("mid-turn");
    expect(typeof status === "object" && status.output).toContain(
      "[tool bash — running: pnpm test]",
    );

    const stop = await hooks.tool?.sidekick_stop?.execute(
      {},
      { sessionID: "ses_parent", agent: FUSION_MEDIUM },
    );
    expect(aborted).toEqual(["ses_existing"]);
    expect(typeof stop === "object" && stop.title).toBe("Sidekick interrupted");
  });

  it("gates sidekick tools to fusion mains with an existing sidekick", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), FUSION_MEDIUM);
    await expect(
      hooks.tool?.sidekick_status?.execute({}, { sessionID: "ses_parent", agent: "honk-build" }),
    ).rejects.toThrow(/only available to a Fusion build main/);
    await expect(
      hooks.tool?.sidekick_stop?.execute({}, { sessionID: "ses_parent", agent: FUSION_MEDIUM }),
    ).rejects.toThrow(/no sidekick session yet/);
  });

  it("recovers the persistent sidekick id from parent task history", async () => {
    const messages: readonly PluginMessageGroup[] = [
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { subagent_type: "honk-sidekick-medium" },
              metadata: { sessionId: "ses_existing" },
            },
          },
        ],
      },
    ];
    const hooks = await routeAgent(pluginWithMessages(messages), FUSION_MEDIUM);
    const args: Record<string, unknown> = {
      description: "Continue",
      prompt: "Continue the task",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args },
    );
    expect(args.task_id).toBe("ses_existing");
  });

  it("releases a failed sidekick call for a same-turn retry", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), FUSION_MEDIUM);
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args: { description: "Implement", prompt: "Do the work" } },
    );
    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "task", sessionID: "ses_parent", callID: "call_2" },
        { args: { description: "Retry", prompt: "Try again" } },
      ),
    ).rejects.toThrow(/only one paired sidekick task/);

    await hooks.event?.({
      event: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            tool: "task",
            sessionID: "ses_parent",
            callID: "call_1",
            state: { status: "error" },
          },
        },
      },
    });

    const retryArgs: Record<string, unknown> = {
      description: "Retry",
      prompt: "Try again",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: retryArgs },
    );
    expect(retryArgs).toMatchObject({
      subagent_type: "honk-sidekick-medium",
      background: false,
    });
  });

  it("releases an aborted parent sidekick call", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), FUSION_MEDIUM);
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args: { description: "Implement", prompt: "Do the work" } },
    );
    await hooks.event?.({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_parent",
          error: { name: "MessageAbortedError", data: { message: "Aborted" } },
        },
      },
    });

    const retryArgs: Record<string, unknown> = {
      description: "Retry",
      prompt: "Try again",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: retryArgs },
    );
    expect(retryArgs.background).toBe(false);
  });

  it("never attaches a sidekick to plain build and points it at preset agents", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), "honk-build");
    const system = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_parent", model: {} },
      system,
    );
    expect(system.system.join("\n")).not.toContain("honk-sidekick");

    await expect(
      hooks["tool.execute.before"]?.(
        {
          tool: "task",
          sessionID: "ses_parent",
          callID: "call_1",
        },
        { args: { description: "delegate", prompt: "do it", subagent_type: "general" } },
      ),
    ).rejects.toThrow(/can delegate only to preset agents/);

    const rosterArgs: Record<string, unknown> = {
      description: "Find call sites",
      prompt: "Locate the usages",
      subagent_type: "honk-search",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: rosterArgs },
    );
    expect(rosterArgs.subagent_type).toBe("honk-search");
    expect(rosterArgs).not.toHaveProperty("task_id");
    expect(rosterArgs).not.toHaveProperty("background");
  });

  it("lets read-only modes invoke preset agents but nothing else", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), "honk-plan");
    const rosterArgs: Record<string, unknown> = {
      description: "Consult the oracle",
      prompt: "Assess the design",
      subagent_type: "honk-oracle",
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_1" },
      { args: rosterArgs },
    );
    expect(rosterArgs.subagent_type).toBe("honk-oracle");

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "task", sessionID: "ses_parent", callID: "call_2" },
        {
          args: { description: "delegate", prompt: "do it", subagent_type: "honk-sidekick-medium" },
        },
      ),
    ).rejects.toThrow(/can delegate only to preset agents/);
  });

  it("blocks preset agents from delegating further", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), "honk-review");
    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "task", sessionID: "ses_parent", callID: "call_1" },
        { args: { description: "delegate", prompt: "do it", subagent_type: "honk-search" } },
      ),
    ).rejects.toThrow(/preset agents cannot delegate/);
  });

  it("gives preset agents their role prompt", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), "honk-search");
    const system = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_parent", model: {} },
      system,
    );
    expect(system.system).toHaveLength(1);
    expect(system.system[0]).toContain("Investigate the delegated problem");
  });

  it("injects only the active mode prompt and scopes recorded artifacts to their mode", async () => {
    const hooks = await server(pluginWithMessages([]));

    await hooks["chat.message"]?.({ sessionID: "ses_ask", agent: "honk-ask" }, {});
    const askSystem = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_ask", model: {} },
      askSystem,
    );
    expect(askSystem.system).toEqual([
      "Ask mode: investigate the codebase without modifying files or system state, then answer concisely with concrete file references.",
    ]);

    await hooks["chat.message"]?.({ sessionID: "ses_plan", agent: "honk-plan" }, {});
    const planSystem = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_plan", model: {} },
      planSystem,
    );
    expect(planSystem.system).toHaveLength(1);
    expect(planSystem.system[0]).toContain("`honk_plan_submit`");

    await hooks["chat.message"]?.({ sessionID: "ses_debug", agent: "honk-debug" }, {});
    const debugSystem = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_debug", model: {} },
      debugSystem,
    );
    expect(debugSystem.system).toHaveLength(1);
    expect(debugSystem.system[0]).toContain("`honk_debug_submit`");

    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts");
    expect(config.agent["honk-plan"]?.permission?.honk_plan_submit).toBe("allow");
    expect(config.agent["honk-debug"]?.permission?.honk_debug_submit).toBe("allow");
    for (const mode of ["build", "ask", "debug"]) {
      expect(config.agent[`honk-${mode}`]?.permission?.honk_plan_submit).toBe("deny");
    }
    for (const mode of ["build", "ask", "plan"]) {
      expect(config.agent[`honk-${mode}`]?.permission?.honk_debug_submit).toBe("deny");
    }
  });

  it("registers the same paired agents through the canonical transform", async () => {
    const agents = new Map<string, AgentInfo>();
    const context: PluginContext = {
      agent: {
        transform: async (update) => {
          update({
            update(id, mutate) {
              const agent =
                agents.get(id) ??
                ({ id, mode: "all", hidden: false, permissions: [] } satisfies AgentInfo);
              mutate(agent);
              agents.set(id, agent);
            },
          });
        },
      },
    };

    await setup(context);
    await setup(context);

    // 4 modes + 5 fusion primaries + 5 sidekicks + 6 preset agents.
    expect(agents).toHaveLength(20);
    for (const agent of agents.values()) {
      const isVisiblePrimary = agent.mode === "primary" && agent.hidden === false;
      expect(agent.system).toBe(isVisiblePrimary ? HONK_PRIMARY_SYSTEM : HONK_BASE_SYSTEM);
    }
    expect(agents.get("honk-sidekick-medium")).toMatchObject({
      hidden: true,
      mode: "subagent",
      model: {
        providerID: "openai",
        id: "gpt-5.6-sol",
        variant: "medium",
      },
    });
    expect(agents.get("honk-sidekick-low")?.model).toMatchObject({
      providerID: "opencode-go",
      id: "glm-5.2",
    });
    expect(agents.get(FUSION_MEDIUM)).toMatchObject({ mode: "primary", hidden: false });
    expect(agents.get("honk-oracle")).toMatchObject({ mode: "subagent", hidden: false });
    expect(
      agents
        .get("honk-oracle")
        ?.permissions.some((rule) => rule.action === "edit" && rule.effect === "deny"),
    ).toBe(true);
    expect(
      agents
        .get("honk-sidekick-medium")
        ?.permissions.filter((rule) => rule.action === "task" && rule.effect === "deny"),
    ).toHaveLength(1);
    expect(
      agents
        .get("honk-sidekick-medium")
        ?.permissions.some((rule) => rule.action === "honk_plan_submit" && rule.effect === "deny"),
    ).toBe(true);
    expect(
      agents
        .get("honk-sidekick-medium")
        ?.permissions.some((rule) => rule.action === "parent_chat" && rule.effect === "deny"),
    ).toBe(true);
  });

  it("registers the parent_chat and sidekick lifecycle tools", async () => {
    const hooks = await server(pluginWithMessages([]));
    expect(hooks.tool?.parent_chat).toBeDefined();
    // plan_submit and debug_submit moved to the honk MCP server so every provider arm sees them.
    expect(hooks.tool?.plan_submit).toBeUndefined();
    expect(hooks.tool?.debug_submit).toBeUndefined();
    expect(hooks.tool?.sidekick_status).toBeDefined();
    expect(hooks.tool?.sidekick_stop).toBeDefined();
  });

  it("gives a fusion side chat the side-chat prompt and not the delegation directive", async () => {
    const hooks = await routeAgent(pluginWithMessages([], "ses_parent_root"), FUSION_MEDIUM);
    const system = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_parent", model: {} },
      system,
    );
    const joined = system.system.join("\n");
    expect(joined).toBe(HONK_SIDE_CHAT_PROMPT);
    expect(joined).not.toContain("honk-sidekick-medium");
    expect(joined).not.toContain("Build mode: delegate");
  });

  it("keeps the delegation directive for a fusion session that is not a side chat", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), FUSION_MEDIUM);
    const system = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_parent", model: {} },
      system,
    );
    const joined = system.system.join("\n");
    expect(joined).toContain("honk-sidekick-medium");
    expect(joined).toContain("You own the TodoWrite plan tracker");
    expect(joined).toContain("never collapsing unrelated requests");
    expect(joined).not.toContain(HONK_SIDE_CHAT_PROMPT);
  });

  it("gives the claw main the aggressive delegation directive toward Opus", async () => {
    const hooks = await routeAgent(pluginWithMessages([]), honkFusionAgentName("claw"));
    const system = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses_parent", model: {} },
      system,
    );
    const joined = system.system.join("\n");
    expect(joined).toContain("honk-sidekick-claw");
    expect(joined).toContain("orchestrate, don't implement");
    expect(joined).toContain("You own the TodoWrite plan tracker");
    expect(joined).not.toBe(HONK_SIDE_CHAT_PROMPT);
  });

  it("blocks side chats from delegating with the task tool", async () => {
    const hooks = await routeAgent(pluginWithMessages([], "ses_parent_root"), FUSION_MEDIUM);
    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "task", sessionID: "ses_parent", callID: "call_1" },
        { args: { description: "delegate", prompt: "do it" } },
      ),
    ).rejects.toThrow(/side chats cannot delegate/);
  });

  it("declares the honk MCP server only when a server command is supplied", () => {
    expect(buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts").mcp).toBeUndefined();

    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts", {
      mcpServerCommand: ["/bin/opencode", "/state/honk-opencode-plugin/mcp-server.mjs"],
    });
    expect(config.mcp?.honk).toEqual({
      type: "local",
      command: ["/bin/opencode", "/state/honk-opencode-plugin/mcp-server.mjs"],
      environment: { BUN_BE_BUN: "1" },
      enabled: true,
    });
  });

  it("preserves user MCP servers without allowing the built-in server to be replaced", () => {
    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts", {
      mcp: {
        linear: { type: "remote", url: "https://mcp.linear.app/sse" },
        legacy: { enabled: false },
        honk: { type: "local", command: ["/tmp/not-honk"] },
      },
      mcpServerCommand: ["/bin/opencode", "/state/honk-opencode-plugin/mcp-server.mjs"],
    });

    expect(config.mcp?.linear).toEqual({
      type: "remote",
      url: "https://mcp.linear.app/sse",
    });
    expect(config.mcp?.legacy).toEqual({ enabled: false });
    expect(config.mcp?.honk).toEqual({
      type: "local",
      command: ["/bin/opencode", "/state/honk-opencode-plugin/mcp-server.mjs"],
      environment: { BUN_BE_BUN: "1" },
      enabled: true,
    });
  });

  it("allows the external-directory permission no unattended subagent could answer", () => {
    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts");
    expect(config.permission).toEqual({ external_directory: "allow" });
    // Global rules merge before each agent's own block, so an agent-level override would
    // silently reinstate the deadlock.
    for (const agent of Object.values(config.agent)) {
      expect(agent.permission?.external_directory).toBeUndefined();
    }
  });

  it("denies parent control tools to every implementation and preset subagent", () => {
    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts");
    const subagents = Object.keys(config.agent).filter(
      (key) =>
        key.startsWith("honk-sidekick-") ||
        HONK_PRESET_AGENTS.some((preset) => preset.agent === key),
    );
    expect(subagents.length).toBe(HONK_AGENT_PAIRINGS.length + HONK_PRESET_AGENTS.length);
    for (const name of subagents) {
      expect(config.agent[name]?.permission?.parent_chat).toBe("deny");
      expect(config.agent[name]?.permission?.sidekick_status).toBe("deny");
      expect(config.agent[name]?.permission?.sidekick_stop).toBe("deny");
    }
  });

  it("authors fusion primaries, the roster, and the title model", () => {
    // Stops may share a main model (low and medium both run Sol high) — the
    // fusion agent name, not the model, is what identifies the stop (ADR 0001).
    const fusionNames = HONK_AGENT_PAIRINGS.map((pairing) => honkFusionAgentName(pairing.stop));
    expect(new Set(fusionNames).size).toBe(HONK_AGENT_PAIRINGS.length);

    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts");
    for (const name of fusionNames) {
      expect(config.agent[name]).toMatchObject({ mode: "primary" });
      expect(config.agent[name]?.model).toBeUndefined();
    }
    expect(
      Object.keys(config.agent).filter((name) => name.startsWith("honk-sidekick-")),
    ).toHaveLength(5);
    expect(config.agent["honk-sidekick-claw"]).toMatchObject({
      model: "claude-code/claude-opus-5",
      variant: "high",
    });
    expect(config.agent["honk-sidekick-low"]).toMatchObject({
      model: "opencode-go/glm-5.2",
      variant: "medium",
    });
    expect(config.agent["honk-sidekick-medium"]).toMatchObject({
      mode: "subagent",
      hidden: true,
      model: "openai/gpt-5.6-sol",
      variant: "medium",
      prompt: HONK_BASE_SYSTEM,
      permission: { honk_plan_submit: "deny" },
    });
    expect(config.agent["honk-oracle"]).toMatchObject({
      mode: "subagent",
      model: "openai/gpt-5.6-sol",
      permission: { edit: "deny", task: "deny" },
    });
    expect(config.agent["honk-review"]?.model).toBe("openai/gpt-5.5");
    expect(config.agent["honk-search"]).toMatchObject({
      model: "openai/gpt-5.6-luna",
      variant: "max",
    });
    expect(config.agent["honk-read-thread"]?.model).toBe("opencode-go/glm-5.2");
    expect(config.small_model).toBe("openai/gpt-5.6-luna");
    expect(config.agent.title).toEqual({
      model: "openai/gpt-5.6-luna",
    });
  });

  it("pins a provider that admits every configured Claude model", () => {
    const claudeCliPath = `/state/honk-opencode-plugin/${HONK_CLAUDE_FAST_WRAPPER_FILE}`;
    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts", {
      claudeCliPath,
    });
    expect(config.plugin).toContain(HONK_CLAUDE_CODE_PLUGIN);
    expect(config.plugin).toEqual([
      `/state/honk-opencode-plugin/${HONK_CLAUDE_CATALOG_STABLE_GUARD_FILE}`,
      HONK_CLAUDE_CODE_PLUGIN,
      "/state/honk-opencode-plugin/index.ts",
    ]);
    expect(config.provider["claude-code"]?.options).toMatchObject({
      cliPath: claudeCliPath,
      ignoreAnthropicApiKey: true,
      skipPermissions: true,
      controlRequestBehavior: "allow",
      proxyTools: ["bash", "edit", "write", "webfetch", "task", "question"],
      proxyToolTimeoutMs: { task: 60 * 60 * 1000, question: 60 * 60 * 1000 },
    });
    expect(config.provider["claude-code"]?.npm).toBe(HONK_CLAUDE_CODE_PLUGIN);
    expect(config.provider["claude-code"]?.models?.["claude-opus-5-fast"]).toMatchObject({
      id: "claude-opus-5-fast",
      cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
      modalities: { input: ["text", "image"], output: ["text"] },
      variants: { high: { reasoningEffort: "high" } },
    });

    const models = [
      ...HONK_AGENT_PAIRINGS.flatMap((pairing) => [pairing.main, pairing.sidekick]),
      ...HONK_PRESET_AGENTS.map((preset) => preset.model),
    ].filter((model) => model.providerID === "claude-code");

    for (const model of models) {
      expect(
        defaultModels[model.id],
        `${model.id} is missing from the Claude provider`,
      ).toBeDefined();
    }
  });
});
