import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const applicationRoot = `${repositoryRoot}/packages/app`;
const entryFile = `${applicationRoot}/src/main.tsx`;
const settingsPanelFiles = [
  "settings-appearance.tsx",
  "settings-connections.tsx",
  "settings-general.tsx",
  "settings-hooks.tsx",
  "settings-mcp.tsx",
  "settings-plugins.tsx",
  "settings-providers.tsx",
  "settings-rules.tsx",
  "settings-servers.tsx",
].map((file) => `${applicationRoot}/src/${file}`);

const sourceExtensions = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelativeImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;

  const unresolved = fileURLToPath(new URL(specifier, `file://${importer}`));
  const candidates = [
    unresolved,
    ...sourceExtensions.map((extension) => `${unresolved}${extension}`),
    ...sourceExtensions.map((extension) => `${unresolved}/index${extension}`),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

function staticImportSpecifiers(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const specifiers = [];
  const staticImport =
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\w*$,\s{}]+\s+from\s+)?["']([^"']+)["']/g;

  for (const match of withoutComments.matchAll(staticImport)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }

  return specifiers;
}

async function collectStaticGraph(entry) {
  const pending = [entry];
  const graph = new Map();

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || graph.has(file)) continue;

    const source = await readFile(file, "utf8");
    graph.set(file, Buffer.byteLength(source));

    for (const specifier of staticImportSpecifiers(source)) {
      const dependency = await resolveRelativeImport(file, specifier);
      if (dependency !== null && dependency.startsWith(`${applicationRoot}/src/`)) {
        pending.push(dependency);
      }
    }
  }

  return graph;
}

function kibibytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

const graph = await collectStaticGraph(entryFile);
const eagerBytes = [...graph.values()].reduce((total, bytes) => total + bytes, 0);
const eagerPanels = settingsPanelFiles.filter((file) => graph.has(file));

console.log(
  `[frontend startup review] ${graph.size} eager app modules, ${kibibytes(eagerBytes)} source`,
);
console.log(
  `[frontend startup review] ${eagerPanels.length}/${settingsPanelFiles.length} settings panels eager`,
);

if (eagerPanels.length > 0) {
  for (const file of eagerPanels) {
    console.error(
      `[frontend startup review] eager settings panel: ${file.slice(repositoryRoot.length)}`,
    );
  }
  process.exitCode = 1;
}
