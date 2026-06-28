#!/usr/bin/env node
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRegistryItemPayloads } from "./build-registry.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModulesPath = path.join(packageRoot, "node_modules");
const tscPath = path.join(nodeModulesPath, ".bin", "tsc");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "honkkit-registry-install-"));
const registryItems = createRegistryItemPayloads(packageRoot);
const registryItemsByName = new Map(registryItems.map((item) => [item.name, item]));

try {
  for (const item of registryItems) {
    const installRoot = path.join(tempRoot, "items", item.name);
    const installedFiles = new Map();
    for (const dependencyItem of collectInstallItems(item.name)) {
      for (const file of dependencyItem.files ?? []) {
        if (!file.target) {
          continue;
        }
        if (typeof file.content !== "string") {
          throw new Error(`${dependencyItem.name} ${file.path} has no generated file content.`);
        }

        const targetPath = path.join(installRoot, file.target);
        const existingContent = installedFiles.get(file.target);
        if (existingContent !== undefined && existingContent !== file.content) {
          throw new Error(`${item.name} writes different generated content to ${file.target}.`);
        }
        installedFiles.set(file.target, file.content);

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, file.content);
      }
    }
  }

  fs.writeFileSync(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(tempRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2023",
        },
        include: ["items/**/*.ts", "items/**/*.tsx"],
      },
      null,
      2,
    ) + "\n",
  );
  fs.symlinkSync(nodeModulesPath, path.join(tempRoot, "node_modules"), "dir");

  childProcess.execFileSync(tscPath, ["-p", path.join(tempRoot, "tsconfig.json"), "--noEmit"], {
    cwd: tempRoot,
    stdio: "inherit",
  });
} catch (error) {
  console.error(`registry install check failed in ${tempRoot}`);
  throw error;
}

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`honkkit registry install ok (${registryItems.length} item installs)`);

function collectInstallItems(itemName, seen = new Set()) {
  if (seen.has(itemName)) {
    return [];
  }
  seen.add(itemName);

  const item = registryItemsByName.get(itemName);
  if (!item) {
    throw new Error(`Missing registry item "${itemName}".`);
  }

  const items = [item];
  for (const dependency of item.registryDependencies ?? []) {
    if (!dependency.startsWith("@honkkit/")) {
      throw new Error(`${item.name} has unqualified registry dependency "${dependency}".`);
    }
    items.push(...collectInstallItems(dependency.slice("@honkkit/".length), seen));
  }

  return items;
}
