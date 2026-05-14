import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkbenchTabBar } from "./workbench-tabs";

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onTab = vi.fn();
  const onToggle = vi.fn();
  root.render(<WorkbenchTabBar active="git" count={2} onTab={onTab} onToggle={onToggle} />);
  await Promise.resolve();
  const cleanup = async () => {
    root.unmount();
    host.remove();
  };
  return {
    onTab,
    onToggle,
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("WorkbenchTabBar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the new tab menu and filters panel entries", async () => {
    await using harness = await mount();

    await page.getByLabelText("Open new tab menu").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Terminal");
      expect(page.getByPlaceholder("Open any file, URL, ...").element()).toBeTruthy();
    });

    await page.getByPlaceholder("Open any file, URL, ...").fill("file");

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("File");
      expect(document.body.textContent ?? "").not.toContain("Terminal");
    });

    await page.getByText("File").click();
    expect(harness.onTab).toHaveBeenCalledWith("files");
  });
});
