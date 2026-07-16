export type PathSeparator = "/" | "\\";

export function normalizePathSeparators(path: string, separator: PathSeparator = "/"): string {
  return separator === "/" ? path.replaceAll("\\", "/") : path.replaceAll("/", "\\");
}

export function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const name = normalized.split(/[\\/]/).at(-1) ?? "";
  return name.length > 0 ? name : path;
}

export function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:([/\\]|$)/.test(path);
}

// Browser/file-URL parsers encode "C:/foo" as "/C:/foo"; strip that artifact.
export function stripWindowsDriveLeadingSlash(path: string): string {
  return /^\/[A-Za-z]:([/\\]|$)/.test(path) ? path.slice(1) : path;
}

export function contractHomeDir(path: string, home: string | null | undefined): string {
  const normalizedPath = normalizePathSeparators(path).replace(/\/+$/, "");
  if (!home) return normalizedPath;

  const normalizedHome = normalizePathSeparators(home).replace(/\/+$/, "");
  if (!normalizedHome) return normalizedPath;
  if (normalizedPath === normalizedHome) return "~";

  const homePrefix = `${normalizedHome}/`;
  return normalizedPath.startsWith(homePrefix)
    ? `~/${normalizedPath.slice(homePrefix.length)}`
    : normalizedPath;
}
