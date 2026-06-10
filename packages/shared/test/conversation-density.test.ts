import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  ConversationDensity,
  USER_CONVERSATION_DENSITY_VALUES,
} from "@multi/contracts/settings";
import {
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
    groupToolCalls: false,
  },
  {
    density: "compact-ungrouped",
    compactEdits: true,
    compactShells: true,
    groupEdits: false,
    groupShells: false,
    groupToolCalls: false,
  },
  {
    density: "compact-all-grouped",
    compactEdits: true,
    compactShells: true,
    groupEdits: true,
    groupShells: true,
    groupToolCalls: true,
  },
] as const satisfies readonly {
  density: ConversationDensity;
  compactEdits: boolean;
  compactShells: boolean;
  groupEdits: boolean;
  groupShells: boolean;
  groupToolCalls: boolean;
}[];

describe("conversation density predicates", () => {
  it("covers every canonical density", () => {
    expect(DENSITY_CASES.map(({ density }) => density)).toEqual([
      ...USER_CONVERSATION_DENSITY_VALUES,
    ]);
  });

  it.each(DENSITY_CASES)(
    "matches Cursor behavior for $density",
    ({ density, compactEdits, compactShells, groupEdits, groupShells, groupToolCalls }) => {
      expect(shouldUseCompactEdits(density)).toBe(compactEdits);
      expect(shouldUseCompactShells(density)).toBe(compactShells);
      expect(shouldGroupEdits(density)).toBe(groupEdits);
      expect(shouldGroupShells(density)).toBe(groupShells);
      expect(shouldGroupToolCalls(density)).toBe(groupToolCalls);
    },
  );
});

describe("conversation density schema migration", () => {
  const decode = Schema.decodeUnknownSync(ConversationDensity);
  const encode = Schema.encodeSync(ConversationDensity);

  it.each([
    ["verbose", "detailed"],
    ["compact-shells", "compact-ungrouped"],
    ["minimal", "compact-all-grouped"],
    ["compact-grouped", "compact-all-grouped"],
  ] as const)("migrates persisted %s to %s at decode", (legacy, canonical) => {
    expect(decode(legacy)).toBe(canonical);
  });

  it.each([...USER_CONVERSATION_DENSITY_VALUES])(
    "decodes and encodes canonical %s unchanged",
    (density) => {
      expect(decode(density)).toBe(density);
      expect(encode(density)).toBe(density);
    },
  );

  it("rejects unknown stored values", () => {
    expect(() => decode("ultra-dense")).toThrow();
  });
});
