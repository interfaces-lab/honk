import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { DraftId } from "../../../stores/chat-drafts";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VIEWPORT,
  THREAD_KEY,
  createDraftOnlySnapshot,
  setDraftThreadWithoutWorktree,
} from "./chat-view.browser.fixtures";
import {
  installChatViewBrowserHarness,
  mountChatView,
  waitForComposerEditor,
} from "./chat-view.browser.harness";

installChatViewBrowserHarness();

describe("ChatView hero composer CSS", () => {
  it("applies new-agent editor min-height from conversation.css vars", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      initialPath: `/draft/${DraftId.make(THREAD_KEY)}`,
    });

    try {
      const form = document.querySelector<HTMLFormElement>('[data-chat-input-form="true"]');
      expect(form?.dataset.layout).toBe("new-agent");

      const editor = await waitForComposerEditor();
      await vi.waitFor(
        () => {
          expect(Number.parseFloat(getComputedStyle(editor).minHeight)).toBeGreaterThanOrEqual(56);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
