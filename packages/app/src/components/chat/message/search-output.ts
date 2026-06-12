export interface ParsedGrepOutput {
  readonly kind: "grep";
  readonly files: ReadonlyArray<ParsedGrepFile>;
}

export interface ParsedGrepFile {
  readonly path: string;
  readonly annotation?: string | undefined;
  readonly lines: ReadonlyArray<ParsedGrepLine>;
}

export interface ParsedGrepLine {
  readonly lineNumber: number;
  readonly separator: ":" | "-";
  readonly text: string;
}

export interface ParsedFindOutput {
  readonly kind: "find";
  readonly files: ReadonlyArray<ParsedFindFile>;
}

export interface ParsedFindFile {
  readonly path: string;
  readonly annotation?: string | undefined;
}

export interface ParsedFallbackOutput {
  readonly kind: "fallback";
  readonly text: string;
}

export type ParsedSearchOutput = ParsedGrepOutput | ParsedFindOutput | ParsedFallbackOutput;

const GREP_LINE_PATTERN = /^\s*(\d+)([:-])\s?(.*)$/;
const CLASSIC_GREP_LINE_PATTERN = /^(.+?):(\d+):\s?(.*)$/;
const TRAILING_ANNOTATION_PATTERN = /\s+\[([^\]]+)\]$/;

export function parseGrepOutput(output: string): ParsedGrepOutput | ParsedFallbackOutput {
  const text = output.trim();
  if (!text) {
    return { kind: "fallback", text: output };
  }

  const grouped = parseGroupedGrepOutput(text);
  if (grouped.files.length > 0) {
    return grouped;
  }

  const classic = parseClassicGrepOutput(text);
  if (classic.files.length > 0) {
    return classic;
  }

  return { kind: "fallback", text: output };
}

export function parseFindOutput(output: string): ParsedFindOutput | ParsedFallbackOutput {
  const files = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("["))
    .map(parseAnnotatedPath)
    .filter((file) => isLikelyPath(file.path));

  if (files.length === 0) {
    return { kind: "fallback", text: output };
  }

  return { kind: "find", files };
}

function parseGroupedGrepOutput(text: string): ParsedGrepOutput {
  const files: ParsedGrepFile[] = [];
  let currentFile: {
    path: string;
    annotation?: string | undefined;
    lines: ParsedGrepLine[];
  } | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const grepLine = GREP_LINE_PATTERN.exec(line);
    if (grepLine && currentFile) {
      currentFile.lines.push({
        lineNumber: Number(grepLine[1]),
        separator: grepLine[2] === "-" ? "-" : ":",
        text: grepLine[3] ?? "",
      });
      continue;
    }

    if (line.startsWith("[") || line.startsWith(" ")) {
      continue;
    }

    if (currentFile && currentFile.lines.length > 0) {
      files.push(currentFile);
    }
    const parsedPath = parseAnnotatedPath(line);
    currentFile = { ...parsedPath, lines: [] };
  }

  if (currentFile && currentFile.lines.length > 0) {
    files.push(currentFile);
  }

  return { kind: "grep", files };
}

function parseClassicGrepOutput(text: string): ParsedGrepOutput {
  const files = new Map<string, ParsedGrepLine[]>();
  for (const rawLine of text.split(/\r?\n/)) {
    const match = CLASSIC_GREP_LINE_PATTERN.exec(rawLine);
    if (!match) {
      continue;
    }
    const path = match[1]?.trim();
    const lineNumber = Number(match[2]);
    if (!path || !Number.isInteger(lineNumber)) {
      continue;
    }
    const lines = files.get(path) ?? [];
    lines.push({
      lineNumber,
      separator: ":",
      text: match[3] ?? "",
    });
    files.set(path, lines);
  }

  return {
    kind: "grep",
    files: [...files].map(([path, lines]) => ({ path, lines })),
  };
}

function parseAnnotatedPath(line: string): ParsedFindFile {
  const match = TRAILING_ANNOTATION_PATTERN.exec(line);
  if (!match) {
    return { path: line };
  }
  return {
    path: line.slice(0, match.index).trimEnd(),
    annotation: match[1],
  };
}

function isLikelyPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("\n")) {
    return false;
  }
  if (trimmed === "No matches found" || trimmed === "No files found matching pattern") {
    return false;
  }
  return true;
}
