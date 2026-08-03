import { describe, expect, it } from "vitest";

import {
  appendTerminalOutput,
  createTerminalOutputBuffer,
  readTerminalOutput,
} from "./desktop-pty-buffer";

describe("terminal output buffer", () => {
  it("keeps every chunk while the job stays under the cap", () => {
    const buffer = createTerminalOutputBuffer();

    appendTerminalOutput(buffer, "listening on ");
    appendTerminalOutput(buffer, "http://localhost:3000\n");

    expect(readTerminalOutput(buffer)).toBe("listening on http://localhost:3000\n");
  });

  it("drops the oldest output once a long-running job exceeds the cap", () => {
    const buffer = createTerminalOutputBuffer();
    // A dev server logs for hours; only the tail is worth keeping.
    for (let index = 0; index < 40; index += 1) {
      appendTerminalOutput(buffer, `${String(index)}:`.padEnd(10_000, "."));
    }
    const history = readTerminalOutput(buffer);

    expect(history.length).toBeLessThanOrEqual(200_000);
    expect(history.startsWith("0:")).toBe(false);
    expect(history).toContain("39:");
  });

  it("returns only the requested tail so a status poll stays bounded", () => {
    const buffer = createTerminalOutputBuffer();
    appendTerminalOutput(buffer, "old".repeat(100));
    appendTerminalOutput(buffer, "newest");

    expect(readTerminalOutput(buffer, 6)).toBe("newest");
  });

  it("keeps a single oversized chunk rather than emptying the buffer", () => {
    const buffer = createTerminalOutputBuffer();
    appendTerminalOutput(buffer, "x".repeat(250_000));

    expect(readTerminalOutput(buffer).length).toBe(200_000);
  });
});
