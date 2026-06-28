#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRegistryDir = path.resolve(packageRoot, "../marketing/public/r");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes("--dry-run");
  const outputs = createRegistryOutputs();

  if (!dryRun) {
    fs.rmSync(publicRegistryDir, { recursive: true, force: true });
    fs.mkdirSync(publicRegistryDir, { recursive: true });

    for (const output of outputs) {
      fs.writeFileSync(path.join(publicRegistryDir, output.fileName), output.content);
    }
  }

  const mode = dryRun ? "dry-run ok" : `built to ${path.relative(packageRoot, publicRegistryDir)}`;
  console.log(`honkkit registry ${mode} (${outputs.length} files)`);
}

export function createRegistryOutputs(root = packageRoot) {
  const registry = readRegistry(root);
  const indexPayload = {
    $schema: registry.$schema,
    name: registry.name,
    homepage: registry.homepage,
    items: registry.items,
  };

  return [
    {
      fileName: "registry.json",
      content: JSON.stringify(indexPayload, null, 2) + "\n",
    },
    ...createRegistryItemPayloads(root).map((payload) => ({
      fileName: `${payload.name}.json`,
      content: JSON.stringify(payload, null, 2) + "\n",
    })),
  ];
}

export function createRegistryItemPayloads(root = packageRoot) {
  const registry = readRegistry(root);
  return registry.items.map((item) => ({
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    ...item,
    files: item.files?.map((file) => ({
      ...file,
      content: fs.readFileSync(path.join(root, file.path), "utf8"),
    })),
  }));
}

function readRegistry(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "registry.json"), "utf8"));
}
