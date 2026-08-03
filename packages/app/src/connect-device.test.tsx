import type {
  DesktopRemoteHostState,
  DesktopRemotePairingLink,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConnectDeviceBody,
  CONNECTION_METHODS,
  connectDeviceAnnouncement,
  connectionMethodFrom,
} from "./connect-device";
import type { ConnectDeviceSnapshot } from "./connect-device-controller";

const HOST: DesktopRemoteHostState = {
  status: "ready",
  name: "Studio Mac",
  publicUrl: "https://studio.example.ts.net",
  localUrl: "http://127.0.0.1:4000",
  errorMessage: null,
  serveEnableUrl: null,
  devices: [],
};

const TAILSCALE: DesktopServerExposureState = {
  mode: "tailscale",
  localUrl: HOST.localUrl,
  endpointUrl: HOST.publicUrl,
  browserUrl: HOST.publicUrl,
  customUrl: null,
  advertisedHost: "studio.tail.example.com",
};

const LAN: DesktopServerExposureState = {
  mode: "network-accessible",
  localUrl: HOST.localUrl,
  endpointUrl: "http://192.168.1.24:4000",
  browserUrl: null,
  customUrl: null,
  advertisedHost: "192.168.1.24",
};

const CUSTOM: DesktopServerExposureState = {
  mode: "network-accessible",
  localUrl: HOST.localUrl,
  endpointUrl: "https://honk.example.com",
  browserUrl: "https://honk.example.com",
  customUrl: "https://honk.example.com",
  advertisedHost: "honk.example.com",
};

const TUNNEL: DesktopServerExposureState = {
  mode: "tunnel",
  localUrl: HOST.localUrl,
  endpointUrl: "https://calm-otter.trycloudflare.com",
  browserUrl: "https://calm-otter.trycloudflare.com",
  customUrl: null,
  advertisedHost: "calm-otter.trycloudflare.com",
};

const OFF: DesktopServerExposureState = {
  mode: "local-only",
  localUrl: HOST.localUrl,
  endpointUrl: null,
  browserUrl: null,
  customUrl: null,
  advertisedHost: null,
};

const BROWSER_PAIRING: DesktopRemotePairingLink = {
  id: "pairing-1",
  url: "https://studio.example.ts.net/#pairing=secret",
  mobileUrl: "honk://connect?origin=https%3A%2F%2Fstudio.example.ts.net#pairing=secret",
  expiresAt: "2026-07-20T18:10:00.000Z",
};

const LAN_PAIRING: DesktopRemotePairingLink = {
  id: "pairing-2",
  url: null,
  mobileUrl: "honk://connect?origin=http%3A%2F%2F192.168.1.24%3A4000#pairing=secret",
  expiresAt: "2026-07-20T18:10:00.000Z",
};

function render(snapshot: ConnectDeviceSnapshot): string {
  return renderToStaticMarkup(<ConnectDeviceBody snapshot={snapshot} />);
}

function pairing(
  exposure: DesktopServerExposureState,
  link: DesktopRemotePairingLink,
): ConnectDeviceSnapshot {
  return { status: "pairing", host: HOST, exposure, pairing: link, remaining: 300 };
}

describe("connection method vocabulary", () => {
  it("separates a derived Wi-Fi address from a user-supplied one", () => {
    expect(connectionMethodFrom(OFF)).toBe("off");
    expect(connectionMethodFrom(TAILSCALE)).toBe("tailscale");
    expect(connectionMethodFrom(LAN)).toBe("lan");
    expect(connectionMethodFrom(CUSTOM)).toBe("custom-https");
    expect(connectionMethodFrom(TUNNEL)).toBe("tunnel");
  });

  it("discloses on the pairing screen that a temporary link is carried by Cloudflare", () => {
    expect(render(pairing(TUNNEL, BROWSER_PAIRING))).toContain("Cloudflare");
  });
});

