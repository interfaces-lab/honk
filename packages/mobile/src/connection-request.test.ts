import { describe, expect, it, vi } from "vitest";

import {
  ConnectionRequestTimeoutError,
  createBoundedConnectionFetch,
  createConnectionAttemptFetch,
  runWithConnectionDeadline,
  runWithConnectionRequestDeadline,
} from "./connection-request";

describe("createBoundedConnectionFetch", () => {
  it("aborts a request when its connection attempt is stopped", async () => {
    const controller = new AbortController();
    const request = createBoundedConnectionFetch({
      signal: controller.signal,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("stopped")), {
            once: true,
          });
        }),
    })("https://computer.example.com/health");

    controller.abort();

    await expect(request).rejects.toThrow("stopped");
  });

  it("bounds a stalled request", async () => {
    vi.useFakeTimers();
    const request = createBoundedConnectionFetch({
      timeoutMs: 15_000,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request stopped")), {
            once: true,
          });
        }),
    })("https://computer.example.com/health");
    const rejected = expect(request).rejects.toBeInstanceOf(ConnectionRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    vi.useRealTimers();
  });

  it("keeps the caller's request signal", async () => {
    const controller = new AbortController();
    const request = createBoundedConnectionFetch({
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("request stopped")), {
            once: true,
          });
        }),
    })("https://computer.example.com/health", { signal: controller.signal });

    controller.abort();

    await expect(request).rejects.toThrow("request stopped");
  });

  it("bounds a response body that stalls after headers", async () => {
    vi.useFakeTimers();
    const request = createBoundedConnectionFetch({
      timeoutMs: 15_000,
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(stream) {
              init?.signal?.addEventListener(
                "abort",
                () => stream.error(new Error("body stopped")),
                { once: true },
              );
            },
          }),
        ),
    });
    const response = await request("https://computer.example.com/sessions");
    const body = response.json();
    const rejected = expect(body).rejects.toBeInstanceOf(ConnectionRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    vi.useRealTimers();
  });

  it("bounds an establishment body with the direct attempt signal", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = createConnectionAttemptFetch({
      signal: controller.signal,
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(stream) {
              init?.signal?.addEventListener(
                "abort",
                () => stream.error(new Error("body stopped")),
                { once: true },
              );
            },
          }),
        ),
    });
    const establishment = runWithConnectionDeadline(
      controller,
      async () => {
        const response = await request("https://computer.example.com/health");
        return response.json();
      },
      15_000,
    );
    const rejected = expect(establishment).rejects.toBeInstanceOf(ConnectionRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    expect(controller.signal.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("times out one request without cancelling its owning pairing attempt", async () => {
    vi.useFakeTimers();
    const owner = new AbortController();
    const requestSignals: AbortSignal[] = [];
    const request = runWithConnectionRequestDeadline(
      owner.signal,
      (signal) => {
        requestSignals.push(signal);
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("request stopped")), {
            once: true,
          });
        });
      },
      15_000,
    );
    const rejected = expect(request).rejects.toBeInstanceOf(ConnectionRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
    expect(owner.signal.aborted).toBe(false);
    expect(requestSignals).toHaveLength(1);
    expect(requestSignals[0]?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("stops an attempt immediately when its owner aborts", async () => {
    const controller = new AbortController();
    const establishment = runWithConnectionDeadline(
      controller,
      () => new Promise<never>(() => undefined),
      15_000,
    );

    controller.abort();

    await expect(establishment).rejects.toThrow("This connection attempt was stopped.");
  });
});
