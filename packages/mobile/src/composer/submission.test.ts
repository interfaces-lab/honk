import { afterEach, describe, expect, it, vi } from "vitest";
import { openCodeServerKey, openCodeSessionRef } from "@honk/opencode";

const native = vi.hoisted(() => ({ mmkv: new Map<string, string>() }));

vi.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: (key: string): string | undefined => native.mmkv.get(key),
    set: (key: string, value: string): void => {
      native.mmkv.set(key, value);
    },
    remove: (key: string): boolean => native.mmkv.delete(key),
  }),
}));

import { enqueueThreadMessage, readThreadQueue, removeThreadMessage } from "./queue-store";
import { createComposerQueueDrain, type QueueDrainContext } from "./submission";

const ref = openCodeSessionRef(openCodeServerKey("https://mac.example.com"), "ses_drain");

const context = (running: boolean, dispatch: QueueDrainContext["dispatch"]): QueueDrainContext => ({
  ref,
  running,
  dispatch,
});

const sends = (): {
  readonly dispatch: QueueDrainContext["dispatch"];
  readonly texts: readonly string[];
} => {
  const texts: string[] = [];
  return {
    texts,
    dispatch: async (item) => {
      texts.push(item.text);
      return true;
    },
  };
};

afterEach(() => {
  for (const item of readThreadQueue(ref)) removeThreadMessage(ref, item.id);
});

describe("composer queue drain", () => {
  it("sends immediately when the session is idle, leaving nothing queued", async () => {
    const sent = sends();
    await createComposerQueueDrain().submit(context(false, sent.dispatch), {
      text: "hello",
      attachments: [],
    });
    expect(sent.texts).toEqual(["hello"]);
    expect(readThreadQueue(ref)).toEqual([]);
  });

  it("holds the message in the tray while the session is running", async () => {
    const sent = sends();
    await createComposerQueueDrain().submit(context(true, sent.dispatch), {
      text: "next",
      attachments: [],
    });
    expect(sent.texts).toEqual([]);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["next"]);
  });

  it("drains one message on the running to idle edge", async () => {
    const drain = createComposerQueueDrain();
    const sent = sends();
    await drain.submit(context(true, sent.dispatch), { text: "one", attachments: [] });
    await drain.submit(context(true, sent.dispatch), { text: "two", attachments: [] });

    await drain.syncRunning(context(true, sent.dispatch));
    await drain.syncRunning(context(false, sent.dispatch));

    expect(sent.texts).toEqual(["one"]);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["two"]);
  });

  it("does not drain while the session stays running", async () => {
    const drain = createComposerQueueDrain();
    const sent = sends();
    await drain.submit(context(true, sent.dispatch), { text: "one", attachments: [] });
    await drain.syncRunning(context(true, sent.dispatch));
    await drain.syncRunning(context(true, sent.dispatch));
    expect(sent.texts).toEqual([]);
  });

  it("does not drain on an idle to idle report", async () => {
    const drain = createComposerQueueDrain();
    const sent = sends();
    enqueueThreadMessage(ref, { text: "stranded", attachments: [] });
    await drain.syncRunning(context(false, sent.dispatch));
    expect(sent.texts).toEqual([]);
  });

  it("skips exactly one drain after a user stop", async () => {
    const drain = createComposerQueueDrain();
    const sent = sends();
    await drain.submit(context(true, sent.dispatch), { text: "one", attachments: [] });
    await drain.syncRunning(context(true, sent.dispatch));

    drain.suppressNextDrain();
    await drain.syncRunning(context(false, sent.dispatch));
    expect(sent.texts).toEqual([]);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["one"]);

    await drain.syncRunning(context(true, sent.dispatch));
    await drain.syncRunning(context(false, sent.dispatch));
    expect(sent.texts).toEqual(["one"]);
  });

  it("puts a failed message back at the front of the queue", async () => {
    const drain = createComposerQueueDrain();
    const dispatch = vi.fn(async () => false);
    await drain.submit(context(true, dispatch), { text: "one", attachments: [] });
    await drain.submit(context(true, dispatch), { text: "two", attachments: [] });

    await drain.syncRunning(context(true, dispatch));
    await drain.syncRunning(context(false, dispatch));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["one", "two"]);
    expect(drain.isDispatching()).toBe(false);
  });

  it("treats a rejected dispatch as a failed send", async () => {
    const drain = createComposerQueueDrain();
    await drain.submit(
      context(false, async () => Promise.reject(new Error("offline"))),
      {
        text: "one",
        attachments: [],
      },
    );
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["one"]);
    expect(drain.isDispatching()).toBe(false);
  });

  it("does not retry a failed message until the next edge or submit", async () => {
    const drain = createComposerQueueDrain();
    const attempts: string[] = [];
    let accept = false;
    const dispatch = async (item: { readonly text: string }): Promise<boolean> => {
      attempts.push(item.text);
      return accept;
    };

    await drain.submit(context(false, dispatch), { text: "one", attachments: [] });
    expect(attempts).toEqual(["one"]);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["one"]);

    accept = true;
    await drain.submit(context(false, dispatch), { text: "two", attachments: [] });
    expect(attempts).toEqual(["one", "one"]);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["two"]);
  });

  it("drains again for an idle edge that landed while a send was still in flight", async () => {
    const drain = createComposerQueueDrain();
    const started: string[] = [];
    let release = (): void => {};
    const dispatch = async (item: { readonly text: string }): Promise<boolean> => {
      started.push(item.text);
      if (started.length > 1) return true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return true;
    };

    await drain.submit(context(true, dispatch), { text: "one", attachments: [] });
    await drain.submit(context(true, dispatch), { text: "two", attachments: [] });
    await drain.syncRunning(context(true, dispatch));

    const first = drain.syncRunning(context(false, dispatch));
    expect(started).toEqual(["one"]);

    // The screen reloads the session after a send, so a fast turn reports idle before "one" settles.
    await drain.syncRunning(context(true, dispatch));
    await drain.syncRunning(context(false, dispatch));
    release();
    await first;

    expect(started).toEqual(["one", "two"]);
    expect(readThreadQueue(ref)).toEqual([]);
  });

  it("holds a single dispatch in flight and queues the rest", async () => {
    const drain = createComposerQueueDrain();
    const started: string[] = [];
    let release = (): void => {};
    const dispatch = async (item: { readonly text: string }): Promise<boolean> => {
      started.push(item.text);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return true;
    };

    const first = drain.submit(context(false, dispatch), { text: "one", attachments: [] });
    expect(drain.isDispatching()).toBe(true);

    await drain.submit(context(false, dispatch), { text: "two", attachments: [] });
    expect(started).toEqual(["one"]);
    expect(readThreadQueue(ref).map((item) => item.text)).toEqual(["two"]);

    release();
    await first;
    expect(drain.isDispatching()).toBe(false);
  });
});
