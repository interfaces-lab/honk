import "../../../index.css";

import { EnvironmentId, ThreadId } from "@multi/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { subagentTrayKey, useSubagentTrayStore } from "../../../stores/subagent-tray-store";
import { SubagentTrayStack } from "./subagents/subagent-tray";

const ACTIVE_THREAD_ID = ThreadId.make("thread-subagent-tray");
const OTHER_THREAD_ID = ThreadId.make("thread-other");
const ENVIRONMENT_ID = EnvironmentId.make("environment-local");

function openTray(threadId = ACTIVE_THREAD_ID): void {
  const subagent = {
    threadId: "provider-thread-1",
    providerThreadId: "provider-thread-1",
    title: "Reviewer",
    isActive: true,
    transcriptItems: [
      {
        id: "assistant-message-1",
        itemId: "assistant-message-1",
        kind: "message" as const,
        role: "assistant" as const,
        text: "Shared renderer transcript",
        loading: false,
        createdAt: "2026-04-13T12:00:00.000Z",
        sequence: 0,
      },
    ],
  };

  useSubagentTrayStore.getState().openTray({
    key: subagentTrayKey(subagent),
    activeThreadId: threadId,
    environmentId: ENVIRONMENT_ID,
    projectRoot: "/repo/project",
    subagent,
  });
}

describe("SubagentTrayStack", () => {
  afterEach(() => {
    useSubagentTrayStore.setState({ focus: null, presented: false });
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders the focused tray through the shared step renderer", async () => {
    openTray();

    const screen = await render(
      <SubagentTrayStack activeThreadId={ACTIVE_THREAD_ID} compact={false} visible />,
    );

    try {
      await expect.element(page.getByText("Reviewer")).toBeVisible();
      await expect.element(page.getByText("Shared renderer transcript")).toBeVisible();
      expect(document.querySelector("[data-subagent-tray-container]")).not.toBeNull();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps tray focus across composer collapse and restores it when visible again", async () => {
    openTray();

    const screen = await render(
      <SubagentTrayStack activeThreadId={ACTIVE_THREAD_ID} compact={false} visible />,
    );

    try {
      await expect.element(page.getByText("Reviewer")).toBeVisible();

      await screen.rerender(
        <SubagentTrayStack activeThreadId={ACTIVE_THREAD_ID} compact={false} visible={false} />,
      );
      expect(document.querySelector("[data-subagent-tray-container]")).toBeNull();
      expect(useSubagentTrayStore.getState().focus?.key).toBe("provider-thread-1");

      await screen.rerender(
        <SubagentTrayStack activeThreadId={ACTIVE_THREAD_ID} compact={false} visible />,
      );
      await expect.element(page.getByText("Reviewer")).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("clears tray focus when the active thread changes", async () => {
    openTray();

    const screen = await render(
      <SubagentTrayStack activeThreadId={ACTIVE_THREAD_ID} compact={false} visible />,
    );

    try {
      await expect.element(page.getByText("Reviewer")).toBeVisible();

      await screen.rerender(
        <SubagentTrayStack activeThreadId={OTHER_THREAD_ID} compact={false} visible />,
      );

      await vi.waitFor(() => {
        expect(useSubagentTrayStore.getState().focus).toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });
});
