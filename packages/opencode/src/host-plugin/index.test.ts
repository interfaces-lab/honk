import { describe, expect, it } from "vitest";

import { buildHonkOpencodeConfig } from "../host";
import { server, setup } from "./index";
import { HONK_AGENT_PAIRINGS } from "./pairing";
import type { AgentInfo, PluginContext, PluginInput, PluginMessageGroup } from "./types";

function pluginWithMessages(messages: readonly PluginMessageGroup[]): PluginInput {
  return {
    directory: "/repo",
    client: {
      session: {
        messages: async () => ({ data: messages }),
      },
    },
  };
}

async function routeMediumMain(plugin: PluginInput) {
  const hooks = await server(plugin);
  await hooks["chat.message"]?.(
    {
      sessionID: "ses_parent",
      agent: "honk-build",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      variant: "high",
    },
    {},
  );
  return hooks;
}

describe("Honk main + sidekick plugin", () => {
  it("pins task calls to one paired background sidekick and reuses it", async () => {
    const hooks = await routeMediumMain(pluginWithMessages([]));
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
      background: true,
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
      background: false,
    };
    await hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "ses_parent", callID: "call_2" },
      { args: followupArgs },
    );
    expect(followupArgs).toMatchObject({
      subagent_type: "honk-sidekick-medium",
      task_id: "ses_sidekick",
      background: false,
    });
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
    const hooks = await routeMediumMain(pluginWithMessages(messages));
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

    expect(agents).toHaveLength(8);
    for (const agent of agents.values()) {
      expect(agent.system).toContain("Never use computer-control or GUI automation");
    }
    expect(agents.get("honk-build")?.system).toContain("honk-sidekick-medium");
    expect(agents.get("honk-sidekick-medium")).toMatchObject({
      hidden: true,
      mode: "subagent",
      model: {
        providerID: "openai",
        id: "gpt-5.6-sol",
        variant: "medium",
      },
    });
    expect(
      agents
        .get("honk-sidekick-medium")
        ?.permissions.filter((rule) => rule.action === "task" && rule.effect === "deny"),
    ).toHaveLength(1);
  });

  it("emits sidekicks instead of the retired oracle agents", () => {
    const mainRoutes = HONK_AGENT_PAIRINGS.map(
      (pairing) => `${pairing.main.providerID}/${pairing.main.id}/${pairing.main.variant}`,
    );
    expect(new Set(mainRoutes).size).toBe(HONK_AGENT_PAIRINGS.length);

    const config = buildHonkOpencodeConfig("/state/honk-opencode-plugin/index.ts");
    expect(
      Object.keys(config.agent).filter((name) => name.startsWith("honk-sidekick-")),
    ).toHaveLength(4);
    expect(Object.keys(config.agent).some((name) => name.includes("oracle"))).toBe(false);
    expect(config.agent["honk-sidekick-medium"]).toMatchObject({
      mode: "subagent",
      hidden: true,
      model: "openai/gpt-5.6-sol",
      variant: "medium",
    });
  });
});
