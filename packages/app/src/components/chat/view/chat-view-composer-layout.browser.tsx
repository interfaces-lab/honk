// Production CSS is part of the behavior under test because multiline
// measurement drives the docked composer layout.
import "../../../index.css";
import "../../../styles/tokens.css";

import { type MessageId } from "@multi/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_VIEWPORT, createSnapshotForTargetUser } from "./chat-view.browser.fixtures";
import {
  installChatViewBrowserHarness,
  mountChatView,
  setComposerSelectionByTextOffsets,
  waitForComposerEditor,
  waitForElement,
} from "./chat-view.browser.harness";

installChatViewBrowserHarness();

async function waitForDockedCompactState(compact: boolean): Promise<void> {
  await vi.waitFor(
    () => {
      const footer = document.querySelector<HTMLElement>('[data-chat-input-footer="true"]');
      const composerFrame = document.querySelector<HTMLElement>(
        '[data-chat-input-form="true"] [data-expanded]',
      );
      expect(footer?.dataset.chatInputFooterCompact).toBe(compact ? "true" : "false");
      if (compact) {
        expect(composerFrame).toBeNull();
      } else {
        expect(composerFrame).not.toBeNull();
      }
    },
    { timeout: 8_000, interval: 16 },
  );
}

describe("ChatView composer layout", () => {
  it("expands from single-line to multiline and collapses after deleting back to one line", async () => {
    const mounted = await mountChatView({
      viewport: DEFAULT_VIEWPORT,
      snapshot: createSnapshotForTargetUser({
        targetMessageId: "msg-user-composer-layout" as MessageId,
        targetText: "composer layout target",
      }),
    });

    try {
      await waitForComposerEditor();
      await waitForElement(
        () => document.querySelector<HTMLElement>('[data-chat-input-footer="true"]'),
        "Unable to find composer footer.",
      );
      await waitForDockedCompactState(true);

      await page.getByTestId("composer-editor").fill("first line\nsecond line");
      await waitForDockedCompactState(false);

      await setComposerSelectionByTextOffsets({
        start: "first line".length,
        end: "first line\nsecond line".length,
      });
      expect(document.execCommand("delete")).toBe(true);
      await waitForDockedCompactState(true);
    } finally {
      await mounted.cleanup();
    }
  });
});
