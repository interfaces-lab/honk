import type {
  LocationInfo as OpenCodeLocationInfo,
  SessionV2Info as OpenCodeSessionInfo,
} from "@opencode-ai/sdk/v2/client";

import type { OpenCodeClient, OpenCodeCreateSessionInput } from "./client";
import { openCodeLocationRef, sameOpenCodeLocation, type OpenCodeLocationRef } from "./identity";

const OPEN_CODE_PROJECT_COPY_STRATEGY = "git_worktree";

type OpenCodeSessionTarget =
  | { readonly type: "local" }
  | { readonly type: "new-workspace" }
  | { readonly type: "workspace"; readonly location: OpenCodeLocationRef };

type OpenCodeCreateTargetedSessionInput = Omit<OpenCodeCreateSessionInput, "location"> & {
  readonly source: OpenCodeLocationRef;
  readonly target: OpenCodeSessionTarget;
};

const OPEN_CODE_LOCAL_SESSION_TARGET: OpenCodeSessionTarget = Object.freeze({ type: "local" });
const OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET: OpenCodeSessionTarget = Object.freeze({
  type: "new-workspace",
});

function openCodeWorkspaceSessionTarget(location: OpenCodeLocationRef): OpenCodeSessionTarget {
  return Object.freeze({ type: "workspace", location: openCodeLocationRef(location) });
}

function sameOpenCodeSessionTarget(
  left: OpenCodeSessionTarget,
  right: OpenCodeSessionTarget,
): boolean {
  if (left.type !== right.type) return false;
  if (left.type !== "workspace" || right.type !== "workspace") return true;
  return sameOpenCodeLocation(left.location, right.location);
}

function normalizeOpenCodeSessionTarget(target: OpenCodeSessionTarget): OpenCodeSessionTarget {
  if (target.type === "local") return OPEN_CODE_LOCAL_SESSION_TARGET;
  if (target.type === "new-workspace") return OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET;
  return openCodeWorkspaceSessionTarget(target.location);
}

function pathSeparator(path: string): "/" | "\\" {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") ? "\\" : "/";
}

function trimTrailingSeparators(path: string, separator: "/" | "\\"): string {
  if (separator === "/") return path === "/" ? path : path.replace(/\/+$/, "");
  if (/^[A-Za-z]:\\$/.test(path)) return path;
  return path.replace(/\\+$/, "");
}

function serverPathParent(path: string, separator: "/" | "\\"): string {
  const normalized = trimTrailingSeparators(path, separator);
  if (normalized === "/" || /^[A-Za-z]:\\$/.test(normalized)) return normalized;
  const index = normalized.lastIndexOf(separator);
  if (index < 0) throw new Error(`OpenCode returned a non-absolute project path: ${path}`);
  if (separator === "/" && index === 0) return "/";
  if (separator === "\\" && /^[A-Za-z]:\\/.test(normalized) && index === 2) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, index);
}

function joinServerPath(separator: "/" | "\\", ...parts: readonly string[]): string {
  return parts.reduce((result, part) => {
    if (result.length === 0) return trimTrailingSeparators(part, separator);
    const left = trimTrailingSeparators(result, separator);
    const right = part.replace(separator === "/" ? /^\/+|\/+$/g : /^\\+|\\+$/g, "");
    return left.endsWith(separator) ? `${left}${right}` : `${left}${separator}${right}`;
  }, "");
}

function projectDirectorySegment(projectID: string): string {
  const value = projectID.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 6);
  return value.length > 0 ? value : "project";
}

function openCodeProjectCopyParent(location: OpenCodeLocationInfo): string {
  if (location.project.id === "global") {
    throw new Error("A workspace can be created only for a version-controlled project.");
  }
  const separator = pathSeparator(location.project.directory);
  const parent = serverPathParent(location.project.directory, separator);
  return joinServerPath(
    separator,
    parent,
    ".opencode",
    "worktree",
    projectDirectorySegment(location.project.id),
  );
}

function openCodeLocalSessionLocation(location: OpenCodeLocationInfo): OpenCodeLocationRef {
  return openCodeLocationRef({
    directory: location.project.id === "global" ? location.directory : location.project.directory,
  });
}

async function createOpenCodeTargetedSession(
  client: OpenCodeClient,
  input: OpenCodeCreateTargetedSessionInput,
): Promise<OpenCodeSessionInfo> {
  const source = await client.resolveLocation(input.source);
  const sessionInput: Omit<OpenCodeCreateSessionInput, "location"> = {
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.model === undefined ? {} : { model: input.model }),
  };

  if (input.target.type === "local") {
    return client.sessions.create({
      ...sessionInput,
      location: openCodeLocalSessionLocation(source),
    });
  }

  if (input.target.type === "workspace") {
    const target = await client.resolveLocation(input.target.location);
    if (target.project.id !== source.project.id) {
      throw new Error("The selected workspace belongs to a different project.");
    }
    return client.sessions.create({
      ...sessionInput,
      location: openCodeLocationRef(input.target.location),
    });
  }

  const sourceLocation = openCodeLocationRef({ directory: source.project.directory });
  const copy = await client.projectCopies.create({
    projectID: source.project.id,
    location: sourceLocation,
    strategy: OPEN_CODE_PROJECT_COPY_STRATEGY,
    directory: openCodeProjectCopyParent(source),
  });
  try {
    return await client.sessions.create({
      ...sessionInput,
      location: openCodeLocationRef({ directory: copy.directory }),
    });
  } catch (error) {
    await client.projectCopies
      .remove({
        projectID: source.project.id,
        location: sourceLocation,
        directory: copy.directory,
        force: false,
      })
      .catch(() => undefined);
    throw error;
  }
}

async function resolveOpenCodeProjectDirectories(
  client: OpenCodeClient,
  sessions: readonly Pick<OpenCodeSessionInfo, "projectID" | "location">[],
): Promise<ReadonlyMap<string, string>> {
  const directories = new Map<string, string>();
  const representatives = new Map<string, OpenCodeLocationRef>();
  for (const session of sessions) {
    if (!representatives.has(session.projectID)) {
      representatives.set(session.projectID, openCodeLocationRef(session.location));
    }
  }

  await Promise.all(
    [...representatives].map(async ([projectID, location]) => {
      try {
        const resolved = await client.resolveLocation(location);
        directories.set(
          projectID,
          resolved.project.id === "global" ? resolved.directory : resolved.project.directory,
        );
      } catch {
        // A deleted or offline project copy still has a useful last-known location.
        directories.set(projectID, location.directory);
      }
    }),
  );
  return directories;
}

export {
  OPEN_CODE_LOCAL_SESSION_TARGET,
  OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
  OPEN_CODE_PROJECT_COPY_STRATEGY,
  createOpenCodeTargetedSession,
  normalizeOpenCodeSessionTarget,
  openCodeProjectCopyParent,
  openCodeWorkspaceSessionTarget,
  resolveOpenCodeProjectDirectories,
  sameOpenCodeSessionTarget,
};
export type { OpenCodeCreateTargetedSessionInput, OpenCodeSessionTarget };
