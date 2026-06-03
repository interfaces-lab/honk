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

  it("notifies when pending extension UI requests change", async () => {
    const ui = createDesktopExtensionUi();
    const pendingCounts: number[] = [];
    const unsubscribe = ui.onPendingRequestsChanged(() => {
      pendingCounts.push(ui.pendingRequests.length);
    });

    const answerPromise = ui.context.input("Question", "answer here");
    const request = ui.pendingRequests[0];

    expect(request).toBeDefined();
    ui.resolveRequest(request!.id, "resolved answer");

    await expect(answerPromise).resolves.toBe("resolved answer");
    unsubscribe();
    expect(pendingCounts).toEqual([1, 0]);
  });

  it("rejects pending requests and does not enqueue new requests after dispose", async () => {
    const ui = createDesktopExtensionUi();
    const answerPromise = ui.context.input("Question", "answer here");

    expect(ui.pendingRequests).toHaveLength(1);
    ui.dispose();

    await expect(answerPromise).rejects.toThrow("Desktop extension UI session disposed.");
    expect(ui.pendingRequests).toHaveLength(0);
    await expect(ui.context.input("After dispose", "answer here")).resolves.toBeUndefined();
    expect(ui.pendingRequests).toHaveLength(0);
  });
});
