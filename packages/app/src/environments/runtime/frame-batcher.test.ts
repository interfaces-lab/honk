import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrameBatcher } from "./frame-batcher";

describe("createFrameBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("flushes on the timeout when requestAnimationFrame is scheduled but does not fire", async () => {
    const flush = vi.fn();
    const requestAnimationFrame = vi.fn(() => 1);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const batcher = createFrameBatcher({ flush, timeoutMs: 16 });

    batcher.enqueue("a");
    await vi.advanceTimersByTimeAsync(15);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledWith(["a"]);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("flushes once when requestAnimationFrame fires before the timeout", async () => {
    const flush = vi.fn();
    const animationFrameCallbackRef: { current: FrameRequestCallback | null } = {
      current: null,
    };
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      animationFrameCallbackRef.current = callback;
      return 1;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const batcher = createFrameBatcher({ flush, timeoutMs: 16 });

    batcher.enqueue("a");
    batcher.enqueue("b");
    const animationFrameCallback = animationFrameCallbackRef.current;
    if (!animationFrameCallback) {
      throw new Error("Expected requestAnimationFrame callback to be scheduled.");
    }
    animationFrameCallback(0);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(["a", "b"]);

    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledOnce();
  });
});
