import { describe, expect, it } from "vitest";

import { loadPromptMenu } from "./prompt-menu-resource";

describe("composer prompt menu resource", () => {
  it("reuses one menu import", async () => {
    const first = loadPromptMenu();
    const second = loadPromptMenu();

    expect(second).toBe(first);
    expect((await first).PromptMenu).toBeTypeOf("function");
  });
});
