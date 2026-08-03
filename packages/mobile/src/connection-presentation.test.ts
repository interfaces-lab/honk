import { createOpenCodeServer } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  homeConnectionNotice,
  presentRemoteServerConnection,
  presentRemoteServerRecovery,
} from "./connection-presentation";

describe("presentRemoteServerConnection", () => {
  it("makes automatic retry explicit without hiding the last failure", () => {
    expect(
      presentRemoteServerConnection({
        status: "reconnecting",
        error: "The computer did not respond.",
      }),
    ).toEqual({
      title: "Reconnecting…",
      detail: "The computer did not respond.",
      tone: "warning",
    });
  });

  it("treats authorization as a repair state instead of retrying copy", () => {
    expect(
      presentRemoteServerConnection({
        status: "unauthorized",
        error: "Access was revoked.",
      }),
    ).toEqual({
      title: "Access needs repair",
      detail: "Access was revoked.",
      tone: "error",
    });
  });

  it("keeps managed setup distinct from another QR repair", () => {
    expect(
      presentRemoteServerConnection({
        status: "remote-setup",
        error: "Remote access setup is not finished yet.",
      }),
    ).toEqual({
      title: "Remote access setup needed",
      detail: "Remote access setup is not finished yet.",
      tone: "warning",
    });
  });
});

describe("presentRemoteServerRecovery", () => {
  const cases = [
    ["offline", "Offline", "manage"],
    ["connecting", "Connecting…", "retry"],
    ["reconnecting", "Reconnecting…", "retry"],
    ["unauthorized", "Access needs repair", "manage"],
    ["failed", "Connection failed", "manage"],
    ["remote-setup", "Remote access setup needed", null],
    ["closed", "Disconnected", "retry"],
    ["live", "Connected", null],
  ] satisfies ReadonlyArray<
    readonly [
      Parameters<typeof presentRemoteServerRecovery>[0]["status"],
      string,
      "manage" | "retry" | null,
    ]
  >;

  it.each(cases)("maps %s to an honest recovery action", (status, title, action) => {
    expect(presentRemoteServerRecovery({ status, error: null })).toMatchObject({
      title,
      action,
    });
  });
});

describe("homeConnectionNotice", () => {
  const descriptor = createOpenCodeServer({
    origin: "https://studio.example",
    label: "Studio",
  });

  it("prioritizes a computer that needs attention over transient states", () => {
    expect(
      homeConnectionNotice([
        { descriptor, status: "offline", error: null },
        {
          descriptor: createOpenCodeServer({
            origin: "https://laptop.example",
            label: "Laptop",
          }),
          status: "failed",
          error: "Identity could not be verified.",
        },
      ]),
    ).toMatchObject({
      title: "Laptop needs attention",
      tone: "error",
    });
  });

  it("stays hidden when every computer is connected", () => {
    expect(homeConnectionNotice([{ descriptor, status: "live", error: null }])).toBeNull();
  });
});
