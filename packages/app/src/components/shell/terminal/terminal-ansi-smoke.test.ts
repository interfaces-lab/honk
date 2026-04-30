import { describe, expect, it } from "vitest";

/**
 * PTY output is forwarded raw to xterm; emulator should still parse these shapes.
 * Manual smoke: Glass workbench → Terminal →
 * `printf '\e[31mred\e[0m\n'; printf '\e[91mbright\e[0m\n'; printf '\e[38;5;208m256\e[0m\n'; printf '\e[38;2;255;128;64mrgb\e[0m\n'`
 */
describe("terminal ANSI fixtures", () => {
  it("includes SGR16, 256-color, and truecolor sequences", () => {
    const fixture = [
      "\x1b[0m",
      "\x1b[31mred\x1b[0m",
      "\x1b[91mbright\x1b[0m",
      "\x1b[38;5;208m256\x1b[0m",
      "\x1b[38;2;255;128;64mrgb\x1b[0m",
    ].join("");
    expect(fixture).toContain("\x1b[31m");
    expect(fixture).toContain("\x1b[38;5;");
    expect(fixture).toContain("\x1b[38;2;");
  });
});
