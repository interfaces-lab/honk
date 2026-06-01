import { ApprovalRequestId } from "@multi/contracts";
import "../../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { PendingUserInput } from "../../../session-logic";
import { ComposerPendingUserInputPanel } from "./pending/user-input-panel";

function pendingInput(input?: { multiSelect?: boolean }): PendingUserInput {
  return {
    requestId: ApprovalRequestId.make("request-1"),
    createdAt: "2026-05-15T00:00:00.000Z",
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "What should happen next?",
        options: [
          {
            label: "Use current thread",
            description: "Continue here",
          },
          {
            label: "Start new thread",
            description: "Branch from this plan",
          },
        ],
        multiSelect: input?.multiSelect === true,
      },
    ],
  };
}

describe("ComposerPendingUserInputPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("requests immediate advance after a single-select option is chosen", async () => {
    const onToggleOption = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[pendingInput()]}
        respondingRequestIds={[]}
        answers={{}}
        questionIndex={0}
        onToggleOption={onToggleOption}
      />,
      { container: host },
    );

    await page.getByRole("radio", { name: /Use current thread/ }).click();

    expect(onToggleOption).toHaveBeenCalledWith("scope", "Use current thread", true);
    await screen.unmount();
  });

  it("keeps multi-select choices in place", async () => {
    const onToggleOption = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[pendingInput({ multiSelect: true })]}
        respondingRequestIds={[]}
        answers={{}}
        questionIndex={0}
        onToggleOption={onToggleOption}
      />,
      { container: host },
    );

    await page.getByRole("button", { name: /Start new thread/ }).click();

    expect(onToggleOption).toHaveBeenCalledWith("scope", "Start new thread", false);
    await screen.unmount();
  });
});
