import { describe, expect, it, vi } from "vitest";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";

describe("resolvePrimaryEnvironmentHttpUrl", () => {
  it("uses the desktop bridge backend URL instead of rewriting to the Vite origin", () => {
    const previousDevServerUrl = import.meta.env.VITE_DEV_SERVER_URL;
    import.meta.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5733";
    vi.stubGlobal("window", {
      location: new URL("http://127.0.0.1:5733/"),
      desktopBridge: {
        getLocalEnvironmentBootstrap: () => ({
          label: "Local environment",
          httpBaseUrl: "http://127.0.0.1:13773",
          browserBootstrapUrl: "http://127.0.0.1:5733/#token=test-token",
          bootstrapToken: "test-token",
          runId: "test-run",
        }),
      },
    });

    try {
      expect(resolvePrimaryEnvironmentHttpUrl("/.well-known/honk/environment")).toBe(
        "http://127.0.0.1:13773/.well-known/honk/environment",
      );
    } finally {
      import.meta.env.VITE_DEV_SERVER_URL = previousDevServerUrl;
      vi.unstubAllGlobals();
    }
  });
});
