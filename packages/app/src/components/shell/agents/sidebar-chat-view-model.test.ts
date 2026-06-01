import { EnvironmentId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import type { SidebarDraftSummary } from "./sidebar/types";
import { buildProjectChatSections } from "./sidebar/view-model";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function draftTitleFor(text: string): string {
  const draft: SidebarDraftSummary = {
    id: "draft-1",
    text,
    attachmentCount: 0,
    firstAttachmentName: null,
    cwd: "/repo/project",
    environmentId: ENVIRONMENT_ID,
    projectId: null,
    projectCwd: "/repo/project",
    updatedAt: "2026-04-29T12:00:00.000Z",
  };

  return buildProjectChatSections([], [draft], "/repo/project", "/Users/workgyver")[0]?.items[0]
    ?.title ?? "";
}

describe("buildProjectChatSections draft titles", () => {
  it("compacts serialized skill markdown before rendering the draft title", () => {
    expect(
      draftTitleFor("[$grill-me](/Users/workgyver/.agents/skills/grill-me/SKILL.md) inspect this"),
    ).toBe("$grill-me inspect this");
  });

  it("shows a compact skill token for a skill-only draft", () => {
    expect(draftTitleFor("[$imagegen](/Users/workgyver/.codex/skills/imagegen/SKILL.md) ")).toBe(
      "$imagegen",
    );
  });
});
