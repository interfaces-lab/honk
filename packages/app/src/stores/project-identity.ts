import { scopedProjectKey } from "@multi/client-runtime";
import type { ScopedProjectRef } from "@multi/contracts";
import { normalizeProjectPathForComparison } from "../lib/project-paths";
import type { Project } from "../types";

export function derivePhysicalProjectKeyFromPath(environmentId: string, cwd: string): string {
  return `${environmentId}:${normalizeProjectPathForComparison(cwd)}`;
}

export function derivePhysicalProjectKey(project: Pick<Project, "environmentId" | "cwd">): string {
  return derivePhysicalProjectKeyFromPath(project.environmentId, project.cwd);
}

export function getProjectOrderKey(project: Pick<Project, "environmentId" | "cwd">): string {
  return derivePhysicalProjectKey(project);
}

export function deriveSidebarProjectStateKey(
  project: Pick<Project, "environmentId" | "cwd">,
): string {
  return derivePhysicalProjectKey(project);
}

export function deriveLogicalProjectKey(
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
): string {
  const physicalProjectKey = derivePhysicalProjectKey(project);
  return project.repositoryIdentity?.canonicalKey ?? physicalProjectKey;
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity"> | null | undefined,
): string {
  return project ? deriveLogicalProjectKey(project) : scopedProjectKey(projectRef);
}
