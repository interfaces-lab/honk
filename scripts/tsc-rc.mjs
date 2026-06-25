#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const tsc = path.join(root, "node_modules/@typescript/native-preview/bin/tsc");
const result = spawnSync(tsc, process.argv.slice(2), { stdio: "inherit" });

process.exit(result.status ?? 1);
