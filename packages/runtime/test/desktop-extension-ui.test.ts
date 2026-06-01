import { afterEach, describe, expect, it } from "vitest";
import { createDesktopExtensionUi } from "../src/extension-ui";
import { createRuntimeHarness, type RuntimeHarness } from "./runtime-test-harness";

describe("desktop extension UI", () => {
  const harnesses: RuntimeHarness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });

  it("captures Pi extension UI requests for desktop resolution", async () => {
    let answerPromise: Promise<string | undefined> | undefined;
    const harness = await createRuntimeHarness({
      extensionFactories: [
        (pi) => {
          pi.on("session_start", (_event, ctx) => {
            answerPromise = ctx.ui.input("Question", "answer here");
          });
        },
      ],
    });
    harnesses.push(harness);
    const ui = createDesktopExtensionUi();

    await harness.runtime.bindExtensions(ui);

    const request = ui.pendingRequests[0];
    expect(request).toMatchObject({
      kind: "input",
      title: "Question",
      placeholder: "answer here",
    });
    expect(request).toBeDefined();
    ui.resolveRequest(request!.id, "resolved answer");

    await expect(answerPromise).resolves.toBe("resolved answer");
    expect(ui.pendingRequests).toHaveLength(0);
  });

  it("records extension notifications and status text without Pi TUI imports", async () => {
    const ui = createDesktopExtensionUi();

    ui.context.notify("Heads up", "warning");
    ui.context.setStatus("agent", "Working");
    ui.context.setToolsExpanded(true);

    expect(ui.notificationLog).toEqual([{ message: "Heads up", type: "warning" }]);
    expect(ui.getStatus("agent")).toBe("Working");
    expect(ui.context.getToolsExpanded()).toBe(true);
  });
});
