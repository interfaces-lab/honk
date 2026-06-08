import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RotatingFileSink } from "../src/logging";

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
