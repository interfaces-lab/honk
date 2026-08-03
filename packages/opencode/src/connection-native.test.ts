import { describe, expect, it } from "vitest";

import { normalizeRemoteOpenCodeOrigin } from "./connection";
import { normalizeNativeOpenCodeOrigin } from "./connection-native";
import { isPrivateNetworkHost } from "./private-host";

// The native and browser policies are only allowed to disagree about private-network HTTP. Both
// normalizers run against this list so the divergence is asserted rather than assumed.
const PRIVATE_HTTP_ORIGINS = [
  "http://192.168.1.24:4096",
  "http://10.0.0.5",
  "http://172.16.0.1",
  "http://169.254.10.2",
  "http://honks-mac.local:4096",
] as const;

describe("normalizeNativeOpenCodeOrigin", () => {
  it.each([
    ["https://honk.example.com", "https://honk.example.com"],
    ["http://192.168.1.24:4096", "http://192.168.1.24:4096"],
    ["http://10.0.0.5", "http://10.0.0.5"],
    ["http://172.16.0.1", "http://172.16.0.1"],
    ["http://172.31.255.254", "http://172.31.255.254"],
    ["http://169.254.10.2", "http://169.254.10.2"],
    ["http://honks-mac.local:4096", "http://honks-mac.local:4096"],
    ["http://127.0.0.1:52010", "http://127.0.0.1:52010"],
    ["http://localhost:4096", "http://localhost:4096"],
    ["http://[::1]:4096", "http://[::1]:4096"],
  ] as const)("accepts %s", (value, expected) => {
    expect(normalizeNativeOpenCodeOrigin(value)).toBe(expected);
  });

  it.each([
    "http://honk.example.com",
    "http://172.15.0.1",
    "http://172.32.0.1",
    "http://192.169.1.1",
    "http://11.0.0.1",
    "http://100.64.0.1",
    "http://100.100.100.100",
    "http://8.8.8.8",
    "http://macbook",
    "http://192.168.1.24.example.com",
    "http://127.0.0.1.attacker.com",
    "http://127.evil.com",
    "http://0.0.0.0:4096",
    "http://[2001:db8::1]",
    "http://[fd00::1]",
  ])("rejects %s", (value) => {
    expect(() => normalizeNativeOpenCodeOrigin(value)).toThrow(
      "Connections over the internet must use HTTPS.",
    );
  });

  it("applies the policy to the URL parser's canonical hostname", () => {
    expect(normalizeNativeOpenCodeOrigin("http://0x7f.1")).toBe("http://127.0.0.1");
    expect(() => normalizeNativeOpenCodeOrigin("http://010.0.0.1")).toThrow(
      "Connections over the internet must use HTTPS.",
    );
  });

  it.each([
    "http://user:password@192.168.1.24",
    "http://192.168.1.24?pairing=code",
    "http://192.168.1.24#pairing=code",
    "ftp://192.168.1.24",
  ])("keeps the base normalizer rejection for %s", (value) => {
    expect(() => normalizeNativeOpenCodeOrigin(value)).toThrow();
  });
});

describe("native and browser transport policies", () => {
  it.each(PRIVATE_HTTP_ORIGINS)("native accepts %s but the browser policy rejects it", (value) => {
    expect(normalizeNativeOpenCodeOrigin(value)).toBe(value);
    expect(() => normalizeRemoteOpenCodeOrigin(value)).toThrow(
      "Connections to another computer must use HTTPS.",
    );
  });

  it.each(["http://127.0.0.1:52010", "http://localhost:4096", "https://honk.example.com"])(
    "both policies accept %s",
    (value) => {
      expect(normalizeNativeOpenCodeOrigin(value)).toBe(value);
      expect(normalizeRemoteOpenCodeOrigin(value)).toBe(value);
    },
  );

  it.each(["http://127.0.0.1.attacker.com", "http://honk.example.com"])(
    "both policies reject %s",
    (value) => {
      expect(() => normalizeNativeOpenCodeOrigin(value)).toThrow();
      expect(() => normalizeRemoteOpenCodeOrigin(value)).toThrow();
    },
  );
});

describe("isPrivateNetworkHost", () => {
  it.each([
    ["172.15.0.1", false],
    ["172.16.0.1", true],
    ["172.31.255.254", true],
    ["172.32.0.1", false],
    ["169.253.10.2", false],
    ["169.254.10.2", true],
    ["honks-mac.local", true],
    ["honks-mac.LOCAL", true],
    ["honks-mac.localdomain", false],
  ] as const)("classifies %s as private: %s", (hostname, expected) => {
    expect(isPrivateNetworkHost(hostname)).toBe(expected);
  });
});
