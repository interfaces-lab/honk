import { EnvironmentId, ThreadId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  isSubagentPreviewLogVisible,
  subagentPreviewKey,
  useSubagentPreviewStore,
  type SubagentPreviewSelection,
} from "./subagent-preview-store";

function selection(): SubagentPreviewSelection {
  const subagent = {
    threadId: "codex-subagent-thread-1",
    providerThreadId: "codex-subagent-thread-1",
    title: "Reviewer",
    isActive: true,
  };
  return {
    key: subagentPreviewKey(subagent),
    activeThreadId: ThreadId.make("thread-1"),
    environmentId: EnvironmentId.make("environment-1"),
    projectRoot: "/tmp/project",
    subagent,
  };
}

describe("useSubagentPreviewStore", () => {
  beforeEach(() => {
    useSubagentPreviewStore.setState({ focus: null, presented: false });
  });

  it("keeps focus when the tray presentation is hidden", () => {
    const initialSelection = selection();

    useSubagentPreviewStore.getState().openPreview(initialSelection);
    useSubagentPreviewStore.getState().setPreviewPresented(true);
    useSubagentPreviewStore.getState().setPreviewPresented(false);

    expect(useSubagentPreviewStore.getState().focus).toEqual(initialSelection);
    expect(useSubagentPreviewStore.getState().presented).toBe(false);
  });

  it("updates focused transcript items from streamed subagent state", () => {
    const initialSelection = selection();
    useSubagentPreviewStore.getState().openPreview(initialSelection);

    useSubagentPreviewStore.getState().updatePreviewSubagent({
      ...initialSelection.subagent,
      transcriptItems: [
        {
          id: "subagent-message-1",
          itemId: "subagent-message-1",
          kind: "message",
          role: "assistant",
          text: "streamed update",
          loading: true,
          createdAt: "2026-02-23T00:00:01.000Z",
          sequence: 0,
        },
      ],
    });

    expect(useSubagentPreviewStore.getState().focus?.subagent.transcriptItems?.[0]?.text).toBe(
      "streamed update",
    );
  });

  it("updates focused transcript items when command raw metadata changes", () => {
    const initialSelection = {
      ...selection(),
      subagent: {
        ...selection().subagent,
        transcriptItems: [
          {
            id: "command-1",
            itemId: "command-1",
            kind: "command" as const,
            title: "Ran command",
            command: "pnpm test",
            loading: true,
            createdAt: "2026-02-23T00:00:01.000Z",
            sequence: 0,
          },
        ],
      },
    };
    useSubagentPreviewStore.getState().openPreview(initialSelection);

    useSubagentPreviewStore.getState().updatePreviewSubagent({
      ...initialSelection.subagent,
      transcriptItems: [
        {
          ...initialSelection.subagent.transcriptItems[0]!,
          rawCommand: "/bin/zsh -lc 'pnpm test'",
        },
      ],
    });

    expect(useSubagentPreviewStore.getState().focus?.subagent.transcriptItems?.[0]?.rawCommand).toBe(
      "/bin/zsh -lc 'pnpm test'",
    );
  });
});

describe("isSubagentPreviewLogVisible", () => {
  it("hides raw subagent item logs because transcript rows own lifecycle rendering", () => {
    expect(
      isSubagentPreviewLogVisible(
        {
          id: "command-start",
          createdAt: "2026-02-23T00:00:01.000Z",
          kind: "subagent.item.started",
          label: "Ran command",
          detail: "pnpm test",
          itemType: "command_execution",
        },
        false,
      ),
    ).toBe(false);
  });

  it("hides raw subagent item logs once canonical transcript is available", () => {
    expect(
      isSubagentPreviewLogVisible(
        {
          id: "command-start",
          createdAt: "2026-02-23T00:00:01.000Z",
          kind: "subagent.item.started",
          label: "Ran command",
          detail: "pnpm test",
          itemType: "command_execution",
        },
        true,
      ),
    ).toBe(false);
    expect(
      isSubagentPreviewLogVisible(
        {
          id: "subagent-task-completed",
          createdAt: "2026-02-23T00:00:02.000Z",
          kind: "subagent.item.completed",
          label: "Completed task",
          itemType: "collab_agent_tool_call",
        },
        true,
      ),
    ).toBe(false);
    expect(
      isSubagentPreviewLogVisible(
        {
          id: "legacy-command-completed",
          createdAt: "2026-02-23T00:00:03.000Z",
          kind: "subagent.item.completed",
          label: "Ran command",
          detail: "pnpm test",
        },
        true,
      ),
    ).toBe(false);
  });

  it("keeps thread lifecycle logs only until transcript rows are available", () => {
    const threadStartedLog = {
      id: "subagent-thread-started",
      createdAt: "2026-02-23T00:00:01.000Z",
      kind: "subagent.thread.started" as const,
      label: "Thread started",
    };

    expect(isSubagentPreviewLogVisible(threadStartedLog, false)).toBe(true);
    expect(isSubagentPreviewLogVisible(threadStartedLog, true)).toBe(false);
    expect(
      isSubagentPreviewLogVisible(
        {
          id: "subagent-state-changed",
          createdAt: "2026-02-23T00:00:02.000Z",
          kind: "subagent.thread.state.changed",
          label: "State changed",
          detail: "idle",
        },
        true,
      ),
    ).toBe(false);
  });
});