describe("pairing state", () => {
  it("encodes the app link in the QR code, never the web link", () => {
    const markup = render(pairing(TAILSCALE, BROWSER_PAIRING));
    expect(markup).toContain('aria-label="One-time code for the Honk app"');
    expect(markup).toContain(`value="${BROWSER_PAIRING.mobileUrl.replaceAll("&", "&amp;")}"`);
    expect(markup).toContain("Or paste this link into the Honk app on the other device");
    expect(markup).not.toContain(BROWSER_PAIRING.url);
  });

  it("offers the browser target only when the host published a browser link", () => {
    expect(render(pairing(TAILSCALE, BROWSER_PAIRING))).toContain("Web browser");

    const lan = render(pairing(LAN, LAN_PAIRING));
    expect(lan).not.toContain("Web browser");
    expect(lan).toContain(
      `Only the Honk app can use a ${CONNECTION_METHODS.lan.label} connection. Browsers need a secure address.`,
    );
    expect(lan).toContain(`value="${LAN_PAIRING.mobileUrl.replaceAll("&", "&amp;")}"`);
  });

  it("states the Same Wi-Fi trade-off where the user is pairing", () => {
    expect(render(pairing(LAN, LAN_PAIRING))).toContain(
      "Both devices must stay on this Wi-Fi network. On cellular, this stops working. Traffic to this computer is not encrypted, so use Tailscale on a network you do not trust.",
    );
  });

  it("keeps the Tailscale and custom-address trade-offs accurate", () => {
    expect(render(pairing(TAILSCALE, BROWSER_PAIRING))).toContain(
      "Works on Wi-Fi and cellular while Tailscale is connected on both devices.",
    );
    expect(render(pairing(CUSTOM, BROWSER_PAIRING))).toContain(
      "Works wherever your address is reachable.",
    );
  });
});

describe("issuing state", () => {
  it("names the code by what it is instead of promising a secure connection", () => {
    const markup = render({ status: "issuing", host: HOST, exposure: LAN });
    expect(markup).toContain("Creating a one-time code");
    expect(markup).not.toContain("Creating a secure code");
  });
});

describe("setup state", () => {
  it("names the other methods instead of presenting Tailscale as the only path", () => {
    const markup = render({ status: "setup", host: HOST, exposure: OFF });
    expect(markup).toContain("Turn on with Tailscale");
    expect(markup).toContain("Change how devices connect");
    expect(markup).toContain("Installation help");
    expect(markup).toContain(CONNECTION_METHODS.lan.label);
    expect(markup).not.toContain("Nothing is opened to the public internet");
  });
});

describe("starting state", () => {
  it("describes what the selected method is doing", () => {
    expect(render({ status: "starting", host: HOST, exposure: LAN })).toContain(
      "Honk is finding this computer&#x27;s address on your network.",
    );
    expect(render({ status: "starting", host: HOST, exposure: TAILSCALE })).toContain(
      "Honk is preparing a private address for this computer.",
    );
    expect(render({ status: "starting", host: HOST, exposure: CUSTOM })).toContain(
      "Honk is publishing your address.",
    );
  });
});

describe("blocked states", () => {
  const failedHost: DesktopRemoteHostState = {
    ...HOST,
    status: "error",
    errorMessage: "Honk could not find this computer on your Wi-Fi network.",
  };

  it("tells the user to join a network when no address was found", () => {
    const markup = renderToStaticMarkup(
      <ConnectDeviceBody
        snapshot={{
          status: "host-error",
          host: failedHost,
          exposure: { ...LAN, endpointUrl: null, advertisedHost: null },
        }}
      />,
    );
    expect(markup).toContain("This computer is not on a network");
    expect(markup).toContain(
      "Connect this computer to Wi-Fi or Ethernet, or switch to a method that works anywhere.",
    );
    expect(markup).toContain("Restart Honk");
    expect(markup).toContain("Use a different method");
    expect(markup).not.toContain("Reconnect Tailscale");
  });

  it("keeps both Tailscale blocked states", () => {
    const approval = render({
      status: "host-error",
      host: { ...failedHost, serveEnableUrl: "https://login.tailscale.com/admin/machines" },
      exposure: TAILSCALE,
    });
    expect(approval).toContain("Approve Tailscale Serve");
    expect(approval).toContain("Approve in Tailscale");

    const disconnected = render({ status: "host-error", host: failedHost, exposure: TAILSCALE });
    expect(disconnected).toContain("Reconnect Tailscale");
    expect(disconnected).toContain("Tailscale help");
  });
});

