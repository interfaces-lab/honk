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
let globalEventCalls = 0;
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
  globalEventCalls += source.match(/\bsdk\.global\.event\s*\(/g)?.length ?? 0;
  if (/\bsdk\.v2\.session\.events\s*\(/.test(source)) {
    violations.push(
      `${rel} opens a per-session event stream instead of the single sdk.global.event stream`,
    );
  }
  if (/\bsdk\.v2\.event\.subscribe\s*\(/.test(source)) {
    violations.push(`${rel} uses the incomplete V2 event stream while prompt execution is stable`);
  }
  if (/\/api\/session\/[^"'`]*\/event/.test(source)) {
    violations.push(`${rel} opens a raw per-session event stream`);
  }
  // Execution and its adjacent session operations stay on the stable plane.
  // global.event is the single complete event stream while V2 execution is
  // incomplete; vcs and path have no V2 routes.
  // file.read is the one stable route with a live V2 equivalent: the generated
  // sdk.v2.fs.read hardcodes url "/api/fs/read/*" and hey-api's Options omits
  // url, so it cannot address a file. Drop this entry when upstream fixes it.
  // session.diff (turn snapshot diffs) has no V2 counterpart either — sdk.v2's
  // Session class exposes no diff method at 1.18.10 — and it reads the same
  // persisted message store as the allowlisted session.messages.
  // mcp.* (status, connect, disconnect, and the nested auth group) is stable-plane
  // for the same reason: the generated V2 class has no mcp member at 1.18.10, so
  // MCP server management exists only on /mcp.
  // tool.ids is the merged built-in + dynamically registered tool list at
  // /experimental/tool/ids, with no V2 route; tool.list stays off the allowlist.
  // config.get reads the sidecar's merged config, which has no V2 route either.
  // Reads only: config writes would fight Honk's generated overlay, so
  // config.update is not allowlisted.
  // question.list/reply/reject settle the stable runner's Question service. The
  // V2 question routes address the separate V2 runner service and therefore
  // cannot observe or answer questions raised by sdk.session.promptAsync.
  // session.summarize starts compaction on that same stable runner. The
  // generated V2 compact route exists but is deliberately unavailable at 1.18.10.
  // Keep this allowlist exact so no parallel client grows here.
  for (const match of source.matchAll(
    /\bsdk\.(?!(?:v2|vcs|path)(?:\.|\b)|global\.event(?:\(|\b)|mcp\.|config\.get(?:\(|\b)|question\.(?:list|reply|reject)(?:\(|\b)|file\.read(?:\(|\b)|session\.(?:create|messages|promptAsync|abort|status|revert|unrevert|update|diff|summarize)(?:\(|\b))/g,
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
if (globalEventCalls !== 1) {
  violations.push(
    `expected exactly one generated global event call, found ${String(globalEventCalls)}`,
  );
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
