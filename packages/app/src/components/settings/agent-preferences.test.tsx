import { readFileSync } from "node:fs";
import type { AuthSnapshot } from "@honk/api/core/v1";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { createEmptyRuntimeHostSnapshot } from "../../lib/honk-runtime-api";
import { coreAuthQueryKeys, EMPTY_CORE_AUTH_SNAPSHOT } from "../../lib/core-auth-react-query";
import { useAgentRuntimeStore } from "../../stores/agent-runtime-store";
import { AgentRuntimeSettingsSectionsView } from "./settings-panels";

function renderAgentPreferences(
  input: {
    readonly snapshot?: ReturnType<typeof createEmptyRuntimeHostSnapshot>;
    readonly authSnapshot?: AuthSnapshot;
  } = {},
): string {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  queryClient.setQueryData(
    coreAuthQueryKeys.snapshot(),
    input.authSnapshot ?? EMPTY_CORE_AUTH_SNAPSHOT,
  );

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <AgentRuntimeSettingsSectionsView
        snapshot={input.snapshot ?? createEmptyRuntimeHostSnapshot()}
      />
    </QueryClientProvider>,
  );
}

describe("AgentRuntimeSettingsSections", () => {
  beforeEach(() => {
    useAgentRuntimeStore.setState({
      localRuntimeThreadIds: new Set(),
      runtimeActivityByThreadId: new Map(),
      snapshot: createEmptyRuntimeHostSnapshot(),
    });
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
    expect(html).not.toContain("xAI API Key");
    expect(html).not.toContain("Session tree");
    expect(html).not.toContain("Workspace files");
  });

  it("renders the delegated Claude row and Codex/Cursor add flows", () => {
    const html = renderAgentPreferences();

    expect(html).toContain("No accounts connected");
    expect(html).toContain("Claude Code");
    expect(html).toContain("Uses your Claude Code login. Run `claude login` to connect.");
    expect(html).toContain("Codex");
    expect(html).toContain("Cursor");
    expect(html).toContain("Add");
    expect(html).toContain("Add ChatGPT sign-in to enable Codex models.");
    expect(html).toContain("Add a Cursor API key to enable Cursor Composer.");
    expect(html).not.toContain("Claude OAuth");
    expect(html).not.toContain("Paste Claude API Key");
  });

  it("renders connected Core accounts from the auth snapshot", () => {
    const html = renderAgentPreferences({
      authSnapshot: {
        credentials: [
          {
            kind: "codex-oauth",
            state: "available",
            label: "ChatGPT · user@example.com",
            message: null,
            updatedAt: "2026-06-09T00:00:00.000Z",
          },
          {
            kind: "cursor-api-key",
            state: "available",
            label: "Cursor API key",
            message: null,
            updatedAt: "2026-06-09T00:00:00.000Z",
          },
        ],
        harnesses: [
          {
            harness: "claude-code",
            available: true,
            detail: "Max subscription · claude@example.com",
          },
        ],
        flow: null,
      },
    });

    expect(html).not.toContain("No accounts connected");
    expect(html).toContain("Max subscription · claude@example.com");
    expect(html).toContain("ChatGPT · user@example.com");
    expect(html).toContain("Cursor API key");
    expect(html).toContain("Remove");
  });

  it("renders unavailable model modes when provider credentials are missing", () => {
    const html = renderAgentPreferences();

    expect(html).toContain("GPT-5.5 unavailable");
    expect(html).toContain("Requires Codex sign-in.");
  });

  it("includes Claude OAuth in the default credentials", () => {
    const snapshot = createEmptyRuntimeHostSnapshot();

    expect(snapshot.preferences.credentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "claude-oauth",
          label: "Claude OAuth",
          authProviderId: "anthropic",
        }),
      ]),
    );
  });

  it("does not mark the active model unavailable when its provider credential exists", () => {
    const html = renderAgentPreferences({
      authSnapshot: {
        credentials: [
          {
            kind: "codex-oauth",
            state: "available",
            label: "Codex OAuth",
            message: null,
            updatedAt: "2026-06-09T00:00:00.000Z",
          },
        ],
        harnesses: [],
        flow: null,
      },
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
        snapshot: {
          ...snapshot,
          preferences: {
            ...snapshot.preferences,
            agentMode: "deep",
            thinkingLevel,
          },
        },
      });

      expect(html).toContain(label);
    }

    const snapshot = createEmptyRuntimeHostSnapshot();
    const smartHtml = renderAgentPreferences({
      snapshot: {
        ...snapshot,
        preferences: {
          ...snapshot.preferences,
          agentMode: "smart",
          thinkingLevel: "medium",
        },
      },
    });

    expect(smartHtml).toContain("Thinking level");
    expect(smartHtml).toContain("Medium");
  });

  it("keeps API key entry integrated in the settings surface", () => {
    const source = readFileSync(new URL("./settings-panels.tsx", import.meta.url), "utf8");

    expect(source).toContain('type="password"');
    expect(source).toContain("Saved locally. Existing keys stay hidden.");
    expect(source).not.toContain("window.prompt");
  });

  it("renders persistent OAuth flow state in the account row", () => {
    const html = renderAgentPreferences({
      authSnapshot: {
        credentials: [],
        harnesses: [],
        flow: {
          kind: "codex-oauth",
          state: "pending",
          message: "Waiting for browser login.",
          verificationUri: "https://example.com/device",
          userCode: "ABCD-1234",
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      },
    });

    expect(html).toContain("Waiting for login");
    expect(html).toContain("Waiting for browser login.");
    expect(html).toContain("Open login page");
    expect(html).toContain("ABCD-1234");
    expect(html).toContain("Copy code");
    expect(html).toContain("Cancel");
  });

  it("renders Codex OAuth errors without adding a Claude flow", () => {
    const html = renderAgentPreferences({
      authSnapshot: {
        credentials: [],
        harnesses: [],
        flow: {
          kind: "codex-oauth",
          state: "error",
          message: "Login failed.",
          verificationUri: "https://example.com/login",
          userCode: null,
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      },
    });

    expect(html).toContain("Codex");
    expect(html).toContain("Login failed.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Claude OAuth");
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
