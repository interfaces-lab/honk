import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const EXTENSION_FILE_PATTERN = /\.(ts|js)$/;
const EXTENSIONS_DIR_NAME = "extensions";
const GLOB_SEGMENT = "*";

export function normalizeAdditionalExtensionPaths(paths: readonly string[], cwd: string): string[] {
  return paths.flatMap((path) => expandExtensionsDirectoryPath(path, cwd));
}

function expandExtensionsDirectoryPath(path: string, cwd: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return [path];
  }

  const normalized = withoutTrailingSeparators(trimmed);
  const parent = dirname(normalized);
  const basenameValue = basename(normalized);
  if (basenameValue === GLOB_SEGMENT && basename(parent) === EXTENSIONS_DIR_NAME) {
    return listExtensionChildren(resolvePath(parent, cwd)) ?? [path];
  }

  if (basenameValue !== EXTENSIONS_DIR_NAME) {
    return [path];
  }

  const children = listExtensionChildren(resolvePath(normalized, cwd));
  return children ?? [path];
}

function withoutTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function resolvePath(path: string, cwd: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function listExtensionChildren(path: string): string[] | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    if (!statSync(path).isDirectory()) {
      return null;
    }
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith("."))
      .filter(
        (entry) =>
          entry.isDirectory() || (entry.isFile() && EXTENSION_FILE_PATTERN.test(entry.name)),
      )
      .map((entry) => join(path, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return null;
  }
}
