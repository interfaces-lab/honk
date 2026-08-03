import { DESKTOP_REMOTE_NAME_MAX_LENGTH } from "@honk/shared/desktop-api";
import { describe, expect, it } from "vitest";

import {
  normalizeDesktopRemoteHostName,
  normalizeDesktopSettingsDocument,
} from "./desktop-app-settings";

describe("normalizeDesktopRemoteHostName", () => {
  it("keeps valid saved names and ignores values the host would reject", () => {
    expect(normalizeDesktopRemoteHostName("  Studio Mac  ")).toBe("Studio Mac");
    expect(normalizeDesktopRemoteHostName(" ")).toBeNull();
    expect(normalizeDesktopRemoteHostName("x".repeat(DESKTOP_REMOTE_NAME_MAX_LENGTH))).toHaveLength(
      DESKTOP_REMOTE_NAME_MAX_LENGTH,
    );
    expect(
      normalizeDesktopRemoteHostName("x".repeat(DESKTOP_REMOTE_NAME_MAX_LENGTH + 1)),
    ).toBeNull();
  });
});

describe("normalizeDesktopSettingsDocument", () => {
  it.each([
    ["network-accessible", "network-accessible"],
    ["tailscale", "tailscale"],
    ["tunnel", "tunnel"],
    ["unknown-future-mode", "local-only"],
    [undefined, "local-only"],
  ] as const)("degrades saved mode %s to %s", (saved, expected) => {
    expect(
      normalizeDesktopSettingsDocument(
        saved === undefined ? {} : { serverExposureMode: saved },
        "0.0.0-test",
      ).serverExposureMode,
    ).toBe(expected);
  });

  // A mode written by a newer build must cost the user that one field, not the whole file. The
  // document schema therefore accepts any string and leaves the degrade to the branch above.
  it("keeps unrelated settings written alongside a mode this build does not know", () => {
    const settings = normalizeDesktopSettingsDocument(
      {
        serverExposureMode: "unknown-future-mode",
        serverPublicUrl: "https://honk.example.com",
        remoteHostName: "Studio Mac",
        themeSource: "dark",
        hasCompletedOnboarding: true,
      },
      "0.0.0-test",
    );

    expect(settings.serverExposureMode).toBe("local-only");
    expect(settings.serverPublicUrl).toBe("https://honk.example.com");
    expect(settings.remoteHostName).toBe("Studio Mac");
    expect(settings.themeSource).toBe("dark");
    expect(settings.hasCompletedOnboarding).toBe(true);
  });

  it("ignores the retired display zoom field", () => {
    const legacyDocument = { displayZoomLevel: 4, themeSource: "dark" } as const;
    const settings = normalizeDesktopSettingsDocument(legacyDocument, "0.0.0-test");

    expect(settings.themeSource).toBe("dark");
    expect(settings).not.toHaveProperty("displayZoomLevel");
  });
});
