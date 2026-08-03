import { openCodeServerKey } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  credentialStorageKey,
  decodeStoredRegistry,
  findRebindableServer,
  sameStoredRegistry,
  type StoredServer,
} from "./server-registry-store";

const stored = (
  origin: string,
  serverId: string | null,
  label = "Studio Mac",
  managed: Pick<StoredServer, "environmentId" | "deviceId" | "proofKeyThumbprint"> = {},
): StoredServer => ({
  ...managed,
  origin,
  label,
  defaultDirectory: "/Users/me/Developer",
  serverId,
});

describe("server registry storage", () => {
  it("decodes version 1 entries without identities and upgrades the in-memory version", () => {
    const registry = decodeStoredRegistry({
      schema: "honk.mobile.opencode.servers",
      version: 1,
      activeServerKey: "https://mac.example.com",
      servers: [
        {
          origin: "https://mac.example.com",
          label: "Studio Mac",
          defaultDirectory: "/Users/me/Developer",
          environmentId: "ignored-environment",
          deviceId: "ignored-device",
          proofKeyThumbprint: "ignored-thumbprint",
        },
        {
          origin: "https://laptop.example.com",
          label: "Laptop",
          defaultDirectory: "",
        },
      ],
    });

    expect(registry.version).toBe(3);
    expect(registry.servers.map((server) => server.serverId)).toEqual([null, null]);
    expect(
      registry.servers.map((server) => ({
        environmentId: server.environmentId,
        deviceId: server.deviceId,
        proofKeyThumbprint: server.proofKeyThumbprint,
      })),
    ).toEqual([
      {
        environmentId: null,
        deviceId: null,
        proofKeyThumbprint: null,
      },
      {
        environmentId: null,
        deviceId: null,
        proofKeyThumbprint: null,
      },
    ]);
  });

  it("preserves version 2 server identities and clears managed identities", () => {
    const registry = decodeStoredRegistry({
      schema: "honk.mobile.opencode.servers",
      version: 2,
      activeServerKey: null,
      servers: [
        {
          origin: "https://mac.example.com",
          label: "Studio Mac",
          defaultDirectory: "",
          serverId: "server-mac",
          environmentId: "ignored-environment",
          deviceId: "ignored-device",
          proofKeyThumbprint: "ignored-thumbprint",
        },
        {
          origin: "https://laptop.example.com",
          label: "Laptop",
          defaultDirectory: "",
          serverId: null,
        },
      ],
    });

    expect(registry.servers.map((server) => server.serverId)).toEqual(["server-mac", null]);
    expect(
      registry.servers.map((server) => [
        server.environmentId,
        server.deviceId,
        server.proofKeyThumbprint,
      ]),
    ).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("preserves version 3 managed identities and normalizes missing values", () => {
    const registry = decodeStoredRegistry({
      schema: "honk.mobile.opencode.servers",
      version: 3,
      activeServerKey: null,
      servers: [
        {
          origin: "https://mac.example.com",
          label: "Studio Mac",
          defaultDirectory: "",
          serverId: "server-mac",
          environmentId: " environment-mac ",
          deviceId: " device-phone ",
          proofKeyThumbprint: " thumbprint-phone ",
        },
        {
          origin: "https://laptop.example.com",
          label: "Laptop",
          defaultDirectory: "",
          serverId: null,
          environmentId: null,
        },
      ],
    });

    expect(registry.servers).toEqual([
      {
        origin: "https://mac.example.com",
        label: "Studio Mac",
        defaultDirectory: "",
        serverId: "server-mac",
        environmentId: "environment-mac",
        deviceId: "device-phone",
        proofKeyThumbprint: "thumbprint-phone",
      },
      {
        origin: "https://laptop.example.com",
        label: "Laptop",
        defaultDirectory: "",
        serverId: null,
        environmentId: null,
        deviceId: null,
        proofKeyThumbprint: null,
      },
    ]);
  });

  it("rejects unsupported versions and schemas", () => {
    expect(() =>
      decodeStoredRegistry({
        schema: "honk.mobile.opencode.servers",
        version: 4,
        activeServerKey: null,
        servers: [],
      }),
    ).toThrow("unsupported format");
    expect(() =>
      decodeStoredRegistry({
        schema: "other",
        version: 2,
        activeServerKey: null,
        servers: [],
      }),
    ).toThrow("unsupported format");
  });

  it("rejects two origins for the same managed environment", () => {
    expect(() =>
      decodeStoredRegistry({
        schema: "honk.mobile.opencode.servers",
        version: 3,
        activeServerKey: null,
        servers: [
          {
            origin: "https://old.example.com",
            label: "Studio Mac",
            defaultDirectory: "",
            environmentId: "environment-mac",
          },
          {
            origin: "https://new.example.com",
            label: "Studio Mac",
            defaultDirectory: "",
            environmentId: " environment-mac ",
          },
        ],
      }),
    ).toThrow("duplicate environment");
  });

  it("normalizes durable credential cleanup markers", () => {
    expect(
      decodeStoredRegistry({
        schema: "honk.mobile.opencode.servers",
        version: 3,
        activeServerKey: null,
        pendingCredentialOrigins: [" HTTPS://OLD.EXAMPLE.COM/ "],
        servers: [],
      }).pendingCredentialOrigins,
    ).toEqual(["https://old.example.com"]);
  });

  it("rejects duplicate durable credential cleanup markers", () => {
    expect(() =>
      decodeStoredRegistry({
        schema: "honk.mobile.opencode.servers",
        version: 3,
        activeServerKey: null,
        pendingCredentialOrigins: ["https://old.example.com", "https://OLD.example.com/"],
        servers: [],
      }),
    ).toThrow("duplicate credential cleanup");
  });

  it.each([
    ["environmentId", ""],
    ["environmentId", "   "],
    ["deviceId", 42],
    ["proofKeyThumbprint", false],
  ])("rejects an invalid version 3 %s value", (field, invalid) => {
    expect(() =>
      decodeStoredRegistry({
        schema: "honk.mobile.opencode.servers",
        version: 3,
        activeServerKey: null,
        servers: [
          {
            origin: "https://mac.example.com",
            label: "Studio Mac",
            defaultDirectory: "",
            [field]: invalid,
          },
        ],
      }),
    ).toThrow(`invalid ${field}`);
  });

  it("keeps legacy credential keys byte-identical", () => {
    expect(credentialStorageKey("https://honk.example.com")).toBe(
      "honk.mobile.opencode.credential.563dbd1f",
    );
    expect(credentialStorageKey("http://192.168.1.24:4321")).toBe(
      "honk.mobile.opencode.credential.1a263b69",
    );
  });

  it("only finds the same identity at a different origin", () => {
    const origin = "https://mac.example.com";
    const otherOrigin = "https://mac-new.example.com";
    const servers = new Map([
      [
        openCodeServerKey(origin),
        stored(origin, "server-mac", "Studio Mac", {
          environmentId: "environment-mac",
          deviceId: "device-phone",
          proofKeyThumbprint: "thumbprint-phone",
        }),
      ],
      [
        openCodeServerKey("https://laptop.example.com"),
        stored("https://laptop.example.com", "server-laptop", "Laptop"),
      ],
    ]);

    expect(findRebindableServer(servers, otherOrigin, null)).toBeNull();
    expect(findRebindableServer(servers, origin, "server-mac")).toBeNull();
    expect(findRebindableServer(servers, otherOrigin, "server-mac")).toEqual([
      openCodeServerKey(origin),
      servers.get(openCodeServerKey(origin)),
    ]);
    expect(findRebindableServer(servers, otherOrigin, "environment-mac")).toBeNull();
    expect(findRebindableServer(servers, otherOrigin, "server-unknown")).toBeNull();
  });

  it.each([
    ["serverId", stored("https://mac.example.com", "server-two")],
    [
      "environmentId",
      stored("https://mac.example.com", "server-one", "Studio Mac", {
        environmentId: "environment-two",
      }),
    ],
    [
      "deviceId",
      stored("https://mac.example.com", "server-one", "Studio Mac", {
        deviceId: "device-two",
      }),
    ],
    [
      "proofKeyThumbprint",
      stored("https://mac.example.com", "server-one", "Studio Mac", {
        proofKeyThumbprint: "thumbprint-two",
      }),
    ],
  ])("treats %s changes as registry changes", (_field, changed) => {
    const origin = "https://mac.example.com";
    const key = openCodeServerKey(origin);
    expect(
      sameStoredRegistry(
        new Map([[key, stored(origin, "server-one")]]),
        key,
        new Map([[key, changed]]),
        key,
      ),
    ).toBe(false);
  });

  it("treats omitted and null managed identities as the same legacy state", () => {
    const origin = "https://mac.example.com";
    const key = openCodeServerKey(origin);
    expect(
      sameStoredRegistry(
        new Map([[key, stored(origin, "server-one")]]),
        key,
        new Map([
          [
            key,
            stored(origin, "server-one", "Studio Mac", {
              environmentId: null,
              deviceId: null,
              proofKeyThumbprint: null,
            }),
          ],
        ]),
        key,
      ),
    ).toBe(true);
  });
});
