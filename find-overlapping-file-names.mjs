#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

const usage = `Usage: node find-overlapping-file-names.mjs [--limit=N] [--json]

Find non-gitignored files whose basename appears in more than one folder.

Options:
  --limit=N  Print only the first N duplicate filename groups.
  --json     Print machine-readable output.
`;

function parseArgs(argv) {
  const options = {
    json: false,
    limit: null,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage);
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsedLimit = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      options.limit = parsedLimit;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function gitRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Not inside a git repository.");
  }
  return result.stdout.trim();
}

function gitVisibleFiles(root) {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 1024 * 1024 * 200,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString("utf8").trim() || "Failed to list git-visible files.");
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((filePath) => filePath.length > 0)
    .filter((filePath) => {
      try {
        return statSync(path.join(root, filePath)).isFile();
      } catch {
        return false;
      }
    });
}

function groupOverlaps(files) {
  const byName = new Map();

  for (const filePath of files) {
    const fileName = path.posix.basename(filePath);
    const folder = path.posix.dirname(filePath);
    const existing = byName.get(fileName);
    if (existing) {
      existing.paths.push(filePath);
      existing.folders.add(folder);
    } else {
      byName.set(fileName, {
        name: fileName,
        paths: [filePath],
        folders: new Set([folder]),
      });
    }
  }

  return Array.from(byName.values())
    .filter((group) => group.paths.length > 1 && group.folders.size > 1)
    .map((group) => ({
      name: group.name,
      count: group.paths.length,
      folderCount: group.folders.size,
      paths: group.paths.sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.folderCount !== left.folderCount) return right.folderCount - left.folderCount;
      return left.name.localeCompare(right.name);
    });
}

function printText(groups, totalGroups, totalFiles) {
  process.stdout.write(
    `Found ${totalGroups} overlapping filename groups across ${totalFiles} non-gitignored files.\n\n`,
  );

  for (const group of groups) {
    process.stdout.write(`${group.name} (${group.count} files, ${group.folderCount} folders)\n`);
    for (const filePath of group.paths) {
      process.stdout.write(`  ${filePath}\n`);
    }
    process.stdout.write("\n");
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = gitRoot();
  const files = gitVisibleFiles(root);
  const groups = groupOverlaps(files);
  const visibleGroups = options.limit ? groups.slice(0, options.limit) : groups;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          totalFiles: files.length,
          totalGroups: groups.length,
          groups: visibleGroups,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  printText(visibleGroups, groups.length, files.length);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
