import { afterEach, describe, expect, it, vi } from "vitest";
import { openCodeServerKey, openCodeSessionKey, openCodeSessionRef } from "@honk/opencode";

import type { ComposerImage } from "../chat-composer";

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

import {
  enqueueThreadMessage,
  readThreadQueue,
  removeThreadMessage,
  replaceThreadMessage,
  shiftThreadMessage,
  subscribeThreadQueues,
  unshiftThreadMessage,
  type QueueItem,
} from "./queue-store";

const server = openCodeServerKey("https://mac.example.com");
const alpha = openCodeSessionRef(server, "ses_alpha");
const beta = openCodeSessionRef(server, "ses_beta");
const otherServer = openCodeSessionRef(
  openCodeServerKey("https://laptop.example.com"),
  "ses_alpha",
);

const image = (id: string, uri: string): ComposerImage => ({
  id,
  uri: `file:///tmp/${id}.jpg`,
  file: { uri, name: `${id}.jpg` },
});

const drain = (ref: typeof alpha): void => {
  for (const item of readThreadQueue(ref)) removeThreadMessage(ref, item.id);
};

afterEach(() => {
  drain(alpha);
  drain(beta);
  drain(otherServer);
});

describe("queue-store", () => {
  it("appends messages and reads them back in order", () => {
    enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    expect(readThreadQueue(alpha).map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("mints a distinct id per message", () => {
    const first = enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    const second = enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    expect(first.id).not.toBe(second.id);
  });

  it("keeps queues isolated per session", () => {
    enqueueThreadMessage(alpha, { text: "alpha", attachments: [] });
    enqueueThreadMessage(beta, { text: "beta", attachments: [] });
    expect(readThreadQueue(alpha).map((item) => item.text)).toEqual(["alpha"]);
    expect(readThreadQueue(beta).map((item) => item.text)).toEqual(["beta"]);
  });

  it("keys by server-qualified identity, not session id alone", () => {
    enqueueThreadMessage(alpha, { text: "mac", attachments: [] });
    expect(readThreadQueue(otherServer)).toEqual([]);
  });

  it("removes a single message", () => {
    const first = enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    removeThreadMessage(alpha, first.id);
    expect(readThreadQueue(alpha).map((item) => item.text)).toEqual(["second"]);
  });

  it("replaces a message in place, keeping its id and position", () => {
    enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    const second = enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    enqueueThreadMessage(alpha, { text: "third", attachments: [] });
    replaceThreadMessage(alpha, second.id, { text: "edited", attachments: [], agent: "plan" });
    expect(readThreadQueue(alpha).map((item) => item.text)).toEqual(["first", "edited", "third"]);
    expect(readThreadQueue(alpha)[1]?.id).toBe(second.id);
    expect(readThreadQueue(alpha)[1]?.agent).toBe("plan");
  });

  it("shifts the head off the front and returns it", () => {
    const first = enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    expect(shiftThreadMessage(alpha)).toEqual(first);
    expect(readThreadQueue(alpha).map((item) => item.text)).toEqual(["second"]);
  });

  it("returns undefined when shifting an empty queue", () => {
    expect(shiftThreadMessage(alpha)).toBeUndefined();
  });

  it("unshifts a failed message back to the front", () => {
    const first = enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    const head = shiftThreadMessage(alpha) as QueueItem;
    unshiftThreadMessage(alpha, head);
    expect(readThreadQueue(alpha).map((item) => item.text)).toEqual(["first", "second"]);
    expect(readThreadQueue(alpha)[0]?.id).toBe(first.id);
  });

  it("notifies subscribers on every mutation and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThreadQueues(listener);
    const item = enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    removeThreadMessage(alpha, item.id);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    enqueueThreadMessage(alpha, { text: "second", attachments: [] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("persists message text but drops inlined data: attachments", () => {
    enqueueThreadMessage(alpha, {
      text: "look at this",
      attachments: [image("a", "data:image/jpeg;base64,AAAA"), image("b", "blob:whatever")],
    });
    expect(readThreadQueue(alpha)[0]?.attachments).toHaveLength(2);

    const persisted: unknown = JSON.parse(
      native.mmkv.get("honk.mobile.composer.queues.v1") ?? "{}",
    );
    const stored = Object.values(persisted as Record<string, readonly QueueItem[]>).flat();
    expect(stored.map((item) => item.text)).toEqual(["look at this"]);
    expect(stored[0]?.attachments).toEqual([]);
  });

  it("drops the session key entirely once its queue empties", () => {
    const item = enqueueThreadMessage(alpha, { text: "first", attachments: [] });
    removeThreadMessage(alpha, item.id);
    expect(JSON.parse(native.mmkv.get("honk.mobile.composer.queues.v1") ?? "{}")).toEqual({});
  });

  it("restores queued text on the next launch", async () => {
    native.mmkv.set(
      "honk.mobile.composer.queues.v1",
      JSON.stringify({
        [openCodeSessionKey(alpha)]: [{ id: "q1", text: "still here", attachments: [] }],
      }),
    );
    vi.resetModules();
    const relaunched = await import("./queue-store");
    expect(relaunched.readThreadQueue(alpha).map((item) => item.text)).toEqual(["still here"]);
    native.mmkv.clear();
  });

  it("drops a relaunched message left with neither text nor attachments", async () => {
    native.mmkv.set(
      "honk.mobile.composer.queues.v1",
      JSON.stringify({
        [openCodeSessionKey(alpha)]: [
          { id: "q1", text: "  ", attachments: [] },
          { id: "q2", text: "still here", attachments: [] },
        ],
      }),
    );
    vi.resetModules();
    const relaunched = await import("./queue-store");
    expect(relaunched.readThreadQueue(alpha).map((item) => item.id)).toEqual(["q2"]);
    native.mmkv.clear();
  });

  it("survives a corrupt stored blob", async () => {
    native.mmkv.set("honk.mobile.composer.queues.v1", "{not json");
    vi.resetModules();
    const relaunched = await import("./queue-store");
    expect(relaunched.readThreadQueue(alpha)).toEqual([]);
    native.mmkv.clear();
  });
});
