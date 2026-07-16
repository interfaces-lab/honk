import { describe, expect, it } from "vitest";

import {
  DesktopServerExposurePublicUrlError,
  normalizeDesktopServerPublicUrl,
  resolveDesktopServerExposure,
} from "./desktop-server-exposure";

describe("normalizeDesktopServerPublicUrl", () => {
  it("normalizes a public HTTPS origin", () => {
    expect(normalizeDesktopServerPublicUrl("  https://honk.example.com/  ")).toBe(
      "https://honk.example.com",
    );
    expect(normalizeDesktopServerPublicUrl("https://honk.example.com:443")).toBe(
      "https://honk.example.com",
    );
    expect(normalizeDesktopServerPublicUrl(" ")).toBeNull();
    expect(normalizeDesktopServerPublicUrl(null)).toBeNull();
  });

  it.each([
    "http://honk.example.com",
    "https://user:secret@honk.example.com",
    "https://honk.example.com/path",
    "https://honk.example.com?device=phone",
    "https://honk.example.com#secret",
    "not a URL",
  ])("rejects an unsafe public address: %s", (value) => {
    expect(() => normalizeDesktopServerPublicUrl(value)).toThrow(
      DesktopServerExposurePublicUrlError,
    );
  });
});

describe("resolveDesktopServerExposure", () => {
  it("keeps a managed Tailscale endpoint on loopback", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "tailscale",
        port: 3773,
        networkInterfaces: {},
        publicUrl: "https://custom.example.com",
        tailscaleEndpoint: {
          url: "https://workstation.example.ts.net",
          magicDnsName: "workstation.example.ts.net",
          tailnetIpv4Addresses: ["100.90.80.70"],
        },
      }),
    ).toMatchObject({
      mode: "tailscale",
      bindHost: "127.0.0.1",
      endpointUrl: "https://workstation.example.ts.net",
      advertisedHost: "workstation.example.ts.net",
    });
  });

  it("binds a custom endpoint to the network listener", () => {
    expect(
      resolveDesktopServerExposure({
        mode: "network-accessible",
        port: 3773,
        networkInterfaces: {},
        publicUrl: "https://custom.example.com",
        tailscaleEndpoint: null,
      }),
    ).toMatchObject({
      mode: "network-accessible",
      bindHost: "0.0.0.0",
      endpointUrl: "https://custom.example.com",
    });
  });
});
