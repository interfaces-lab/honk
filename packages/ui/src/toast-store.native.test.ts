import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getToasts, invokeToastAction, subscribeToasts, toast } from "./toast-store.native";

beforeEach(() => {
  vi.useFakeTimers();
  toast.dismiss();
});

afterEach(() => {
  toast.dismiss();
  vi.useRealTimers();
});

describe("toast", () => {
  test("adds a typed toast carrying title, description, and action", () => {
    const run = vi.fn();
    const id = toast.error("Send failed", {
      description: "The server closed the run.",
      action: { label: "Retry", run },
    });

    expect(getToasts()).toEqual([
      {
        id,
        type: "error",
        title: "Send failed",
        description: "The server closed the run.",
        action: { label: "Retry", run },
      },
    ]);
  });

  test("omits description and action when they are not supplied", () => {
    toast.success("done");

    expect(getToasts()[0]).toEqual({ id: expect.any(String), type: "success", title: "done" });
  });

  test("mints a distinct id per toast", () => {
    expect(toast("first")).not.toBe(toast("second"));
  });

  test("routes each helper to its own type", () => {
    toast("bare");
    toast.success("a");
    toast.error("b");

    expect(getToasts().map((item) => item.type)).toEqual(["info", "success", "error"]);
  });
});

describe("auto dismiss", () => {
  test("holds a toast for five seconds and then drops it", () => {
    toast.success("done");

    vi.advanceTimersByTime(4_999);
    expect(getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  test("honors a caller supplied duration", () => {
    toast.info("working", { durationMs: 200 });

    vi.advanceTimersByTime(199);
    expect(getToasts()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  test("holds a loading toast open indefinitely", () => {
    toast.loading("working");

    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
  });

  test("treats a zero duration as hold open", () => {
    toast.error("failed", { durationMs: 0 });

    vi.advanceTimersByTime(60_000);
    expect(getToasts()).toHaveLength(1);
  });
});

describe("stack", () => {
  test("keeps the three newest toasts", () => {
    toast("one");
    toast("two");
    toast("three");
    toast("four");

    expect(getToasts().map((item) => item.title)).toEqual(["two", "three", "four"]);
  });

  test("a dropped toast's timer never dismisses a survivor", () => {
    toast("one", { durationMs: 100 });
    toast("two", { durationMs: 5_000 });
    toast("three", { durationMs: 5_000 });
    toast("four", { durationMs: 5_000 });

    vi.advanceTimersByTime(100);
    expect(getToasts().map((item) => item.title)).toEqual(["two", "three", "four"]);
  });
});

describe("dismiss", () => {
  test("removes one toast by id and leaves the rest", () => {
    const first = toast("one");
    toast("two");

    toast.dismiss(first);

    expect(getToasts().map((item) => item.title)).toEqual(["two"]);
  });

  test("cancels the pending timer for the dismissed toast", () => {
    const id = toast("one", { durationMs: 100 });
    toast.dismiss(id);
    const survivor = toast("two", { durationMs: 5_000 });

    vi.advanceTimersByTime(100);
    expect(getToasts().map((item) => item.id)).toEqual([survivor]);
  });

  test("clears every toast when no id is given", () => {
    toast("one");
    toast("two");

    toast.dismiss();

    expect(getToasts()).toHaveLength(0);
  });

  test("ignores an unknown id", () => {
    toast("one");
    const before = getToasts();

    toast.dismiss("honk-toast-does-not-exist");

    expect(getToasts()).toBe(before);
  });
});

describe("actions", () => {
  test("runs the action and then dismisses its toast", () => {
    const run = vi.fn();
    const id = toast.error("Send failed", { action: { label: "Retry", run } });

    invokeToastAction(id);

    expect(run).toHaveBeenCalledTimes(1);
    expect(getToasts()).toHaveLength(0);
  });

  test("does nothing for a toast without an action", () => {
    const id = toast("one");

    invokeToastAction(id);

    expect(getToasts()).toHaveLength(1);
  });
});

describe("subscription", () => {
  test("notifies subscribers on add and dismiss", () => {
    const listener = vi.fn();
    subscribeToasts(listener);

    const id = toast("one");
    toast.dismiss(id);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    subscribeToasts(listener)();

    toast("one");

    expect(listener).not.toHaveBeenCalled();
  });

  test("returns a stable snapshot between reads so useSyncExternalStore does not loop", () => {
    toast("one");

    expect(getToasts()).toBe(getToasts());
  });
});
