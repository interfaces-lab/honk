import { readFileSync } from "node:fs";
import { AuthProviderId } from "@multi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyRuntimeHostSnapshot } from "../../lib/multi-runtime-api";
import { useAgentRuntimeStore } from "../../stores/agent-runtime-store";
import { AgentRuntimeSettingsSectionsView } from "./settings-panels";

function renderAgentPreferences(snapshot = createEmptyRuntimeHostSnapshot()): string {
  return renderToStaticMarkup(
    <AgentRuntimeSettingsSectionsView snapshot={snapshot} setSnapshot={() => undefined} />,
  );
}

describe("AgentRuntimeSettingsSections", () => {
  beforeEach(() => {
    useAgentRuntimeStore.setState({ snapshot: createEmptyRuntimeHostSnapshot() });
  });

  it("renders the curated Pi account and runtime preference surface", () => {
    const html = renderAgentPreferences();

    expect(html).toContain("Pi runtime");
    expect(html).toContain("Agent mode");
    expect(html).toContain("Deep");
    expect(html).toContain("GPT-5.5");
    expect(html).toContain("Thinking level");
    expect(html).toContain("High");
    expect(html).toContain("Interaction mode");
    expect(html).toContain("Accounts");
    expect(html).toContain("Claude API Key");
    expect(html).toContain("Codex OAuth");
    expect(html).toContain("Codex API Key");
    expect(html).toContain("xAI API Key");
    expect(html).toContain("Login");
    expect(html).toContain("Paste Claude API Key");
    expect(html).toContain("Paste Codex API Key");
    expect(html).toContain("Paste xAI API Key");
    expect(html).toContain("Save key");
    expect(html).toContain("Pi session");
    expect(html).toContain("Session tree");
    expect(html).toContain("Runtime session trees are persisted");
  });

  it("renders unavailable model modes when provider credentials are missing", () => {
    const html = renderAgentPreferences();

    expect(html).toContain("GPT-5.5 unavailable");
    expect(html).toContain("Requires Codex OAuth or a Codex API Key in Pi auth storage.");
  });

  it("does not mark the active model unavailable when its provider credential exists", () => {
    const snapshot = createEmptyRuntimeHostSnapshot();
    const html = renderAgentPreferences({
      ...snapshot,
      authStatuses: [
        {
          authProviderId: AuthProviderId.make("openai-codex"),
          accountId: null,
          state: "available",
          label: "Codex OAuth",
          message: null,
          updatedAt: "2026-06-09T00:00:00.000Z",
        },
      ],
    });

    expect(html).not.toContain("GPT-5.5 unavailable");
  });

  it("renders the selected thinking level for thinking-capable agent modes", () => {
    for (const [thinkingLevel, label] of [
      ["medium", "Medium"],
      ["high", "High"],
      ["xhigh", "XHigh"],
    ] as const) {
      const snapshot = createEmptyRuntimeHostSnapshot();
      const html = renderAgentPreferences({
        ...snapshot,
        preferences: {
          ...snapshot.preferences,
          agentMode: "deep",
          thinkingLevel,
        },
      });

      expect(html).toContain(label);
    }

    const snapshot = createEmptyRuntimeHostSnapshot();
    const smartHtml = renderAgentPreferences({
      ...snapshot,
      preferences: {
        ...snapshot.preferences,
        agentMode: "smart",
        thinkingLevel: "medium",
      },
    });

    expect(smartHtml).toContain("Thinking level");
    expect(smartHtml).toContain("Medium");
  });

  it("keeps API key entry integrated in the settings surface", () => {
    const html = renderAgentPreferences();
    const source = readFileSync(new URL("./settings-panels.tsx", import.meta.url), "utf8");

    expect(html).toContain('type="password"');
    expect(html).toContain("Stored in Pi auth storage. Saved keys are never displayed here.");
    expect(source).not.toContain("window.prompt");
  });

  it("renders persistent OAuth flow state in the account row", () => {
    const html = renderAgentPreferences({
      ...createEmptyRuntimeHostSnapshot(),
      credentialAuthFlows: [
        {
          authProviderId: AuthProviderId.make("openai-codex"),
          state: "pending",
          kind: "oauth-device-code",
          message: "Waiting for browser login.",
          verificationUri: "https://example.com/device",
          userCode: "ABCD-1234",
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      ],
    });

    expect(html).toContain("Waiting for login");
    expect(html).toContain("Login pending");
    expect(html).toContain("Waiting for browser login.");
    expect(html).toContain("Open login page");
    expect(html).toContain("ABCD-1234");
    expect(html).toContain("Copy code");
  });

  it("does not expose provider/model picker or raw Pi access controls", () => {
    const html = renderAgentPreferences();

    expect(html).not.toContain("Provider instance");
    expect(html).not.toContain("Provider settings");
    expect(html).not.toContain("Model picker");
    expect(html).not.toContain("Full access");
    expect(html).not.toContain("Tool access");
    expect(html).not.toContain("All access");
    expect(html).not.toContain("Persist runtime session tree");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("Auto-accept edits");
    expect(html).not.toContain("Supervised");
    expect(html).not.toContain("Runtime diagnostics");
    expect(html).not.toContain("No runtime diagnostics reported");
    expect(html).not.toContain("Runtime host unavailable");
  });
});
