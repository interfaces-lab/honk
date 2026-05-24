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
});
