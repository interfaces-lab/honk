import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

describe("runtime package boundary", () => {
  it("does not import Pi TUI directly", () => {
    const sourceFiles = listSourceFiles(join(process.cwd(), "src"));
    const offenders = sourceFiles.filter((file) =>
      readFileSync(file, "utf8").includes("@earendil-works/pi-tui"),
    );

    expect(offenders).toEqual([]);
  });
});