describe("connected state", () => {
  it("names the settings section that actually exists", () => {
    const markup = render({
      status: "connected",
      host: HOST,
      exposure: TAILSCALE,
      device: {
        id: "device-1",
        label: "iPad",
        createdAt: "2026-07-20T18:00:00.000Z",
        revokedAt: null,
      },
    });
    expect(markup).toContain("remove access in Device access");
    expect(markup).not.toContain("remove access in Connections");
  });
});

describe("live announcements", () => {
  it("matches one announcement per status and never depends on the countdown", () => {
    expect(connectDeviceAnnouncement({ status: "loading" })).toBe("Checking device connections.");
    expect(connectDeviceAnnouncement({ status: "cancelling" })).toBe(
      "Canceling the device connection code.",
    );
    expect(connectDeviceAnnouncement({ status: "setup", host: HOST, exposure: OFF })).toBe(
      "Device connections need to be turned on.",
    );
    expect(connectDeviceAnnouncement({ status: "enabling", host: HOST, exposure: OFF })).toBe(
      "Turning on device connections.",
    );
    expect(connectDeviceAnnouncement({ status: "starting", host: HOST, exposure: LAN })).toBe(
      "Device connections are starting.",
    );
    expect(connectDeviceAnnouncement({ status: "restarting", host: HOST, exposure: LAN })).toBe(
      "Restarting device connections.",
    );
    expect(connectDeviceAnnouncement({ status: "issuing", host: HOST, exposure: LAN })).toBe(
      "Creating a one-time device connection code.",
    );
    expect(connectDeviceAnnouncement(pairing(LAN, LAN_PAIRING))).toBe(
      "Device connection code ready.",
    );
    expect(
      connectDeviceAnnouncement({
        status: "pairing",
        host: HOST,
        exposure: LAN,
        pairing: LAN_PAIRING,
        remaining: 12,
      }),
    ).toBe(connectDeviceAnnouncement(pairing(LAN, LAN_PAIRING)));
    expect(
      connectDeviceAnnouncement({
        status: "expired",
        host: HOST,
        exposure: LAN,
        pairing: LAN_PAIRING,
      }),
    ).toBe("The device connection code expired.");
    expect(
      connectDeviceAnnouncement({
        status: "connected",
        host: HOST,
        exposure: LAN,
        device: {
          id: "device-1",
          label: "iPad",
          createdAt: "2026-07-20T18:00:00.000Z",
          revokedAt: null,
        },
      }),
    ).toBe("iPad is connected.");
  });

  it("names the failing method instead of always blaming Tailscale", () => {
    const failedHost = { ...HOST, status: "error" as const, errorMessage: "no route" };
    expect(
      connectDeviceAnnouncement({ status: "host-error", host: failedHost, exposure: LAN }),
    ).toBe("Same Wi-Fi needs attention.");
    expect(
      connectDeviceAnnouncement({ status: "host-error", host: failedHost, exposure: TAILSCALE }),
    ).toBe("Tailscale needs attention.");
    expect(
      connectDeviceAnnouncement({
        status: "host-error",
        host: { ...failedHost, serveEnableUrl: "https://login.tailscale.com/admin/machines" },
        exposure: TAILSCALE,
      }),
    ).toBe("Tailscale needs a one-time approval.");
  });
});
