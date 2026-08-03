import { describe, expect, it, vi } from "vitest";

import { readRemoteServerRegistry, writeRemoteServerRegistry } from "./server-registry";

describe("remote server registry", () => {
  it("keeps valid servers when neighboring entries or selection are malformed", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          selectedRemoteOrigin: "https://computer.example.com/",
          servers: [
            {
              origin: "https://computer.example.com/",
              label: "  Studio  ",
              protectedCredential: "protected-password",
              pendingPairing: null,
            },
            { origin: "not a URL" },
            null,
          ],
        }),
      setItem: vi.fn(),
    };

    expect(readRemoteServerRegistry(storage)).toEqual({
      version: 1,
      selectedRemoteOrigin: "https://computer.example.com",
      servers: [
        {
          origin: "https://computer.example.com",
          label: "Studio",
          protectedCredential: "protected-password",
          pendingPairing: null,
          paired: false,
          removing: false,
        },
      ],
    });
  });

  it("round-trips cleanup ownership and reports storage failures", () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    const registry = {
      selectedRemoteOrigin: null,
      servers: [
        {
          origin: "https://computer.example.com",
          label: "Studio",
          protectedCredential: null,
          pendingPairing: {
            phase: "confirm" as const,
            requestId: "request-0001",
            expiresAt: "2026-07-20T18:10:00.000Z",
            protectedCredential: "protected-provisional",
          },
          paired: true,
          removing: true,
        },
      ],
    };

    expect(writeRemoteServerRegistry(registry, storage)).toBeNull();
    expect(readRemoteServerRegistry(storage)).toMatchObject(registry);
    expect(
      writeRemoteServerRegistry(registry, {
        getItem: () => null,
        setItem: () => {
          throw new Error("Storage is full.");
        },
      }),
    ).toBe("Storage is full.");
  });
});
