import type { OpenCodeClient, OpenCodeLocationQuery, OpenCodeSessionInfo } from "@honk/opencode";

import type { SessionActivity } from "./session-watch";

const REQUEST_CONCURRENCY = 6;

// Session status lives in per-directory instance state on the sidecar. An
// unscoped status request only reports sessions from the default instance.
export async function loadSessionActivity(
  client: OpenCodeClient,
  sessions: readonly OpenCodeSessionInfo[],
): Promise<ReadonlyMap<string, SessionActivity>> {
  const groups = new Map<
    string,
    { readonly location: OpenCodeLocationQuery; readonly sessionIDs: Set<string> }
  >();
  for (const info of sessions) {
    const key = JSON.stringify([info.location.directory, info.location.workspaceID ?? null]);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.sessionIDs.add(info.id);
      continue;
    }
    groups.set(key, { location: info.location, sessionIDs: new Set([info.id]) });
  }
  const locations = [...groups.values()];
  const activity = new Map<string, SessionActivity>();
  let index = 0;

  async function worker(): Promise<void> {
    while (index < locations.length) {
      const group = locations[index];
      index += 1;
      if (group === undefined) continue;
      try {
        const active = await client.sessions.active(group.location);
        for (const sessionID of group.sessionIDs) {
          activity.set(sessionID, sessionID in active ? "busy" : "idle");
        }
      } catch {
        // Preserve event-derived activity when one location cannot report status.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(REQUEST_CONCURRENCY, locations.length) }, () => worker()),
  );
  return activity;
}

export async function loadAttentionRequests(
  client: OpenCodeClient,
  sessions: readonly OpenCodeSessionInfo[],
  activity: ReadonlyMap<string, SessionActivity>,
  currentActivity: (sessionID: string) => SessionActivity,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const requests = new Map<string, readonly string[]>();
  const groups = new Map<
    string,
    { readonly location: OpenCodeLocationQuery; readonly sessionIDs: Set<string> }
  >();
  for (const info of sessions) {
    requests.set(info.id, []);
    if ((activity.get(info.id) ?? currentActivity(info.id)) === "idle") continue;
    const key = JSON.stringify([info.location.directory, info.location.workspaceID ?? null]);
    const existing = groups.get(key);
    if (existing !== undefined) {
      existing.sessionIDs.add(info.id);
      continue;
    }
    groups.set(key, { location: info.location, sessionIDs: new Set([info.id]) });
  }
  const locations = [...groups.values()];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < locations.length) {
      const group = locations[index];
      index += 1;
      if (group === undefined) continue;
      try {
        const [permissions, questions] = await Promise.all([
          client.requests.permissions(group.location),
          client.requests.questions(group.location),
        ]);
        const bySession = new Map<string, string[]>();
        for (const sessionID of group.sessionIDs) bySession.set(sessionID, []);
        for (const request of [...permissions.data, ...questions.data]) {
          if (!group.sessionIDs.has(request.sessionID)) continue;
          bySession.get(request.sessionID)?.push(request.id);
        }
        for (const [sessionID, requestIDs] of bySession) requests.set(sessionID, requestIDs);
      } catch {
        // Preserve event-derived attention when one location cannot load its queues.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(REQUEST_CONCURRENCY, locations.length) }, () => worker()),
  );
  return requests;
}
