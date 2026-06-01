import { EnvironmentId, ThreadId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  isSubagentTrayLogVisible,
  subagentTrayKey,
  useSubagentTrayStore,
  type SubagentTraySelection,
} from "./subagent-tray-store";

function selection(): SubagentTraySelection {
  const subagent = {
    threadId: "codex-subagent-thread-1",
    providerThreadId: "codex-subagent-thread-1",
    title: "Reviewer",
    isActive: true,
  };
  return {
    key: subagentTrayKey(subagent),
    activeThreadId: ThreadId.make("thread-1"),
    environmentId: EnvironmentId.make("environment-1"),
    projectRoot: "/tmp/project",
    subagent,
  };
}

describe("useSubagentTrayStore", () => {
  beforeEach(() => {
    useSubagentTrayStore.setState({ focus: null, presented: false });
  });

  it("keeps focus when the tray presentation is hidden", () => {
    const initialSelection = selection();

    useSubagentTrayStore.getState().openTray(initialSelection);
    useSubagentTrayStore.getState().setTrayPresented(true);
    useSubagentTrayStore.getState().setTrayPresented(false);

    expect(useSubagentTrayStore.getState().focus).toEqual(initialSelection);
    expect(useSubagentTrayStore.getState().presented).toBe(false);
  });

  it("updates focused transcript items from streamed subagent state", () => {
    const initialSelection = selection();
    useSubagentTrayStore.getState().openTray(initialSelection);

    useSubagentTrayStore.getState().updateTraySubagent({
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

    expect(useSubagentTrayStore.getState().focus?.subagent.transcriptItems?.[0]?.text).toBe(
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
    useSubagentTrayStore.getState().openTray(initialSelection);

    useSubagentTrayStore.getState().updateTraySubagent({
      ...initialSelection.subagent,
      transcriptItems: [
        {
          ...initialSelection.subagent.transcriptItems[0]!,
          rawCommand: "/bin/zsh -lc 'pnpm test'",
        },
      ],
    });

    expect(useSubagentTrayStore.getState().focus?.subagent.transcriptItems?.[0]?.rawCommand).toBe(
      "/bin/zsh -lc 'pnpm test'",
    );
  });
});

describe("isSubagentTrayLogVisible", () => {
  it("hides raw subagent item logs because transcript rows own lifecycle rendering", () => {
    expect(
      isSubagentTrayLogVisible(
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
      isSubagentTrayLogVisible(
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
      isSubagentTrayLogVisible(
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
      isSubagentTrayLogVisible(
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

    expect(isSubagentTrayLogVisible(threadStartedLog, false)).toBe(true);
    expect(isSubagentTrayLogVisible(threadStartedLog, true)).toBe(false);
    expect(
      isSubagentTrayLogVisible(
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
