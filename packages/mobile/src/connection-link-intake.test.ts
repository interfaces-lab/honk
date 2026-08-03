import { describe, expect, it } from "vitest";

import {
  claimConnectionLink,
  connectionLinkFromRoute,
  EMPTY_CONNECTION_LINK_INTAKE,
  initialConnectionForm,
  receiveConnectionLink,
} from "./connection-link-intake";

const canonical = "honk://connect?origin=https%3A%2F%2Fstudio.example.com#pairing=one-time-code";

describe("connection link intake", () => {
  it("accepts the canonical connect link with a fragment pairing code", () => {
    expect(receiveConnectionLink(EMPTY_CONNECTION_LINK_INTAKE, canonical).pending).toMatchObject({
      value: canonical,
      fallbackOrigin: "",
    });
  });

  it("keeps private-network HTTP links pending for the native policy seam", () => {
    const value = "honk://connect?origin=http%3A%2F%2F192.168.1.42%3A4096#pairing=code";

    expect(receiveConnectionLink(EMPTY_CONNECTION_LINK_INTAKE, value).pending).toMatchObject({
      value,
      fallbackOrigin: "",
    });
  });

  it("turns legacy pair route parameters into the canonical link shape", () => {
    expect(
      connectionLinkFromRoute("/pair", {
        origin: "https://studio.example.com",
        token: "legacy-code",
      }),
    ).toBe("honk://connect?origin=https%3A%2F%2Fstudio.example.com#pairing=legacy-code");
  });

  it("rejects repeated deep-link parameters without a render error", () => {
    expect(
      connectionLinkFromRoute("/connect", {
        origin: ["https://one.example.com", "https://two.example.com"],
        pairing: "pairing-code",
      }),
    ).toBe("honk://connect#pairing=pairing-code");
    expect(
      connectionLinkFromRoute("/connect", { pairing: ["first-code", "second-code"] }),
    ).toBeNull();
    expect(connectionLinkFromRoute("/pair", { token: ["first-code", "second-code"] })).toBeNull();
    expect(
      initialConnectionForm(
        { password: ["first-password", "second-password"] },
        {
          descriptor: { origin: "https://studio.example.com" },
          defaultDirectory: "/Users/me/Studio",
        },
      ),
    ).toEqual({
      origin: "https://studio.example.com",
      connectionValue: "",
      defaultDirectory: "",
    });
  });

  it("pairs computer B while computer A is selected without copying A's project folder", () => {
    expect(
      initialConnectionForm(
        {},
        {
          descriptor: { origin: "https://computer-a.example.com" },
          defaultDirectory: "/Users/me/ComputerA",
        },
      ),
    ).toEqual({
      origin: "https://computer-a.example.com",
      connectionValue: "",
      defaultDirectory: "",
    });
  });

  it("claims a delivery once and does not replay the same historical link", () => {
    const received = receiveConnectionLink(EMPTY_CONNECTION_LINK_INTAKE, canonical);
    const deliveryID = received.pending?.deliveryID;
    if (deliveryID === undefined) throw new Error("Missing received connection link.");
    const claimed = claimConnectionLink(received, deliveryID);

    expect(claimed.pending).toBeNull();
    expect(receiveConnectionLink(claimed, canonical)).toBe(claimed);
  });

  it("accepts the same code from a new OS link event after cancellation", () => {
    const received = receiveConnectionLink(EMPTY_CONNECTION_LINK_INTAKE, canonical);
    const deliveryID = received.pending?.deliveryID;
    const key = received.pending?.key;
    if (deliveryID === undefined || key === undefined) {
      throw new Error("Missing received connection link.");
    }
    const claimed = claimConnectionLink(received, deliveryID);

    const reopened = receiveConnectionLink(claimed, canonical, "", true).pending;
    expect(reopened?.key).toBe(key);
    expect(reopened?.deliveryID).not.toBe(deliveryID);
  });

  it("keeps the newest link while the app is restoring", () => {
    const first = receiveConnectionLink(EMPTY_CONNECTION_LINK_INTAKE, canonical);
    const second = receiveConnectionLink(
      first,
      "honk://connect?origin=https%3A%2F%2Flaptop.example.com#pairing=new-code",
    );

    expect(second.pending?.value).toContain("laptop.example.com");
    expect(second.receivedKeys).toHaveLength(2);
  });
});
