import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { createDevRunnerEnv, MODE_ARGS, MODE_PREFLIGHT_ARGS } from "./dev-runner";

describe("dev runner mode args", () => {
  it("keeps desktop output streamable and rebuilds the backend dist before launch", () => {
    expect(MODE_ARGS["dev:desktop"]).toEqual([
      "run",
      "dev",
      "--filter=@multi/desktop",
      "--filter=@multi/app",
      "--ui=stream",
    ]);
    expect(MODE_PREFLIGHT_ARGS["dev:desktop"]).toEqual([
      "run",
      "build",
      "--filter=usemulti",
      "--ui=stream",
    ]);
  });
});

describe("createDevRunnerEnv", () => {
  it("keeps desktop dev on desktop bootstrap instead of configured web backend URLs", async () => {
    const env = await Effect.runPromise(
      createDevRunnerEnv({
        mode: "dev:desktop",
        baseEnv: {
          VITE_HTTP_URL: "http://stale.example",
          VITE_WS_URL: "ws://stale.example",
          MULTI_MODE: "web",
          MULTI_HOST: "0.0.0.0",
          MULTI_NO_BROWSER: "1",
        },
        serverOffset: 7,
        webOffset: 11,
        multiHome: "/tmp/multi-dev-runner",
        noBrowser: true,
        autoBootstrapProjectFromCwd: undefined,
        logWebSocketEvents: undefined,
        host: "0.0.0.0",
        port: undefined,
        devUrl: undefined,
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    expect(env.MULTI_PORT).toBe("13780");
    expect(env.PORT).toBe("5744");
    expect(env.VITE_DEV_SERVER_URL).toBe("http://127.0.0.1:5744");
    expect(env.VITE_HTTP_URL).toBeUndefined();
    expect(env.VITE_WS_URL).toBeUndefined();
    expect(env.MULTI_MODE).toBeUndefined();
    expect(env.MULTI_HOST).toBeUndefined();
    expect(env.MULTI_NO_BROWSER).toBeUndefined();
  });

  it("keeps web dev modes wired to the configured server URLs", async () => {
    const env = await Effect.runPromise(
      createDevRunnerEnv({
        mode: "dev",
        baseEnv: {},
        serverOffset: 2,
        webOffset: 2,
        multiHome: "/tmp/multi-dev-runner",
        noBrowser: false,
        autoBootstrapProjectFromCwd: undefined,
        logWebSocketEvents: undefined,
        host: undefined,
        port: undefined,
        devUrl: undefined,
      }).pipe(Effect.provide(NodeServices.layer)),
    );

    expect(env.MULTI_PORT).toBe("13775");
    expect(env.PORT).toBe("5735");
    expect(env.VITE_HTTP_URL).toBe("http://localhost:13775");
    expect(env.VITE_WS_URL).toBe("ws://localhost:13775");
    expect(env.MULTI_MODE).toBe("web");
  });
});
