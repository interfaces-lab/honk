import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { afterEach, describe, expect, it } from "vitest";

import * as EffectLogger from "../src/effect-logger";
import {
  coalesceLogFields,
  configureHonkEvlog,
  formatLogMessage,
  makeHonkEffectLogger,
  redactLogFields,
  writeHonkLogEvent,
} from "../src/logging";

describe("formatLogMessage", () => {
  it("trims and collapses whitespace", () => {
    expect(formatLogMessage("  core   boot \n")).toBe("core boot");
  });
});

describe("coalesceLogFields", () => {
  it("renames reserved message field to detail", () => {
    expect(coalesceLogFields({ service: "core" }, { message: "disk full" })).toEqual({
      service: "core",
      detail: "disk full",
    });
  });
});

describe("redactLogFields", () => {
  it("redacts secret-like field names", () => {
    expect(
      redactLogFields({
        accessToken: "secret-value",
        apiKey: "secret-value",
        threadId: "thread-1",
      }),
    ).toEqual({
      accessToken: "[redacted]",
      apiKey: "[redacted]",
      threadId: "thread-1",
    });
  });
});

describe("writeHonkLogEvent", () => {
  const tempDirs: Array<string> = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes flat NDJSON with merged fields", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honk-evlog-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "core.log.ndjson");

    configureHonkEvlog({
      filePath,
      service: "core",
      environment: "test",
      minLevel: "info",
    });

    writeHonkLogEvent({
      level: "info",
      message: "core boot",
      service: "core",
      fields: { storePath: "/tmp/store", harnesses: ["openai-codex"] },
    });

    const line = JSON.parse(fs.readFileSync(filePath, "utf8").trim()) as Record<string, unknown>;
    expect(line.message).toBe("core boot");
    expect(line.service).toBe("core");
    expect(line.environment).toBe("test");
    expect(line.storePath).toBe("/tmp/store");
    expect(line.harnesses).toEqual(["openai-codex"]);
    expect(line.fields).toBeUndefined();
  });
});

describe("EffectLogger", () => {
  const tempDirs: Array<string> = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const setupSink = (name: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "honk-elog-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    configureHonkEvlog({
      filePath,
      service: "desktop",
      environment: "test",
      minLevel: "info",
    });
    return filePath;
  };

  const honkLoggerLayer = Logger.layer([makeHonkEffectLogger({ defaultService: "desktop" })]);

  it("renames message fields in annotations", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const filePath = setupSink("desktop.log.ndjson");

        const elog = EffectLogger.create({ service: "desktop-updater" });
        yield* elog
          .error("update check failed", { message: "network timeout" })
          .pipe(Effect.provide(honkLoggerLayer));

        const line = JSON.parse(fs.readFileSync(filePath, "utf8").trim()) as Record<string, unknown>;
        expect(line.message).toBe("update check failed");
        expect(line.service).toBe("desktop-updater");
        expect(line.detail).toBe("network timeout");
      }),
    ));

  it("routes a Cause through the native log cause channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const filePath = setupSink("cause.log.ndjson");

        const elog = EffectLogger.create({ service: "core" });
        yield* elog
          .error("turn settlement failed", Cause.fail(new Error("boom")))
          .pipe(Effect.provide(honkLoggerLayer));

        const line = JSON.parse(fs.readFileSync(filePath, "utf8").trim()) as Record<string, unknown>;
        expect(line.message).toBe("turn settlement failed");
        expect(line.cause).toContain("boom");
      }),
    ));

  it("wraps an Error into the log cause channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const filePath = setupSink("error.log.ndjson");

        const elog = EffectLogger.create({ service: "core" });
        yield* elog
          .warn("auth store persistence failed", new Error("disk full"))
          .pipe(Effect.provide(honkLoggerLayer));

        const line = JSON.parse(fs.readFileSync(filePath, "utf8").trim()) as Record<string, unknown>;
        expect(line.message).toBe("auth store persistence failed");
        expect(line.cause).toContain("disk full");
      }),
    ));
});
