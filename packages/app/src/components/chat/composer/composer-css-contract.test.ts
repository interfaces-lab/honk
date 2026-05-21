import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const composerDir = resolve(__dirname);
const stylesDir = resolve(composerDir, "../../../styles");
const conversationCss = readFileSync(resolve(stylesDir, "conversation.css"), "utf8");
const inputSource = readFileSync(resolve(composerDir, "input.tsx"), "utf8");

describe("Composer CSS contract", () => {
  it("stores composer geometry in conversation.css vars", () => {
    expect(conversationCss).toContain("--multi-composer-new-agent-editor-min-height: 56px");
    expect(conversationCss).toContain(
      "--multi-composer-new-agent-editor-max-height: min(75vh, 420px)",
    );
    expect(conversationCss).toContain("--multi-composer-editor-min-height: 36px");
    expect(conversationCss).toContain("--multi-composer-editor-max-height: 200px");
  });

  it("wires geometry through input.tsx cva instead of composer-height buckets", () => {
    expect(existsSync(resolve(stylesDir, "composer.css"))).toBe(false);
    expect(existsSync(resolve(composerDir, "composer-height.ts"))).toBe(false);
    expect(inputSource).toContain("composerEditorClass");
    expect(inputSource).toContain("var(--multi-composer-new-agent-editor-min-height)");
    expect(inputSource).toContain("data-layout={layout}");
    expect(inputSource).not.toMatch(/composer-height|HERO_COMPOSER_|!min-h-|!max-h-/);
  });
});
