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

  it("caps the new-agent editor height and keeps the toolbar inside the shell", async () => {
    setDraftThreadWithoutWorktree();

    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createDraftOnlySnapshot(),
      initialPath: `/draft/${DraftId.make(THREAD_KEY)}`,
    });

    try {
      const editor = await waitForComposerEditor();
      const form = document.querySelector<HTMLFormElement>('[data-chat-input-form="true"]');
      expect(form?.dataset.layout).toBe("new-agent");
      const footer = document.querySelector<HTMLElement>('[data-chat-input-footer="true"]');
      expect(footer).not.toBeNull();

      await vi.waitFor(
        () => {
          const editorStyle = getComputedStyle(editor);
          expect(editorStyle.overflowY).toBe("auto");
          const maxHeight = Number.parseFloat(editorStyle.maxHeight);
          expect(maxHeight).toBeGreaterThan(0);
          expect(maxHeight).toBeLessThanOrEqual(420);

          if (form && footer) {
            const formRect = form.getBoundingClientRect();
            const footerRect = footer.getBoundingClientRect();
            expect(footerRect.bottom).toBeLessThanOrEqual(formRect.bottom + 0.5);
            expect(footerRect.top).toBeGreaterThanOrEqual(formRect.top - 0.5);
            expect(footerRect.left).toBeGreaterThanOrEqual(formRect.left - 0.5);
            expect(footerRect.right).toBeLessThanOrEqual(formRect.right + 0.5);
          }
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });
});
