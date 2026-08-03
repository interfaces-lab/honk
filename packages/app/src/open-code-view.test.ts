import { describe, expect, it } from "vitest";

import { promptFilesFromPaths } from "./open-code-view";

describe("prompt file boundary", () => {
  it("forwards source ranges for mentions while dropping composer-only context metadata", () => {
    expect(
      promptFilesFromPaths([
        {
          path: "docs/handbook.md",
          filename: "handbook.md",
          mime: "text/markdown",
          source: { text: "@docs/handbook.md", start: 4, end: 21 },
        },
        {
          path: "data:text/plain,chat",
          filename: "Past chat",
          mime: "text/plain",
          context: { kind: "chat", sourceKey: "chat:one" },
        },
      ]),
    ).toEqual([
      {
        uri: "docs/handbook.md",
        name: "handbook.md",
        description: "text/markdown",
        source: { text: "@docs/handbook.md", start: 4, end: 21 },
      },
      {
        uri: "data:text/plain,chat",
        name: "Past chat",
        description: "text/plain",
      },
    ]);
  });
});
