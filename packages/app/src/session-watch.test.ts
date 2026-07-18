import { openCodeSessionRef } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cloud,
  createClient,
  createDurableEventQueue,
  local,
  reasoningEvent,
  reasoningMessage,
  sessionInfo,
  waitUntil,
} from "./watch-registry.test-helpers";
import {
  getSessionWatchSnapshot,
  registerOpenCodeClient,
  subscribeSessionWatch,
  unregisterOpenCodeClient,
} from "./watch-registry";

afterEach(async () => {
  unregisterOpenCodeClient(local.key);
  unregisterOpenCodeClient(cloud.key);
  vi.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("OpenCode durable session watch", () => {
  it("bootstraps after the latest paginated history sequence", async () => {
    const durable = createDurableEventQueue();
    const historyAfter: (number | undefined)[] = [];
    const info = sessionInfo("ses_watermark", "Watermark", "/local/repo");
    const event4 = reasoningEvent("session.next.reasoning.started", {
      seq: 4,
      sessionID: info.id,
      messageID: "message-watermark",
      partID: "part-watermark",
    });
    const event5 = reasoningEvent("session.next.reasoning.ended", {
      seq: 5,
      sessionID: info.id,
      messageID: "message-watermark",
      partID: "part-watermark",
    });
    let transcriptLoads = 0;
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        history: async (_, input) => {
          historyAfter.push(input?.after);
          return input?.after === undefined
            ? { data: [event4], hasMore: true }
            : { data: [event5], hasMore: false };
        },
        sessionEvents: durable.events,
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);

    await waitUntil(() => durable.after.length === 1);
    expect(historyAfter).toEqual([undefined, 4]);
    expect(durable.after).toEqual(["5"]);
    expect(transcriptLoads).toBe(2);
    unsubscribe();
  });

  it("reconnects from the last applied sequence without reloading", async () => {
    vi.useFakeTimers();
    const durable = createDurableEventQueue();
    const info = sessionInfo("ses_cursor", "Cursor", "/local/repo");
    const messageID = "message-cursor";
    const partID = "part-cursor";
    let transcriptLoads = 0;
    let messageLoads = 0;
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        history: async () => ({
          data: [
            reasoningEvent("session.next.reasoning.started", {
              seq: 5,
              sessionID: info.id,
              messageID,
              partID,
            }),
          ],
          hasMore: false,
        }),
        sessionEvents: durable.events,
        sessionMessage: async () => {
          messageLoads += 1;
          return reasoningMessage(messageID, partID, "streamed");
        },
        onTranscript: () => {
          transcriptLoads += 1;
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(durable.after).toEqual(["5"]);

    durable.push(
      reasoningEvent("session.next.reasoning.started", {
        seq: 6,
        sessionID: info.id,
        messageID,
        partID,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(messageLoads).toBe(1);
    durable.close();
    await vi.advanceTimersByTimeAsync(250);
    expect(durable.after).toEqual(["5", "6"]);
    expect(transcriptLoads).toBe(2);

    durable.push(
      reasoningEvent("session.next.reasoning.started", {
        seq: 6,
        sessionID: info.id,
        messageID,
        partID,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(messageLoads).toBe(1);
    unsubscribe();
  });

  it("does not advance the cursor when message reconciliation fails", async () => {
    vi.useFakeTimers();
    const durable = createDurableEventQueue();
    const info = sessionInfo("ses_retry_cursor", "Retry cursor", "/local/repo");
    const messageID = "message-retry";
    const partID = "part-retry";
    let messageLoads = 0;
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        history: async () => ({
          data: [
            reasoningEvent("session.next.reasoning.started", {
              seq: 8,
              sessionID: info.id,
              messageID,
              partID,
            }),
          ],
          hasMore: false,
        }),
        sessionEvents: durable.events,
        sessionMessage: async () => {
          messageLoads += 1;
          if (messageLoads === 1) throw new Error("temporary message read failure");
          return reasoningMessage(messageID, partID, "recovered");
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(durable.after).toEqual(["8"]);

    const event = reasoningEvent("session.next.reasoning.started", {
      seq: 9,
      sessionID: info.id,
      messageID,
      partID,
    });
    durable.push(event);
    await vi.advanceTimersByTimeAsync(250);
    expect(durable.after).toEqual(["8", "8"]);

    durable.push(event);
    await vi.advanceTimersByTimeAsync(0);
    expect(messageLoads).toBe(2);
    expect(getSessionWatchSnapshot(ref).state?.app.parts[0]).toMatchObject({
      type: "reasoning",
      text: "recovered",
    });
    unsubscribe();
  });

  it("stops after durable history rejects authorization", async () => {
    let historyLoads = 0;
    const info = sessionInfo("ses_unauthorized_cursor", "Unauthorized cursor", "/local/repo");
    registerOpenCodeClient(
      createClient({
        server: local,
        info,
        history: async () => {
          historyLoads += 1;
          throw Object.assign(new Error("unauthorized"), { status: 401 });
        },
        onPump: () => undefined,
      }),
      { primary: true },
    );
    const ref = openCodeSessionRef(local.key, info.id);
    const unsubscribe = subscribeSessionWatch(ref, () => undefined);

    await waitUntil(() => getSessionWatchSnapshot(ref).status === "unauthorized");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(historyLoads).toBe(1);
    unsubscribe();
  });
});
