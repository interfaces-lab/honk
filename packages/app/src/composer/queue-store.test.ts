import { afterEach, describe, expect, it } from "vitest";

import {
  enqueueThreadMessage,
  migrateThreadQueue,
  readThreadQueue,
  removeThreadMessage,
  removeThreadMessages,
  reorderThreadMessage,
  replaceThreadMessage,
  shiftThreadMessage,
  unshiftThreadMessage,
} from "./queue-store";

const THREAD = "test:queue-thread";
const OTHER_THREAD = "test:queue-thread:other";
const LEGACY_THREAD = "ses_same";
const QUALIFIED_THREAD = "session:http%3A%2F%2Fserver-a:ses_same";

function drain(threadId: string): void {
  while (shiftThreadMessage(threadId) !== undefined) {
    // emptied via shift
  }
}

afterEach(() => {
  drain(THREAD);
  drain(OTHER_THREAD);
  drain(LEGACY_THREAD);
  drain(QUALIFIED_THREAD);
});

describe("composer queue store", () => {
  it("appends in FIFO order and shifts from the head", () => {
    enqueueThreadMessage(THREAD, { text: "first", files: [] });
    enqueueThreadMessage(THREAD, { text: "second", files: [] });

    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["first", "second"]);
    expect(shiftThreadMessage(THREAD)?.text).toBe("first");
    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["second"]);
  });

  it("keeps queues isolated by thread", () => {
    enqueueThreadMessage(THREAD, { text: "mine", files: [] });
    enqueueThreadMessage(OTHER_THREAD, { text: "theirs", files: [] });

    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["mine"]);
    expect(readThreadQueue(OTHER_THREAD).map((item) => item.text)).toEqual(["theirs"]);
  });

  it("moves a legacy session-id queue to its server-qualified task key", () => {
    enqueueThreadMessage(LEGACY_THREAD, { text: "mine", files: [] });

    migrateThreadQueue(LEGACY_THREAD, QUALIFIED_THREAD);

    expect(readThreadQueue(LEGACY_THREAD)).toEqual([]);
    expect(readThreadQueue(QUALIFIED_THREAD).map((item) => item.text)).toEqual(["mine"]);
  });

  it("captures the agent chosen at enqueue time", () => {
    enqueueThreadMessage(THREAD, { text: "later", files: [], agent: "plan" });

    expect(readThreadQueue(THREAD)[0]?.agent).toBe("plan");
  });

  it("keeps Lexical state with queued messages and edits", () => {
    const queued = enqueueThreadMessage(THREAD, {
      text: "review ",
      files: [],
      editorState: '{"root":{"children":["mention"]}}',
    });

    expect(readThreadQueue(THREAD)[0]?.editorState).toBe('{"root":{"children":["mention"]}}');

    replaceThreadMessage(THREAD, queued.id, {
      text: "review this ",
      files: [],
      editorState: '{"root":{"children":["command"]}}',
    });

    expect(readThreadQueue(THREAD)[0]?.editorState).toBe('{"root":{"children":["command"]}}');
  });

  it("keeps file-mention source ranges with queued messages", () => {
    enqueueThreadMessage(THREAD, {
      text: "Review @docs/handbook.md",
      files: [
        {
          path: "docs/handbook.md",
          filename: "handbook.md",
          source: { text: "@docs/handbook.md", start: 7, end: 24 },
        },
      ],
    });

    expect(readThreadQueue(THREAD)[0]?.files[0]?.source).toEqual({
      text: "@docs/handbook.md",
      start: 7,
      end: 24,
    });
  });

  it("removes by id", () => {
    const kept = enqueueThreadMessage(THREAD, { text: "kept", files: [] });
    const removed = enqueueThreadMessage(THREAD, { text: "removed", files: [] });

    removeThreadMessage(THREAD, removed.id);

    expect(readThreadQueue(THREAD).map((item) => item.id)).toEqual([kept.id]);
  });

  it("removes a submitted batch without dropping messages queued afterward", () => {
    const first = enqueueThreadMessage(THREAD, { text: "first", files: [] });
    const second = enqueueThreadMessage(THREAD, { text: "second", files: [] });
    const later = enqueueThreadMessage(THREAD, { text: "later", files: [] });

    removeThreadMessages(THREAD, new Set([first.id, second.id]));

    expect(readThreadQueue(THREAD).map((item) => item.id)).toEqual([later.id]);
  });

  it("replaces in place so an edit keeps its position", () => {
    enqueueThreadMessage(THREAD, { text: "a", files: [] });
    const edited = enqueueThreadMessage(THREAD, { text: "b", files: [] });
    enqueueThreadMessage(THREAD, { text: "c", files: [] });

    replaceThreadMessage(THREAD, edited.id, { text: "b2", files: [], agent: "debug" });

    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["a", "b2", "c"]);
    expect(readThreadQueue(THREAD)[1]?.id).toBe(edited.id);
    expect(readThreadQueue(THREAD)[1]?.agent).toBe("debug");
  });

  it("restores a failed dispatch to the front", () => {
    enqueueThreadMessage(THREAD, { text: "first", files: [] });
    enqueueThreadMessage(THREAD, { text: "second", files: [] });

    const head = shiftThreadMessage(THREAD);
    expect(head).toBeDefined();
    if (head !== undefined) unshiftThreadMessage(THREAD, head);

    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("reorders before and after a target", () => {
    const a = enqueueThreadMessage(THREAD, { text: "a", files: [] });
    enqueueThreadMessage(THREAD, { text: "b", files: [] });
    const c = enqueueThreadMessage(THREAD, { text: "c", files: [] });

    reorderThreadMessage(THREAD, a.id, c.id, true);
    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["b", "c", "a"]);

    reorderThreadMessage(THREAD, a.id, c.id, false);
    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["b", "a", "c"]);
  });

  it("ignores a reorder against a missing target", () => {
    const a = enqueueThreadMessage(THREAD, { text: "a", files: [] });
    enqueueThreadMessage(THREAD, { text: "b", files: [] });

    reorderThreadMessage(THREAD, a.id, "missing", true);

    expect(readThreadQueue(THREAD).map((item) => item.text)).toEqual(["a", "b"]);
  });
});
