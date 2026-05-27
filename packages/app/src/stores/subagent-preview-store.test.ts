import { EnvironmentId, ThreadId } from "@multi/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
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
});
