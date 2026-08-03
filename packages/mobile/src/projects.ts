import type { RemoteSession } from "./remote-context";

export const MOBILE_HOME_SESSION_LIMIT = 64;

export interface MobileProject {
  readonly key: string;
  readonly path: string;
  readonly title: string;
  readonly serverLabel: string;
  readonly sessions: readonly RemoteSession[];
  readonly updatedAt: number;
}

function projectTitle(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? path;
}

export function activeRootSessions(sessions: readonly RemoteSession[]): readonly RemoteSession[] {
  return sessions
    .filter(
      (session) =>
        session.info.time.archived === undefined &&
        (session.info.parentID === undefined || session.info.parentID.length === 0),
    )
    .slice()
    .sort((left, right) => {
      const byUpdated = right.info.time.updated - left.info.time.updated;
      if (byUpdated !== 0) return byUpdated;
      const byServer = left.ref.server.localeCompare(right.ref.server);
      return byServer !== 0 ? byServer : left.ref.sessionID.localeCompare(right.ref.sessionID);
    });
}

export function groupSessionsByProject(
  sessions: readonly RemoteSession[],
): readonly MobileProject[] {
  const groups = new Map<string, { path: string; sessions: RemoteSession[] }>();
  for (const session of sessions) {
    const path = session.projectDirectory;
    const key = JSON.stringify([session.server.key, session.info.projectID]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { path, sessions: [session] });
    else group.sessions.push(session);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      path: group.path,
      title: projectTitle(group.path),
      serverLabel: group.sessions[0]?.server.label ?? "OpenCode",
      sessions: group.sessions,
      updatedAt: group.sessions[0]?.info.time.updated ?? 0,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
