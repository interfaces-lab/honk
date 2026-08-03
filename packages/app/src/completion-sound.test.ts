import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ play: vi.fn() }));

vi.mock("cuelume", () => ({ play: mocks.play }));

type TestTransaction = {
  error: DOMException | null;
  onabort: (() => void) | null;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
};

const transactions: TestTransaction[] = [];
const operations: string[] = [];

beforeEach(() => {
  vi.resetModules();
  transactions.length = 0;
  operations.length = 0;
  mocks.play.mockClear();
  vi.stubGlobal("indexedDB", {
    open: vi.fn(() => {
      const request: {
        error: DOMException | null;
        onblocked: (() => void) | null;
        onerror: (() => void) | null;
        onsuccess: (() => void) | null;
        onupgradeneeded: (() => void) | null;
        result: {
          close: () => void;
          createObjectStore: () => void;
          objectStoreNames: { contains: () => boolean };
          transaction: () => TestTransaction & {
            objectStore: () => {
              delete: () => void;
              put: () => void;
            };
          };
        };
      } = {
        error: null,
        onblocked: null,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          close: vi.fn(),
          createObjectStore: vi.fn(),
          objectStoreNames: { contains: () => true },
          transaction: () => {
            const transaction = {
              error: null,
              onabort: null,
              oncomplete: null,
              onerror: null,
              objectStore: () => ({
                delete: () => {
                  operations.push("delete");
                },
                put: () => {
                  operations.push("put");
                },
              }),
            } satisfies TestTransaction & {
              objectStore: () => { delete: () => void; put: () => void };
            };
            transactions.push(transaction);
            return transaction;
          },
        },
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alert sound storage", () => {
  it("uses Cuelume's ready sound by default", async () => {
    const sound = await import("./completion-sound");

    await expect(sound.playAlertSound("ready", null)).resolves.toBe("built-in");
    expect(mocks.play).toHaveBeenCalledWith("ready");
  });

  it("plays the selected built-in alert", async () => {
    const sound = await import("./completion-sound");

    await expect(sound.playAlertSound("chime", null)).resolves.toBe("built-in");
    expect(mocks.play).toHaveBeenCalledWith("chime");
  });

  it("serializes saves and deletes in request order", async () => {
    const sound = await import("./completion-sound");
    const save = sound.saveCustomAlertSound(new Blob(["sound"]));
    const reset = sound.deleteCustomAlertSound();
    await flushMicrotasks();

    expect(operations).toEqual(["put"]);
    expect(transactions).toHaveLength(1);
    transactions[0]?.oncomplete?.();
    await save;
    await flushMicrotasks();

    expect(operations).toEqual(["put", "delete"]);
    expect(transactions).toHaveLength(2);
    transactions[1]?.oncomplete?.();
    await reset;
  });

  it("continues the queue after a failed write", async () => {
    const sound = await import("./completion-sound");
    const failedSave = sound.saveCustomAlertSound(new Blob(["sound"]));
    const reset = sound.deleteCustomAlertSound();
    await flushMicrotasks();

    transactions[0]?.onerror?.();
    await expect(failedSave).rejects.toThrow("Could not save the sound");
    await flushMicrotasks();

    expect(operations).toEqual(["put", "delete"]);
    transactions[1]?.oncomplete?.();
    await reset;
  });
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
