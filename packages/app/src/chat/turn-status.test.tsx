import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatWorkedFor, settledLabel, tickerText, TurnStatus } from "./turn-status";

describe("ticker text", () => {
  it("names each ticker state, holding the window while prose streams", () => {
    expect(tickerText({ kind: "planning" })).toBe("Planning next move");
    expect(tickerText({ kind: "step", name: "bash", detail: "pnpm vitest run" })).toBe(
      "bash pnpm vitest run",
    );
    expect(tickerText({ kind: "step", name: "todo_write", detail: null })).toBe("todo_write");
    expect(tickerText({ kind: "rollup", count: 3 })).toBe("Read 3 files");
    // Writing streams outside the window; idle has nothing to say. Both hold.
    expect(tickerText({ kind: "writing" })).toBeNull();
    expect(tickerText({ kind: "idle" })).toBeNull();
  });
});

describe("settled label", () => {
  it("formats the worked-for clock in whole seconds", () => {
    expect(formatWorkedFor(4_000)).toBe("4s");
    expect(formatWorkedFor(42_499)).toBe("42s");
    expect(formatWorkedFor(60_000)).toBe("1m");
    expect(formatWorkedFor(316_000)).toBe("5m 16s");
  });

  it("only the label tells how the turn ended", () => {
    expect(settledLabel("done", 316_000)).toBe("Worked for 5m 16s");
    expect(settledLabel("done", null)).toBe("Done");
    expect(settledLabel("stopped", 10_000)).toBe("Stopped");
    expect(settledLabel("failed", 10_000)).toBe("Failed");
  });
});

describe("the status surface", () => {
  it("renders the running ticker as a live status region", () => {
    const html = renderToStaticMarkup(
      <TurnStatus phase="running" ticker={{ kind: "planning" }} outcome="done" durationMs={null} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Planning next move");
  });

  it("renders the settled header from outcome and duration", () => {
    const html = renderToStaticMarkup(
      <TurnStatus phase="settled" ticker={{ kind: "idle" }} outcome="done" durationMs={42_000} />,
    );
    expect(html).toContain("Worked for 42s");
  });

  it("a stopped turn settles to Stopped, not a duration", () => {
    const html = renderToStaticMarkup(
      <TurnStatus phase="settled" ticker={{ kind: "idle" }} outcome="stopped" durationMs={9_000} />,
    );
    expect(html).toContain("Stopped");
    expect(html).not.toContain("Worked for");
  });
});
