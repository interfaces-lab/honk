#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";

if (process.platform !== "win32") {
  const result = spawnSync("effect-tsgo", ["get-exe-path"], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const executablePath = result.stdout.trim();
  if (executablePath.length === 0) {
    throw new Error("effect-tsgo did not return its executable path");
  }

  chmodSync(executablePath, 0o755);
}
