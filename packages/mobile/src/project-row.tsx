import * as React from "react";
import { router, type Href } from "expo-router";
import { ListRow } from "@honk/ui";

import type { MobileProject } from "./projects";
import { DetailText } from "./ui";

export function ProjectRow({
  href,
  project,
}: {
  readonly href: Href;
  readonly project: MobileProject;
}): React.ReactElement {
  const activeCount = project.sessions.filter(
    (session) =>
      session.status === "running" || session.needsAttention || session.status === "failed",
  ).length;

  return (
    <ListRow
      accessibilityLabel={`${project.title}, ${project.sessions.length} sessions`}
      onClick={() => router.push(href)}
    >
      <ListRow.Content>
        <ListRow.Title>{project.title}</ListRow.Title>
        <ListRow.Description>
          {activeCount > 0
            ? `${activeCount} active · ${project.path ?? "No project folder"}`
            : `${project.serverLabel} · ${project.path}`}
        </ListRow.Description>
      </ListRow.Content>
      <ListRow.Meta>
        <DetailText>{project.sessions.length}</DetailText>
      </ListRow.Meta>
    </ListRow>
  );
}
