import { normalizePathSeparators as normalizeTreePath } from "@honk/shared/paths";

import type { ContextMenuItem } from "@pierre/trees";

type RenameFileTreePathsResult =
  | {
      nextFiles: string[];
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
    }
  | { error: string };

function splitPath(path: string): { parentPath: string; baseName: string } {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex < 0) {
    return { parentPath: "", baseName: path };
  }
  return {
    parentPath: path.slice(0, separatorIndex),
    baseName: path.slice(separatorIndex + 1),
  };
}

function joinPath(parentPath: string, baseName: string): string {
  return parentPath === "" ? baseName : `${parentPath}/${baseName}`;
}

function selectionPath(path: string): string {
  return normalizeTreePath(path).replace(/\/+$/g, "");
}

export function relativePathFromContextItem(item: ContextMenuItem): string {
  return selectionPath(item.path);
}

export function parentDirectoryFromContextItem(item: ContextMenuItem): string {
  const relativePath = relativePathFromContextItem(item);
  if (item.kind === "directory") {
    return relativePath;
  }
  const separatorIndex = relativePath.lastIndexOf("/");
  return separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex);
}

export function uniqueSiblingName(input: {
  parentDir: string;
  baseName: string;
  treePaths: readonly string[];
  isDirectory: boolean;
}): string {
  const normalizedParent = selectionPath(input.parentDir);
  const siblingBasenames = new Set<string>();
  for (const treePath of input.treePaths) {
    const normalizedPath = selectionPath(treePath);
    const { parentPath, baseName } = splitPath(normalizedPath);
    if (parentPath !== normalizedParent) {
      continue;
    }
    siblingBasenames.add(baseName);
  }

  if (!siblingBasenames.has(input.baseName)) {
    return input.baseName;
  }

  let index = 1;
  while (true) {
    const candidate = index === 1 ? `${input.baseName} 1` : `${input.baseName} ${index}`;
    if (!siblingBasenames.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function treePathForNewFile(parentDir: string, fileName: string): string {
  const normalizedParent = selectionPath(parentDir);
  return normalizedParent ? `${normalizedParent}/${fileName}` : fileName;
}

export function treePathForNewFolder(parentDir: string, folderName: string): string {
  const normalizedParent = selectionPath(parentDir);
  const relativePath = normalizedParent ? `${normalizedParent}/${folderName}` : folderName;
  return `${relativePath}/`;
}

export function renameFileTreePaths(input: {
  files: readonly string[];
  path: string;
  isFolder: boolean;
  nextBasename: string;
}): RenameFileTreePathsResult {
  const sourcePath = selectionPath(input.path);
  const trimmedBasename = input.nextBasename.trim();
  if (trimmedBasename.length === 0) {
    return { error: "Name cannot be empty." };
  }
  if (trimmedBasename.includes("/")) {
    return { error: 'Name cannot include "/".' };
  }

  const { parentPath, baseName } = splitPath(sourcePath);
  if (trimmedBasename === baseName) {
    return {
      nextFiles: [...input.files],
      sourcePath,
      destinationPath: sourcePath,
      isFolder: input.isFolder,
    };
  }

  const destinationPath = joinPath(parentPath, trimmedBasename);
  const nextFiles = new Array<string>(input.files.length);
  const seenPaths = new Set<string>();

  if (!input.isFolder) {
    const destinationPrefix = `${destinationPath}/`;
    let renamed = false;
    for (let index = 0; index < input.files.length; index += 1) {
      const file = input.files[index] ?? "";
      if (file !== sourcePath && file.startsWith(destinationPrefix)) {
        return { error: `"${destinationPath}" already exists.` };
      }
      const nextFile = file === sourcePath ? destinationPath : file;
      if (seenPaths.has(nextFile)) {
        return { error: `"${destinationPath}" already exists.` };
      }
      seenPaths.add(nextFile);
      nextFiles[index] = nextFile;
      if (file === sourcePath) {
        renamed = true;
      }
    }
    if (!renamed) {
      return { error: "Could not find the selected file to rename." };
    }
    return {
      nextFiles,
      sourcePath,
      destinationPath,
      isFolder: input.isFolder,
    };
  }

  const sourcePrefix = `${sourcePath}/`;
  const destinationPrefix = `${destinationPath}/`;
  let renamedPathCount = 0;
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index] ?? "";
    const isWithinRenamedFolder = file === sourcePath || file.startsWith(sourcePrefix);
    if (
      !isWithinRenamedFolder &&
      (file === destinationPath || file.startsWith(destinationPrefix))
    ) {
      return { error: `"${destinationPath}" already exists.` };
    }
    const nextFile = isWithinRenamedFolder
      ? `${destinationPath}${file.slice(sourcePath.length)}`
      : file;
    if (seenPaths.has(nextFile)) {
      return { error: `"${destinationPath}" already exists.` };
    }
    seenPaths.add(nextFile);
    nextFiles[index] = nextFile;
    if (isWithinRenamedFolder) {
      renamedPathCount += 1;
    }
  }
  if (renamedPathCount === 0) {
    return { error: "Could not find the selected folder to rename." };
  }
  return {
    nextFiles,
    sourcePath,
    destinationPath,
    isFolder: input.isFolder,
  };
}

export function remapExpandedDirectoryPathsForFolderRename(input: {
  expandedPaths: readonly string[];
  sourcePath: string;
  destinationPath: string;
}): string[] {
  if (input.expandedPaths.length === 0 || input.sourcePath === input.destinationPath) {
    return [...input.expandedPaths];
  }
  const sourcePrefix = `${input.sourcePath}/`;
  const nextExpandedPaths: string[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const path of input.expandedPaths) {
    const nextPath =
      path === input.sourcePath
        ? input.destinationPath
        : path.startsWith(sourcePrefix)
          ? `${input.destinationPath}${path.slice(input.sourcePath.length)}`
          : path;
    if (nextPath !== path) {
      changed = true;
    }
    if (seen.has(nextPath)) {
      changed = true;
      continue;
    }
    seen.add(nextPath);
    nextExpandedPaths.push(nextPath);
  }
  return changed ? nextExpandedPaths : [...input.expandedPaths];
}
