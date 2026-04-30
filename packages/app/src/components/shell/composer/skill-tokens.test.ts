// @ts-nocheck
import { describe, expect, it } from "vitest";

import {
  applySkill,
  dropSkill,
  expandSkills,
  shiftSkills,
  snapSkillSelection,
  touchSkill,
} from "./skill-tokens";

describe("skill-tokens", () => {
  it("drops a tracked skill when the edit touches the token", () => {
    const prev = "/tailwind hello";
    const next = "/tailwXnd hello";
    const skills = [
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        start: 0,
        end: "/tailwind".length,
      },
    ];

    expect(shiftSkills(prev, next, skills)).toEqual([]);
  });

  it("shifts a tracked skill when text is inserted before it", () => {
    const prev = "/tailwind hello";
    const next = "Use /tailwind hello";
    const skills = [
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        start: 0,
        end: "/tailwind".length,
      },
    ];

    expect(shiftSkills(prev, next, skills)).toEqual([
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        start: 4,
        end: 4 + "/tailwind".length,
      },
    ]);
  });

  it("expands only explicitly tracked skills", () => {
    const text = "/tailwind build\n/plain text";
    const skills = [
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        start: 0,
        end: "/tailwind".length,
      },
      {
        id: "/Users/workgyver/.agents/skills/plain",
        name: "plain",
        start: "/tailwind build\n".length,
        end: "/tailwind build\n/plain".length,
      },
    ];

    expect(
      expandSkills(text, skills, [
        {
          id: "/Users/workgyver/.agents/skills/tailwind",
          name: "tailwind",
          description: "Tailwind CSS guidance",
          body: "Use Tailwind skill body.",
        },
      ]),
    ).toBe("Use Tailwind skill body. build\n/plain text");
  });

  it("adds a tracked skill when inserted from the slash menu", () => {
    expect(
      applySkill(
        "/tai",
        { query: "tai", start: 0, end: 4 },
        { id: "tailwind", name: "tailwind" },
        [],
      ),
    ).toEqual({
      value: "/tailwind ",
      cursor: 10,
      skills: [
        {
          id: "tailwind",
          name: "tailwind",
          start: 0,
          end: 9,
        },
      ],
    });
  });

  it("finds a token touched from the left or right edge", () => {
    expect(
      touchSkill(
        "/grill-me ",
        [
          {
            id: "grill-me",
            name: "grill-me",
            start: 0,
            end: 9,
          },
        ],
        9,
        "left",
      ),
    ).toEqual({
      id: "grill-me",
      name: "grill-me",
      start: 0,
      end: 9,
    });

    expect(
      touchSkill(
        "/grill-me ",
        [
          {
            id: "grill-me",
            name: "grill-me",
            start: 0,
            end: 9,
          },
        ],
        0,
        "right",
      ),
    ).toEqual({
      id: "grill-me",
      name: "grill-me",
      start: 0,
      end: 9,
    });
  });

  it("expands a selection that lands inside a tracked token", () => {
    expect(
      snapSkillSelection(
        "hello /grill-me world",
        [
          {
            id: "grill-me",
            name: "grill-me",
            start: 6,
            end: 15,
          },
        ],
        9,
        9,
      ),
    ).toEqual({ start: 6, end: 15 });
  });

  it("drops a tracked token and its trailing gap", () => {
    expect(
      dropSkill(
        "/tailwind hello",
        [
          {
            id: "tailwind",
            name: "tailwind",
            start: 0,
            end: 9,
          },
        ],
        {
          id: "tailwind",
          name: "tailwind",
          start: 0,
          end: 9,
        },
      ),
    ).toEqual({
      value: "hello",
      cursor: 0,
      skills: [],
    });
  });
});
