import type { OpenCodeFileApi } from "@honk/opencode";
import { afterEach, describe, expect, it, vi } from "vitest";

import { findFileSuggestions } from "./file-suggestions";

const result = {
  location: {
    directory: "/Users/test/Documents",
    project: { id: "project", directory: "/Users/test/Documents" },
  },
  data: [{ path: "src/index.ts", type: "file" }],
} satisfies Awaited<ReturnType<OpenCodeFileApi["find"]>>;

afterEach(() => {
  vi.useRealTimers();
});

describe("file suggestions", () => {
  it("retries a stalled search with a fresh request signal", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const find = vi.fn<OpenCodeFileApi["find"]>((_query, _location, options) => {
      if (options?.signal !== undefined) signals.push(options.signal);
      if (find.mock.calls.length === 2) return Promise.resolve(result);
      return rejectWhenAborted(options?.signal);
    });

    const search = findFileSuggestions({
      files: { find },
      query: "index",
      directory: "/Users/test/Documents",
      signal: new AbortController().signal,
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(search).resolves.toEqual(result);
    expect(find).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(signals[1]).not.toBe(signals[0]);
  });

  it("quietly gives up after the retry also stalls", async () => {
    vi.useFakeTimers();
    const find = vi.fn<OpenCodeFileApi["find"]>((_query, _location, options) =>
      rejectWhenAborted(options?.signal),
    );

    const search = findFileSuggestions({
      files: { find },
      query: "index",
      signal: new AbortController().signal,
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(200);

    await expect(search).resolves.toBeNull();
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("does not retry a search superseded by the composer", async () => {
    const controller = new AbortController();
    const find = vi.fn<OpenCodeFileApi["find"]>((_query, _location, options) =>
      rejectWhenAborted(options?.signal),
    );

    const search = findFileSuggestions({
      files: { find },
      query: "index",
      signal: controller.signal,
    });
    controller.abort();

    await expect(search).resolves.toBeNull();
    expect(find).toHaveBeenCalledOnce();
  });
});

function rejectWhenAborted(signal?: AbortSignal): Promise<never> {
  if (signal === undefined) return Promise.reject(new Error("Expected an abort signal"));
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
