import { createOpenCodeServer, openCodeLocationRef, openCodeSessionRef } from "@honk/opencode";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const popupState: { initialFocus: unknown } = vi.hoisted(() => ({ initialFocus: undefined }));
const watchState: { current: unknown } = vi.hoisted(() => ({ current: null }));

vi.mock("@honk/ui", async (importOriginal) => {
  const ui = await importOriginal<typeof import("@honk/ui")>();
  return {
    ...ui,
    Popover: {
      ...ui.Popover,
      Root: (props: { readonly children?: ReactNode }) => props.children,
      Popup: (props: { readonly children?: ReactNode; readonly initialFocus?: unknown }) => {
        popupState.initialFocus = props.initialFocus;
        return props.children;
      },
    },
  };
});

vi.mock("../use-sdk-watch", () => ({
  useSessionWatch: () => ({ state: watchState.current, status: "live" }),
}));

import type { AppChildSessionSummary, ThreadViewState } from "../open-code-view";
import { ThreadRuntimeContext } from "./runtime";
import { SessionRequests } from "./session-requests";
import { SubagentTray } from "./subagent-tray";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096" });

describe("subagent tray focus", () => {
  it("wires pending-request focus into the docked popover", () => {
    watchState.current = {
      app: {
        summary: { status: "running" },
        messages: [],
        parts: [],
        permissions: [{ id: "per_1", action: "bash", resources: ["pnpm test"] }],
        questions: [],
      },
      attachedDirectories: [],
      activity: "busy",
    };
    popupState.initialFocus = undefined;

    const html = renderToStaticMarkup(
      <ThreadRuntimeContext.Provider
        value={{
          ref: openCodeSessionRef(server.key, "session-parent"),
          client: null,
          tabKey: "session-parent",
        }}
      >
        <SubagentTray
          partID="task-1"
          child={
            {
              id: "session-child",
              server: server.key,
              agent: "honk-read-thread",
              model: null,
              title: "Inspect the code",
              status: "running",
              needsAttention: true,
              archivedAt: null,
              updatedAt: new Date(1).toISOString(),
              revertMessageId: null,
              projectId: null,
              projectDirectory: "/repo",
              location: openCodeLocationRef({ directory: "/repo" }),
              worktree: null,
              parentSessionId: "session-parent",
            } satisfies AppChildSessionSummary
          }
          mission="Inspect the code"
          model={null}
          anchorRef={{ current: null }}
          onMinimize={() => undefined}
        />
      </ThreadRuntimeContext.Provider>,
    );

    expect(popupState.initialFocus).toBeTypeOf("function");
    expect(html).toContain('data-session-request=""');
    expect(html).toContain('data-subagent-tray-focus=""');
    watchState.current = null;
  });

  it("makes request cards programmatically focusable", () => {
    const html = renderToStaticMarkup(
      <ThreadRuntimeContext.Provider
        value={{
          ref: openCodeSessionRef(server.key, "session-child"),
          client: null,
          tabKey: "session-child",
        }}
      >
        <SessionRequests
          threadId="session-child"
          permissions={
            [
              {
                id: "per_1",
                action: "bash",
                resources: ["pnpm test"],
              },
            ] as unknown as ThreadViewState["permissions"]
          }
          questions={[]}
        />
      </ThreadRuntimeContext.Provider>,
    );

    expect(html).toContain('tabindex="-1" data-session-request=""');
    expect(html).toContain('aria-label="Permission requested by the agent"');
  });
});
