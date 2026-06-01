import { MessageId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { deriveThreadTreeMutationAvailability } from "./thread-tree-mutation-availability";

describe("deriveThreadTreeMutationAvailability", () => {
  it("allows mutation when the thread and queue are idle", () => {
    expect(
      deriveThreadTreeMutationAvailability({
        sendInFlight: false,
        queuedComposerItemCount: 0,
        orchestrationStatus: "ready",
      }),
    ).toEqual({ canMutate: true, reason: null });
  });

  it("blocks mutation while a send is in flight", () => {
    expect(
      deriveThreadTreeMutationAvailability({
        sendInFlight: true,
        queuedComposerItemCount: 0,
        orchestrationStatus: "ready",
      }),
    ).toEqual({ canMutate: false, reason: "send-in-flight" });
  });

  it("blocks mutation while queued composer items exist", () => {
    expect(
      deriveThreadTreeMutationAvailability({
        sendInFlight: false,
        queuedComposerItemCount: 1,
        orchestrationStatus: "ready",
      }),
    ).toEqual({ canMutate: false, reason: "queued-composer-items" });
  });

  it("blocks mutation while a queued composer item is being edited", () => {
    expect(
      deriveThreadTreeMutationAvailability({
        sendInFlight: false,
        queuedComposerItemCount: 0,
        editingQueuedComposerItemId: MessageId.make("queued-message-1"),
        orchestrationStatus: "ready",
      }),
    ).toEqual({ canMutate: false, reason: "queued-composer-items" });
  });

  it("blocks mutation while a turn is running", () => {
    expect(
      deriveThreadTreeMutationAvailability({
        sendInFlight: false,
        queuedComposerItemCount: 0,
        orchestrationStatus: "running",
      }),
    ).toEqual({ canMutate: false, reason: "turn-running" });
  });
});
