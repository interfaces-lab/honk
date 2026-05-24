import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as DesktopConfig from "../../src/app/DesktopConfig";
import * as DesktopEnvironment from "../../src/app/DesktopEnvironment";
import {
  resolveDefaultBackendCwd,
  type MakeDesktopEnvironmentInput,
} from "../../src/app/DesktopEnvironment";

const baseEnvironmentInput = {
  dirname: "/repo/packages/desktop/dist-electron",
  homeDirectory: "/Users/alex",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.1.2",
  appPath: "/Applications/Multi.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Multi.app/Contents/Resources",
  documentsDirectory: "/Users/alex/Documents",
  runningUnderArm64Translation: false,
} satisfies MakeDesktopEnvironmentInput;

function makeEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  input: Partial<MakeDesktopEnvironmentInput> = {},
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* DesktopEnvironment.DesktopEnvironment;
    }).pipe(
      Effect.provide(DesktopEnvironment.layer({ ...baseEnvironmentInput, ...input })),
      Effect.provide(DesktopConfig.layerTest(env)),
      Effect.provide(NodeServices.layer),
    ),
  );
}

describe("resolveDefaultBackendCwd", () => {
  it("uses the OS documents directory in development", () => {
    expect(
      resolveDefaultBackendCwd({
        documentsDirectory: "/Users/alex/Documents",
      }),
    ).toBe("/Users/alex/Documents");
  });

  it("uses the OS documents directory in packaged builds", () => {
    expect(
      resolveDefaultBackendCwd({
        documentsDirectory: "/Users/alex/Documents",
      }),
    ).toBe("/Users/alex/Documents");
  });
});

describe("DesktopEnvironment", () => {
  it("uses VITE_DEV_SERVER_URL for unpackaged development", async () => {
    const environment = await makeEnvironment({
      VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
    });

    expect(environment.isDevelopment).toBe(true);
    expect(Option.getOrUndefined(environment.devServerUrl)?.href).toBe("http://127.0.0.1:5733/");
  });

  it("ignores leaked VITE_DEV_SERVER_URL in packaged builds", async () => {
    const environment = await makeEnvironment(
      {
        VITE_DEV_SERVER_URL: "http://127.0.0.1:5733",
      },
      { isPackaged: true },
    );

    expect(environment.isDevelopment).toBe(false);
    expect(Option.isNone(environment.devServerUrl)).toBe(true);
  });
});
