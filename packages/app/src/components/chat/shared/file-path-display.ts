import { normalizePathSeparators, stripWindowsDriveLeadingSlash } from "@honk/shared/paths";

import { splitPathAndPosition } from "../../../lib/terminal-links";

function trimTrailingPathSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function stripRelativePrefixes(path: string): string {
  return path.replace(/^\.\/+/, "").replace(/^\/+/, "");
}

export function formatProjectRelativePath(
  pathWithPosition: string,
  projectRoot: string | undefined,
): string {
  const { path, line, column } = splitPathAndPosition(pathWithPosition);
  const normalizedPath = stripWindowsDriveLeadingSlash(normalizePathSeparators(path));

  let displayPath = normalizedPath;
  if (projectRoot) {
    const normalizedProjectRoot = stripWindowsDriveLeadingSlash(
      normalizePathSeparators(trimTrailingPathSeparators(projectRoot)),
    );
    const projectLabel = basenameOfPath(normalizedProjectRoot);
    const pathForCompare = normalizedPath.toLowerCase();
    const projectForCompare = normalizedProjectRoot.toLowerCase();
    const projectWithSeparator = `${projectForCompare}/`;
    const projectLabelWithSeparator = `${projectLabel.toLowerCase()}/`;

    if (pathForCompare === projectForCompare) {
      displayPath = projectLabel;
    } else if (pathForCompare.startsWith(projectWithSeparator)) {
      const relativeSuffix = normalizedPath.slice(normalizedProjectRoot.length + 1);
      displayPath = `${projectLabel}/${relativeSuffix}`;
    } else if (!normalizedPath.startsWith("/")) {
      const relativePath = stripRelativePrefixes(normalizedPath);
      displayPath = pathForCompare.startsWith(projectLabelWithSeparator)
        ? normalizedPath
        : `${projectLabel}/${relativePath}`;
    }
  }

  if (!line) return displayPath;
  return `${displayPath}:${line}${column ? `:${column}` : ""}`;
}
