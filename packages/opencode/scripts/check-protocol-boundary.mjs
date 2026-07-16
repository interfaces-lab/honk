#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOUNDARY_FILES = [
  "src/client.ts",
  "src/provider-auth.ts",
  "src/identity.ts",
  "src/registry.ts",
].map((path) => join(PACKAGE_ROOT, path));
const FORBIDDEN_PATHS = ["src/protocol", "src/v2", "src/compat.ts"];
const COMPATIBILITY_NAMES = [
  "HonkClient",
  "SidecarClient",
  "ThreadState",
  "ThreadSummary",
  "WorkspaceState",
  "createSidecarClient",
];

function filesIn(directory) {
  const result = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      result.push(...filesIn(path));
    } else if (entry.endsWith(".ts")) {
      result.push(path);
    }
  }
  return result;
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const violations = [];
let hasProtocolRuntimeCall = false;
const boundarySources = BOUNDARY_FILES.filter((path) => exists(path));

if (boundarySources.length === 0) {
  violations.push("no OpenCode client boundary files found at package root");
}

for (const path of boundarySources) {
  const source = readFileSync(path, "utf8");
  const rel = relative(PACKAGE_ROOT, path);
  if (/\bsdk\.v2(?:\.|\b)/.test(source)) {
    hasProtocolRuntimeCall = true;
  }
  // OpenCode loads Honk's OPENCODE_CONFIG overlay only for these stable session
  // operations. Keep this allowlist exact so no parallel client grows here.
  for (const match of source.matchAll(
    /\bsdk\.(?!(?:v2|vcs|provider|auth)(?:\.|\b)|session\.(?:create|messages|promptAsync|abort|status|revert|unrevert)(?:\(|\b))/g,
  )) {
    violations.push(
      `${rel}:${String(match.index ?? 0)} accesses the SDK outside the current namespace`,
    );
  }
  for (const match of source.matchAll(/\b(?:fetch|[A-Za-z_$][\w$]*Fetch)\s*\(/g)) {
    violations.push(
      `${rel}:${String(match.index ?? 0)} performs a raw protocol request outside sdk.v2`,
    );
  }
  for (const name of COMPATIBILITY_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(source)) {
      violations.push(`${rel} uses retired vocabulary ${name}`);
    }
  }
}

for (const leftover of FORBIDDEN_PATHS) {
  const path = join(PACKAGE_ROOT, leftover);
  if (!exists(path)) continue;
  try {
    if (statSync(path).isDirectory()) {
      if (filesIn(path).length > 0) {
        violations.push(`${leftover} must not exist`);
      }
    } else {
      violations.push(`${leftover} must not exist`);
    }
  } catch {}
}

if (!hasProtocolRuntimeCall) {
  violations.push("missing current generated SDK runtime call");
}

const indexSource = readFileSync(join(PACKAGE_ROOT, "src/index.ts"), "utf8");
if (/compat/.test(indexSource)) {
  violations.push("src/index.ts must not mention compat");
}

const packageJson = readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8");
if (/"\.\/compat"/.test(packageJson)) {
  violations.push("package.json must not export ./compat");
}

if (violations.length > 0) {
  for (const violation of violations) {
    console.error(`protocol-boundary: ${violation}`);
  }
  process.exit(1);
}

console.log("protocol-boundary: ok");
