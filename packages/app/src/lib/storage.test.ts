import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncedJSONStorage, createDebouncedStorage } from "./storage";

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => store.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

describe("createDebouncedStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write to base storage until the debounce fires", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledWith("key", "v1");
  });
});

describe("createDebouncedJSONStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses stored JSON immediately", () => {
    const base = createMockStorage();
    base.setItem("key", JSON.stringify({ state: { value: "stored" }, version: 1 }));
    const storage = createDebouncedJSONStorage<{ value: string }>(base);

    expect(storage.getItem("key")).toEqual({ state: { value: "stored" }, version: 1 });
  });

  it("defers JSON serialization until the debounce fires", () => {
    const base = createMockStorage();
    const toJSON = vi.fn(() => "serialized");
    const storage = createDebouncedJSONStorage<{
      payload: { toJSON: () => string };
    }>(base);

    storage.setItem("key", { state: { payload: { toJSON } }, version: 1 });

    expect(toJSON).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(toJSON).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith(
      "key",
      '{"state":{"payload":"serialized"},"version":1}',
    );
  });

  it("only serializes the latest pending JSON value", () => {
    const base = createMockStorage();
    const firstToJSON = vi.fn(() => "first");
    const secondToJSON = vi.fn(() => "second");
    const storage = createDebouncedJSONStorage<{
      payload: { toJSON: () => string };
    }>(base);

    storage.setItem("key", { state: { payload: { toJSON: firstToJSON } }, version: 1 });
    storage.setItem("key", { state: { payload: { toJSON: secondToJSON } }, version: 1 });

    vi.advanceTimersByTime(300);
    expect(firstToJSON).not.toHaveBeenCalled();
    expect(secondToJSON).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith(
      "key",
      '{"state":{"payload":"second"},"version":1}',
    );
  });

  it("flush serializes and writes the pending value immediately", () => {
    const base = createMockStorage();
    const storage = createDebouncedJSONStorage<{ value: string }>(base);

    storage.setItem("key", { state: { value: "v1" }, version: 1 });
    expect(base.setItem).not.toHaveBeenCalled();

    storage.flush();
    expect(base.setItem).toHaveBeenCalledWith(
      "key",
      '{"state":{"value":"v1"},"version":1}',
    );

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });
});
