import { beforeEach, describe, expect, it, vi } from "vitest";
import { scopeThreadRef } from "@multi/client-runtime";
import { ThreadId } from "@multi/contracts";

import {
  clearLastChatRouteTarget,
  readLastChatRouteTarget,
  writeLastChatRouteTarget,
} from "./chat-route-persistence";
import type { DraftId } from "./stores/chat-drafts";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("chat route persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createStorage() });
  });

  it("stores and reads the last server thread route", () => {
    const target = {
      kind: "server" as const,
      threadRef: scopeThreadRef("env-1" as never, ThreadId.make("thread-1")),
    };

    writeLastChatRouteTarget(target);

    expect(readLastChatRouteTarget()).toEqual(target);
  });

  it("stores and reads the last draft route", () => {
    const target = {
      kind: "draft" as const,
      draftId: "draft-1" as DraftId,
    };

    writeLastChatRouteTarget(target);

    expect(readLastChatRouteTarget()).toEqual(target);
  });

  it("clears only the matching stale route", () => {
    const target = {
      kind: "server" as const,
      threadRef: scopeThreadRef("env-1" as never, ThreadId.make("thread-1")),
    };
    writeLastChatRouteTarget(target);

    clearLastChatRouteTarget({
      kind: "server",
      threadRef: scopeThreadRef("env-1" as never, ThreadId.make("thread-2")),
    });
    expect(readLastChatRouteTarget()).toEqual(target);

    clearLastChatRouteTarget(target);
    expect(readLastChatRouteTarget()).toBeNull();
  });
});
