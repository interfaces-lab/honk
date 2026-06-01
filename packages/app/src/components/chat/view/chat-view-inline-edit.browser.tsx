// Production CSS is part of the behavior under test because inline-edit
// geometry must match the rendered message bubble.
import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { type MessageId } from "@multi/contracts";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_VIEWPORT, createSnapshotForTargetUser } from "./chat-view.browser.fixtures";
import {
  installChatViewBrowserHarness,
  mountChatView,
  waitForElement,
  waitForLayout,
} from "./chat-view.browser.harness";

const EDIT_MESSAGE_ID = "msg-user-inline-edit-height" as MessageId;

installChatViewBrowserHarness();

describe("ChatView inline message edit", () => {
  it("focuses immediately and keeps editor height aligned with the source bubble", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: EDIT_MESSAGE_ID,
        targetText: "Inline edit height target",
      }),
    });

    try {
      const editBubble = await waitForElement(
        () =>
          document.querySelector<HTMLElement>(
            `[data-message-id="${EDIT_MESSAGE_ID}"] [aria-label="Edit message"]`,
          ),
        "Unable to find editable target message.",
      );
      const sourceHeight = editBubble.getBoundingClientRect().height;

      editBubble.click();

      const inlineEditor = await waitForElement(
        () =>
          document.querySelector<HTMLElement>(
            `[data-message-id="${EDIT_MESSAGE_ID}"] [data-testid="composer-editor"]`,
          ),
        "Unable to find inline edit composer.",
      );

      await vi.waitFor(
        () => {
          expect(document.activeElement).toBe(inlineEditor);
          expect(inlineEditor.textContent).toBe("Inline edit height target");
          const inlineHeight = inlineEditor.getBoundingClientRect().height;
          expect(Math.abs(inlineHeight - sourceHeight)).toBeLessThanOrEqual(3);
        },
        { timeout: 8_000, interval: 16 },
      );
    } finally {
      await mounted.cleanup();
    }
  });

  it("keeps the docked chat layout fixed while the pinned message enters edit mode", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: EDIT_MESSAGE_ID,
        targetText: "Pinned inline edit layout target",
      }),
    });

    try {
      const editBubble = await waitForElement(
        () =>
          document.querySelector<HTMLElement>(
            `[data-message-id="${EDIT_MESSAGE_ID}"] [aria-label="Edit message"]`,
          ),
        "Unable to find editable target message.",
      );
      const scrollElement = await waitForElement(
        () => document.querySelector<HTMLElement>("[data-chat-timeline-scroll]"),
        "Unable to find chat timeline scroll element.",
      );
      const composerForm = await waitForElement(
        () => document.querySelector<HTMLElement>('[data-chat-input-form="true"]'),
        "Unable to find docked composer form.",
      );
      const stickyRow = await waitForElement(
        () => editBubble.closest<HTMLElement>('[data-sticky="true"]'),
        "Unable to find pinned message row.",
      );
      const before = {
        composerTop: composerForm.getBoundingClientRect().top,
        scrollBottom: scrollElement.getBoundingClientRect().bottom,
        scrollTop: scrollElement.getBoundingClientRect().top,
        scrollOffset: scrollElement.scrollTop,
        stickyHeight: stickyRow.getBoundingClientRect().height,
      };
      const editButtonRect = editBubble.getBoundingClientRect();
      const hitX = Math.min(
        Math.max(editButtonRect.left + Math.min(16, editButtonRect.width / 2), 0),
        window.innerWidth - 1,
      );
      const hitY = Math.min(
        Math.max(editButtonRect.top + Math.min(16, editButtonRect.height / 2), 0),
        window.innerHeight - 1,
      );
      const hitTarget = document.elementFromPoint(hitX, hitY);
      expect(hitTarget instanceof Element && stickyRow.contains(hitTarget)).toBe(true);

      editBubble.click();

      const inlineEditor = await waitForElement(
        () =>
          document.querySelector<HTMLElement>(
            `[data-message-id="${EDIT_MESSAGE_ID}"] [data-testid="composer-editor"]`,
          ),
        "Unable to find inline edit composer.",
      );
      await waitForLayout();

      const after = {
        composerTop: composerForm.getBoundingClientRect().top,
        scrollBottom: scrollElement.getBoundingClientRect().bottom,
        scrollTop: scrollElement.getBoundingClientRect().top,
        scrollOffset: scrollElement.scrollTop,
        stickyHeight:
          inlineEditor.closest<HTMLElement>('[data-sticky="true"]')?.getBoundingClientRect()
            .height ?? 0,
      };

      expect(after.stickyHeight).toBeGreaterThan(before.stickyHeight);
      expect(Math.abs(after.composerTop - before.composerTop)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.scrollBottom - before.scrollBottom)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.scrollOffset - before.scrollOffset)).toBeLessThanOrEqual(2);
    } finally {
      await mounted.cleanup();
    }
  });
});
