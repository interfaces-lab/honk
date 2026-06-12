import { readFileSync } from "node:fs";
import { parse } from "yaml";

export function readWorkspaceCatalog(workspaceUrl: URL): Record<string, string> {
  const workspace = parse(readFileSync(workspaceUrl, "utf8")) as unknown;

  if (
    typeof workspace !== "object" ||
    workspace === null ||
    !("catalog" in workspace) ||
    typeof workspace.catalog !== "object" ||
    workspace.catalog === null
  ) {
    throw new Error("Expected pnpm-workspace.yaml to define a catalog.");
  }

  return workspace.catalog as Record<string, string>;
}
