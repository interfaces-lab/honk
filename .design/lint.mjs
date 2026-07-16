#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "packages/ui/src",
  "packages/ui/dev",
  "packages/app/src",
  "packages/mobile",
].filter((target) => existsSync(join(repoRoot, target)));
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const stalePathRoots = ["packages/app", "packages/ui", "packages/mobile", ".design", "docs"];
const stalePathMarker = "app" + "-next";
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".tsx"]);

function run(label, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(`Could not run ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function collectTextFiles(relativePath) {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return [];
  const entries = readdirSync(absolutePath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name === "out") return [];
    const child = join(relativePath, entry.name);
    if (entry.isDirectory()) return collectTextFiles(child);
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    return textExtensions.has(extension) ? [child] : [];
  });
}

function checkStalePaths() {
  const violations = stalePathRoots
    .flatMap(collectTextFiles)
    .filter((relativePath) =>
      readFileSync(join(repoRoot, relativePath), "utf8").includes(stalePathMarker),
    );
  if (violations.length === 0) return;
  console.error(`Stale rewrite-path references:\n${violations.join("\n")}`);
  process.exit(1);
}

run("Oxlint", [
  "exec",
  "oxlint",
  "--config=.design/oxlintrc.json",
  "--report-unused-disable-directives",
  ...targets,
]);
run("the generated token parity check", ["--filter", "@honk/ui", "check:tokens"]);
checkStalePaths();
