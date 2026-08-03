import type { DesktopServerExposureState } from "@honk/shared/desktop-api";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { useConnectionsSettingsState } from "./settings-connections-state";

type ConnectionsState = ReturnType<typeof useConnectionsSettingsState>;

const wiring = vi.hoisted(() => ({ state: null as ConnectionsState | null }));

vi.mock("./settings-connections-state", () => ({
  useConnectionsSettingsState: () => wiring.state,
}));

// Base UI portals nothing on the server, so the picker list and the confirmation copy would never
// appear in static markup. These stand-ins keep the assertions on the panel's own composition.
vi.mock("@honk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@honk/ui")>();
  const passthrough = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;
  return {
    ...actual,
    Picker: {
      Root: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
      Trigger: ({ children }: { readonly children?: ReactNode }) => <span>{children}</span>,
      Popup: passthrough,
      Option: (props: { readonly label: string; readonly description?: ReactNode }) => (
        <div>
          <span>{props.label}</span>
          <span>{props.description}</span>
        </div>
      ),
      Group: passthrough,
      GroupLabel: passthrough,
    },
    AlertDialog: {
      Root: passthrough,
      Popup: passthrough,
      Header: passthrough,
      Footer: passthrough,
      Title: passthrough,
      Description: passthrough,
      Close: ({ children }: { readonly children?: ReactNode }) => <span>{children}</span>,
    },
  };
});

const {
  connectionStatusLine,
  exposureConfigurationFor,
  SettingsConnections,
  switchConfirmationBody,
} = await import("./settings-connections");

const LAN: DesktopServerExposureState = {
  mode: "network-accessible",
  localUrl: "http://127.0.0.1:4000",
  endpointUrl: "http://192.168.1.24:4000",
  browserUrl: null,
  customUrl: null,
  advertisedHost: "192.168.1.24",
};

const TAILSCALE: DesktopServerExposureState = {
  ...LAN,
  mode: "tailscale",
  endpointUrl: "https://studio.example.ts.net",
  browserUrl: "https://studio.example.ts.net",
  advertisedHost: "studio.tail.example.com",
};

const CUSTOM: DesktopServerExposureState = {
  ...LAN,
  endpointUrl: "https://honk.example.com",
  browserUrl: "https://honk.example.com",
  customUrl: "https://honk.example.com",
  advertisedHost: "honk.example.com",
};

const OFF: DesktopServerExposureState = {
  ...LAN,
  mode: "local-only",
  endpointUrl: null,
  advertisedHost: null,
};

function renderPanel(
  exposure: DesktopServerExposureState,
  overrides: Partial<ConnectionsState> = {},
): string {
  wiring.state = {
    available: true,
    host: {
      status: "ready",
      name: "Studio Mac",
      publicUrl: exposure.endpointUrl,
      localUrl: exposure.localUrl,
      errorMessage: null,
      serveEnableUrl: null,
      devices: [],
    },
    exposure,
    hostName: "Studio Mac",
    publicUrl: exposure.customUrl ?? "",
    operation: null,
    error: null,
    loadError: null,
    revokeError: null,
    revokeDevice: null,
    loaded: true,
    activeDevices: [],
    revokedDevices: [],
    isBusy: false,
    setHostName: () => undefined,
    setPublicUrl: () => undefined,
    retryLoad: () => undefined,
    saveName: () => Promise.resolve(),
    rename: () => Promise.resolve(true),
    requestRevoke: () => undefined,
    dismissRevoke: () => undefined,
    revoke: () => Promise.resolve(),
    configure: () => Promise.resolve(),
    ...overrides,
  };
  return renderToStaticMarkup(<SettingsConnections />);
}

describe("exposure configuration", () => {
  it("maps every method onto the two-field contract without a migration", () => {
    expect(exposureConfigurationFor("off", "https://honk.example.com")).toEqual({
      mode: "local-only",
      publicUrl: null,
    });
    expect(exposureConfigurationFor("tailscale", "https://honk.example.com")).toEqual({
      mode: "tailscale",
      publicUrl: null,
    });
    expect(exposureConfigurationFor("lan", "https://honk.example.com")).toEqual({
      mode: "network-accessible",
      publicUrl: null,
    });
    expect(exposureConfigurationFor("custom-https", "https://honk.example.com")).toEqual({
      mode: "network-accessible",
      publicUrl: "https://honk.example.com",
    });
    expect(exposureConfigurationFor("tunnel", "https://honk.example.com")).toEqual({
      mode: "tunnel",
      publicUrl: null,
    });
  });
});

