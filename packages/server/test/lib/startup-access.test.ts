import { assert, expect, it } from "@effect/vitest";

import {
  buildBootstrapUrl,
  formatHeadlessServeOutput,
  resolveHeadlessConnectionHost,
  resolveHeadlessConnectionString,
  resolveListeningPort,
} from "../../src/startup-access";

it("prefers localhost when no explicit host is configured", () => {
  expect(resolveHeadlessConnectionHost(undefined)).toBe("localhost");
  expect(resolveHeadlessConnectionString(undefined, 3773)).toBe("http://localhost:3773");
});

it("keeps explicit bind hosts in the connection string", () => {
  expect(resolveHeadlessConnectionString("127.0.0.1", 3773)).toBe("http://127.0.0.1:3773");
  expect(resolveHeadlessConnectionString("::1", 3773)).toBe("http://[::1]:3773");
});

it("resolves wildcard hosts to a concrete external interface when one is available", () => {
  const connectionString = resolveHeadlessConnectionString("0.0.0.0", 3773, {
    en0: [
      {
        address: "192.168.1.42",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.42/24",
      },
    ],
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  });

  expect(connectionString).toBe("http://192.168.1.42:3773");
});

it("prefers the actual bound port when an http server address is available", () => {
  expect(resolveListeningPort({ port: 4123 }, 3773)).toBe(4123);
  expect(resolveListeningPort("pipe", 3773)).toBe(3773);
  expect(resolveListeningPort(null, 3773)).toBe(3773);
});

it("builds a bootstrap URL that embeds the token in the root hash", () => {
  expect(buildBootstrapUrl("http://192.168.1.42:3773", "PAIRCODE")).toBe(
    "http://192.168.1.42:3773/#token=PAIRCODE",
  );
});

it("formats headless serve output with the connection string, token, and bootstrap URL", () => {
  const output = formatHeadlessServeOutput({
    connectionString: "http://192.168.1.42:3773",
    token: "PAIRCODE",
    bootstrapUrl: "http://192.168.1.42:3773/#token=PAIRCODE",
  });

  expect(output).toContain("Connection string: http://192.168.1.42:3773");
  expect(output).toContain("Token: PAIRCODE");
  expect(output).toContain("Bootstrap URL: http://192.168.1.42:3773/#token=PAIRCODE");
  assert.isFalse(output.includes("█") || output.includes("▀") || output.includes("▄"));
});
