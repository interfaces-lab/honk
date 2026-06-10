import { describe, expect, it } from "vitest";
import type { ConversationDensity } from "@multi/contracts/settings";
import {
  normalizeConversationDensity,
  shouldGroupEdits,
  shouldGroupShells,
  shouldGroupToolCalls,
  shouldUseCompactEdits,
  shouldUseCompactShells,
} from "../src/conversation-density";

const DENSITY_CASES = [
  {
    density: "detailed",
    compactEdits: false,
    compactShells: false,
    groupEdits: false,
    groupShells: false,
  },
  {
    density: "compact-shells",
    compactEdits: false,
    compactShells: true,
    groupEdits: false,
    groupShells: false,
  },
  {
    density: "compact-ungrouped",
    compactEdits: true,
    compactShells: true,
    groupEdits: false,
    groupShells: false,
  },
  {
    density: "compact-grouped",
    compactEdits: true,
    compactShells: true,
    groupEdits: true,
    groupShells: true,
  },
  {
    density: "compact-all-grouped",
    compactEdits: true,
    compactShells: true,
    groupEdits: true,
    groupShells: true,
  },
] as const satisfies readonly {
  density: ConversationDensity;
  compactEdits: boolean;
  compactShells: boolean;
  groupEdits: boolean;
  groupShells: boolean;
}[];

describe("conversation density predicates", () => {
  it.each(DENSITY_CASES)(
    "matches Cursor behavior for $density",
    ({ density, compactEdits, compactShells, groupEdits, groupShells }) => {
      expect(shouldUseCompactEdits(density)).toBe(compactEdits);
      expect(shouldUseCompactShells(density)).toBe(compactShells);
      expect(shouldGroupEdits(density)).toBe(groupEdits);
      expect(shouldGroupShells(density)).toBe(groupShells);
      expect(shouldGroupToolCalls(density)).toBe(groupEdits);
    },
  );

  it("normalizes legacy density aliases", () => {
    expect(normalizeConversationDensity("verbose")).toBe("detailed");
    expect(normalizeConversationDensity("minimal")).toBe("compact-all-grouped");
    expect(normalizeConversationDensity("compact-shells")).toBe("compact-ungrouped");
    expect(normalizeConversationDensity("compact-grouped")).toBe("compact-all-grouped");
  });
});
