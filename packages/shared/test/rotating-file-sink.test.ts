import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { afterEach, describe, expect, it } from "vitest";

import {
  isIgnorableStdioWriteError,
  makeSafeConsolePrettyLogger,
  RotatingFileSink,
} from "../src/logging";

describe("RotatingFileSink", () => {
  const tempDirs: Array<string> = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates when the active file exceeds maxBytes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "multi-log-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "server.log.ndjson");
    const sink = new RotatingFileSink({
      filePath,
      maxBytes: 32,
      maxFiles: 2,
      throwOnError: true,
    });

    sink.write(`${"a".repeat(20)}\n`);
    sink.write(`${"b".repeat(20)}\n`);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.readFileSync(filePath, "utf8").length).toBeLessThanOrEqual(32);
  });
});

describe("isIgnorableStdioWriteError", () => {
  it("allows terminal disconnect write errors", () => {
    const error = Object.assign(new Error("write EIO"), {
      code: "EIO",
      syscall: "write",
    });

    expect(isIgnorableStdioWriteError(error)).toBe(true);
  });

  it("does not allow unrelated errors", () => {
    expect(isIgnorableStdioWriteError(new Error("boom"))).toBe(false);
  });
});

describe("makeSafeConsolePrettyLogger", () => {
  it("does not fail when the console stream is already closed", () => {
    const closedConsole = Object.assign(Object.create(globalThis.console) as Console.Console, {
      log: () => {
        throw Object.assign(new Error("write EIO"), {
          code: "EIO",
          syscall: "write",
        });
      },
    });

    expect(() =>
      Effect.runSync(
        Effect.logInfo("shutting down").pipe(
          Effect.provide(Logger.layer([makeSafeConsolePrettyLogger()])),
          Effect.provide(Layer.succeed(Console.Console, closedConsole)),
        ),
      ),
    ).not.toThrow();
  });
});
