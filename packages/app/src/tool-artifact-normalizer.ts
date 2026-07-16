// Tool artifacts retain the complete structured payload. The transcript's short output strip is a
// separate projection, so disclosure and syntax rendering never depend on already-truncated text.

import {
  asRecord,
  booleanField,
  numberField,
  recordArray,
  stringField,
  toolMetadata,
  type ToolPart,
} from "./tool-part-projection";

type ToolArtifactFile = {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
};

type ToolDiffArtifact = {
  readonly kind: "diff";
  readonly patch: string;
  readonly files: readonly ToolArtifactFile[];
};

type ToolSourceArtifact = {
  readonly kind: "source";
  readonly path: string;
  readonly contents: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly files: readonly ToolArtifactFile[];
};

type ToolArtifact = ToolDiffArtifact | ToolSourceArtifact;

function toolArtifact(part: ToolPart): ToolArtifact | undefined {
  if (part.state.status !== "completed") {
    return undefined;
  }
  if (part.tool === "read") {
    return readSourceArtifact(part);
  }
  if (part.tool === "apply_patch") {
    return applyPatchArtifact(part);
  }
  if (part.tool === "edit" || part.tool === "patch") {
    return editDiffArtifact(part);
  }
  if (part.tool === "write") {
    return editDiffArtifact(part);
  }
  return undefined;
}

// OpenCode 1.18.1 exposes the exact file slice used by the read tool under metadata.display.
// Rendering that projection keeps line ranges honest without parsing the human-facing output.
function readSourceArtifact(part: ToolPart): ToolSourceArtifact | undefined {
  if (part.state.status !== "completed") return undefined;
  const display = asRecord(toolMetadata(part).display);
  if (stringField(display, "type") !== "file") return undefined;

  const path = stringField(display, "path");
  const contents = stringField(display, "text");
  const lineStart = numberField(display, "lineStart");
  const lineEnd = numberField(display, "lineEnd");
  const totalLines = numberField(display, "totalLines");
  const truncated = booleanField(display, "truncated");
  if (
    path === undefined ||
    contents === undefined ||
    lineStart === undefined ||
    lineEnd === undefined ||
    totalLines === undefined ||
    truncated === undefined
  ) {
    return undefined;
  }

  return {
    kind: "source",
    path,
    contents,
    lineStart,
    lineEnd,
    totalLines,
    truncated,
    files: [{ path, additions: 0, deletions: 0 }],
  };
}

function applyPatchArtifact(part: ToolPart): ToolDiffArtifact | undefined {
  if (part.state.status !== "completed") {
    return undefined;
  }

  const metadata = toolMetadata(part);
  const metadataFiles = recordArray(metadata, "files");
  const patches = metadataFiles?.flatMap((file) => {
    const patch = stringField(file, "patch");
    if (patch === undefined) {
      return [];
    }
    const path =
      stringField(file, "movePath") ??
      stringField(file, "filePath") ??
      stringField(file, "relativePath") ??
      "file";
    return [{ patch: normalizePatchForFile(patch, path), file, path }];
  });

  if (patches !== undefined && patches.length > 0) {
    return {
      kind: "diff",
      patch: patches.map((entry) => entry.patch).join("\n"),
      files: patches.map((entry) => patchFile(entry.path, entry.patch, entry.file)),
    };
  }

  return undefined;
}

function editDiffArtifact(part: ToolPart): ToolDiffArtifact | undefined {
  if (part.state.status !== "completed") {
    return undefined;
  }
  const metadata = toolMetadata(part);
  const fileDiff = asRecord(metadata.filediff);
  const path = stringField(part.state.input, "filePath") ?? stringField(fileDiff, "file") ?? "file";
  const patch = stringField(metadata, "diff") ?? stringField(fileDiff, "patch");
  if (patch === undefined) return undefined;
  const normalized = normalizePatchForFile(patch, path);
  return {
    kind: "diff",
    patch: normalized,
    files: [patchFile(path, normalized, fileDiff ?? metadata)],
  };
}

function patchFile(
  path: string,
  patch: string,
  metadata: Record<string, unknown> | undefined,
): ToolArtifactFile {
  const measured = measurePatchChanges(patch);
  return {
    path,
    additions: numberField(metadata, "additions") ?? measured.additions,
    deletions: numberField(metadata, "deletions") ?? measured.deletions,
  };
}

function normalizePatchForFile(patch: string, path: string): string {
  const normalized = patch.trim();
  if (hasFileHeaders(normalized) || !/^@@/m.test(normalized)) {
    return normalized;
  }
  return [`--- a/${path}`, `+++ b/${path}`, normalized].join("\n");
}

function hasFileHeaders(patch: string): boolean {
  return /^---\s+.+$/m.test(patch) && /^\+\+\+\s+.+$/m.test(patch);
}

function measurePatchChanges(patch: string): {
  readonly additions: number;
  readonly deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

export { measurePatchChanges, normalizePatchForFile, toolArtifact };
export type { ToolArtifact, ToolArtifactFile, ToolDiffArtifact, ToolSourceArtifact };