describe("connection status line", () => {
  it("states the Same Wi-Fi constraint where the user lives with it", () => {
    expect(connectionStatusLine(LAN)).toBe(
      "Devices on this network can reach http://192.168.1.24:4000. Cellular does not work, and traffic is not encrypted.",
    );
    expect(connectionStatusLine({ ...LAN, endpointUrl: null })).toBe(
      "Honk has not found this computer's address on the network yet.",
    );
  });

  it("keeps the temporary link's Cloudflare caveat after the method is chosen", () => {
    expect(
      connectionStatusLine({
        ...LAN,
        mode: "tunnel",
        endpointUrl: "https://calm-otter.trycloudflare.com",
      }),
    ).toBe(
      "Devices can reach https://calm-otter.trycloudflare.com until Honk restarts. Cloudflare carries the traffic, so it is not private end to end.",
    );
  });

  it("names the reachable address for the remaining methods", () => {
    expect(connectionStatusLine(TAILSCALE)).toBe(
      "Devices signed in to your Tailscale network can reach https://studio.example.ts.net.",
    );
    expect(connectionStatusLine(CUSTOM)).toBe(
      "Devices can reach this computer at https://honk.example.com.",
    );
    expect(connectionStatusLine(OFF)).toBe("Only this computer can reach Honk.");
  });
});

describe("device access panel", () => {
  it("surfaces the connection method instead of burying it in a disclosure", () => {
    const markup = renderPanel(LAN);
    expect(markup).toContain("How devices connect");
    expect(markup).toContain("Same Wi-Fi");
    expect(markup).not.toContain("Advanced network settings");
    expect(markup).not.toContain("Tailscale network");
    expect(markup).not.toContain("Use Tailscale");
    expect(markup).not.toContain("Use address");
    expect(markup).not.toContain("Turn off device connections");
    expect(markup).not.toContain("Device connections are off");
  });

  it("offers every method with its trade-off at the point of choosing", () => {
    const markup = renderPanel(TAILSCALE);
    expect(markup).toContain(
      "No setup. Works only while both devices are on this network, and traffic is not encrypted.",
    );
    expect(markup).toContain("Works anywhere. Needs Tailscale running on both devices.");
    expect(markup).toContain("Use a secure address you already point at this computer.");
    expect(markup).toContain("Only this computer can reach Honk.");
    expect(markup).toContain(
      "A public web address that changes every time Honk restarts. Cloudflare carries the traffic, so it is not private end to end.",
    );
  });

  it("asks for an address only when the custom method is selected", () => {
    expect(renderPanel(CUSTOM)).toContain('aria-label="Custom HTTPS address"');
    expect(renderPanel(LAN)).not.toContain('aria-label="Custom HTTPS address"');
    expect(renderPanel(TAILSCALE)).not.toContain('aria-label="Custom HTTPS address"');
  });

  it("warns that switching restarts Honk before it happens", () => {
    const markup = renderPanel(LAN);
    expect(markup).toContain("Restart Honk to switch to");
    expect(markup).toContain("Restart and switch");
    expect(markup).not.toContain("Your work is saved");
    expect(markup).not.toContain("Connected devices keep their access");
  });

  it("never claims the section is secure when it can be sitting in Same Wi-Fi", () => {
    const description =
      "Use this computer from your phone, tablet, or another computer. Every device needs a one-time code, and the connection method decides whether traffic is encrypted.";
    const surfaces = [
      renderPanel(LAN),
      renderPanel(TAILSCALE),
      renderPanel(CUSTOM),
      renderPanel(OFF),
      renderPanel(LAN, { loaded: false }),
      renderPanel(LAN, { loadError: "Connections could not be loaded." }),
    ];
    for (const markup of surfaces) {
      expect(markup).not.toContain("securely");
      expect(markup).toContain(description);
    }
  });
});

describe("switch confirmation", () => {
  it("repeats the chosen method's trade-off at the point of commitment", () => {
    expect(switchConfirmationBody("lan")).toBe(
      "No setup. Works only while both devices are on this network, and traffic is not encrypted. Honk closes and reopens, and this computer's address changes, so connected devices need the new address before they work again.",
    );
    expect(switchConfirmationBody("tailscale")).toBe(
      "Works anywhere. Needs Tailscale running on both devices. Honk closes and reopens, and this computer's address changes, so connected devices need the new address before they work again.",
    );
  });

  it("does not promise a new address when there will not be one", () => {
    expect(switchConfirmationBody("off")).toBe(
      "Honk closes and reopens. After that, only this computer can reach Honk, and connected devices stay saved but cannot reach it.",
    );
  });
});
