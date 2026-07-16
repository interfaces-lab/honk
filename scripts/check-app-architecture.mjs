#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const appSourceRoot = join(repoRoot, "packages/app/src");
const sourceRoots = [
  appSourceRoot,
  join(repoRoot, "packages/desktop/src"),
  join(repoRoot, "packages/shared/src"),
];
const maxAppSourceLines = 1_000;
const canonicalHelperNames = [
  "basename",
  "errorMessage",
  "newMessageId",
  "requireClient",
  "trimNonEmptyOption",
];

function walk(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (name === "node_modules") continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (/\.[cm]?tsx?$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

const findings = [];
for (const path of walk(appSourceRoot)) {
  const lineCount = readFileSync(path, "utf8").split("\n").length;
  if (lineCount > maxAppSourceLines) {
    findings.push(
      `${relative(repoRoot, path)} has ${lineCount} lines, above the ${maxAppSourceLines}-line limit`,
    );
  }
}

const helperDefinitions = new Map(canonicalHelperNames.map((name) => [name, []]));
for (const root of sourceRoots) {
  for (const path of walk(root)) {
    const source = readFileSync(path, "utf8");
    for (const name of canonicalHelperNames) {
      const definitionPattern = new RegExp(
        `\\b(?:function\\s+${name}\\b|(?:const|let)\\s+${name}\\s*=)`,
        "g",
      );
      for (const match of source.matchAll(definitionPattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        helperDefinitions.get(name).push(`${relative(repoRoot, path)}:${line}`);
      }
    }
  }
}

for (const [name, definitions] of helperDefinitions) {
  if (definitions.length > 1) {
    findings.push(`${name} has ${definitions.length} local definitions: ${definitions.join(", ")}`);
  }
}

if (findings.length === 0) {
  console.log("app architecture check: 0 violations");
  process.exit(0);
}

for (const finding of findings) {
  console.error(`app architecture check: ${finding}`);
}
process.exit(1);
