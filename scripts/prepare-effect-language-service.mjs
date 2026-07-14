#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("effect-tsgo", ["patch"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
