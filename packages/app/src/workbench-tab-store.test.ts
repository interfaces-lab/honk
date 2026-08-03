import { createOpenCodeServer, openCodeSessionRef } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  browserTabID,
  createWorkbenchTabStore,
  fileTabID,
  terminalTabID,
} from "./workbench-tab-store";

const server = createOpenCodeServer({ origin: "http://127.0.0.1:4096", kind: "local" });
const ownerA = openCodeSessionRef(server.key, "ses_a");
const ownerB = openCodeSessionRef(server.key, "ses_b");

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${String(index)}`;
}

describe("workspace workbench tabs", () => {
  it("makes a detected plan tab available without opening the workbench", () => {
    const store = createWorkbenchTabStore();

    const planTab = store.actions.ensureTool("workspace", "tasks", ownerA);

    expect(planTab).toMatchObject({ id: "tasks", kind: "tasks", owner: ownerA });
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [planTab],
      activeTabID: null,
      expanded: false,
    });

    const changes = store.actions.openTool("workspace", "changes", ownerA);
    store.actions.ensureTool("workspace", "tasks", ownerB);
    expect(store.getWorkspace("workspace")).toMatchObject({
      activeTabID: changes.id,
      expanded: true,
    });
    expect(store.getWorkspace("workspace").tabs).toContainEqual({
      id: "tasks",
      kind: "tasks",
      owner: ownerB,
    });
  });

  it("owns two same-kind terminal and browser resources independently", () => {
    const store = createWorkbenchTabStore({
      createID: ids("terminal-1", "terminal-2", "browser-1", "browser-2"),
    });

    const firstTerminal = store.actions.openTool("workspace", "terminal", ownerA);
    const secondTerminal = store.actions.openTool("workspace", "terminal", ownerA, {
      newInstance: true,
    });
    const firstBrowser = store.actions.openTool("workspace", "browser", ownerA);
    const secondBrowser = store.actions.openTool("workspace", "browser", ownerA, {
      newInstance: true,
    });

    expect([firstTerminal, secondTerminal]).toMatchObject([
      { kind: "terminal", terminalID: "terminal-1" },
      { kind: "terminal", terminalID: "terminal-2" },
    ]);
    expect([firstBrowser, secondBrowser]).toMatchObject([
      { kind: "browser", browserID: "browser-1", owner: ownerA },
      { kind: "browser", browserID: "browser-2", owner: ownerA },
    ]);
    expect(new Set(store.getWorkspace("workspace").tabs.map((tab) => tab.id)).size).toBe(4);
  });

  it("reuses a workspace browser across parent switches and creates new instances explicitly", () => {
    const store = createWorkbenchTabStore({ createID: ids("browser-a", "browser-b") });

    const first = store.actions.openTool("workspace", "browser", ownerA);
    const reused = store.actions.openTool("workspace", "browser", ownerB);
    const second = store.actions.openTool("workspace", "browser", ownerB, {
      newInstance: true,
    });

    expect(reused).toBe(first);
    expect(first).toMatchObject({ kind: "browser", owner: ownerA, browserID: "browser-a" });
    expect(second).toMatchObject({ kind: "browser", owner: ownerB, browserID: "browser-b" });
    expect(store.getWorkspace("workspace").tabs).toHaveLength(2);
  });

  it("normalizes the reserved automation browser away from a workbench deep link", () => {
    const store = createWorkbenchTabStore({ createID: ids("browser-workbench") });

    const browser = store.actions.ensureRoute(
      "workspace",
      { type: "tab", tabID: browserTabID(ownerA, "default") },
      ownerA,
    );

    expect(browser).toMatchObject({
      id: browserTabID(ownerA, "browser-workbench"),
      kind: "browser",
      owner: ownerA,
      browserID: "browser-workbench",
    });
  });

  // An agent-started background job names its own terminal, and the tab must bind to
  // that exact id so attaching finds the job main is already running.
  it("opens a terminal tab on a supplied terminal ID instead of minting one", () => {
    const store = createWorkbenchTabStore({ createID: ids("unused") });
    const tabID = terminalTabID("agent-job-1");

    const opened = store.actions.ensureRoute("workspace", { type: "tab", tabID }, ownerA);
    const reopened = store.actions.ensureRoute("workspace", { type: "tab", tabID }, ownerB);

    expect(opened).toMatchObject({ id: tabID, kind: "terminal", terminalID: "agent-job-1" });
    expect(reopened).toBe(opened);
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [opened],
      activeTabID: tabID,
      expanded: true,
    });
  });

  it("selects the nearest remaining tab when the active tab closes", () => {
    const store = createWorkbenchTabStore({
      createID: ids("second", "third"),
    });
    const first = store.actions.openTool("workspace", "terminal", ownerA);
    const second = store.actions.openTool("workspace", "terminal", ownerA, {
      newInstance: true,
    });
    const third = store.actions.openTool("workspace", "browser", ownerA);

    store.actions.activate("workspace", second.id);
    expect(store.actions.close("workspace", second.id).activeTabID).toBe(third.id);
    expect(store.actions.close("workspace", third.id).activeTabID).toBe(first.id);
  });

  it("retains one workspace inventory while parent ownership changes", () => {
    const store = createWorkbenchTabStore();
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);
    const changesA = store.actions.openTool("workspace", "changes", ownerA);
    const changesB = store.actions.ensureRoute(
      "workspace",
      { type: "tab", tabID: "changes" },
      ownerB,
    );

    expect(changesB).toMatchObject({ id: changesA.id, owner: ownerB });
    expect(store.getWorkspace("workspace").tabs).toContainEqual(terminal);
    expect(store.getWorkspace("workspace").tabs).toHaveLength(2);
  });

  it("keeps the shell inventory available when a cold route has not added a tab", () => {
    const store = createWorkbenchTabStore();
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);

    expect(store.getWorkspace("workspace").tabs).toEqual([terminal]);
    expect(store.getWorkspace("workspace").activeTabID).toBe(terminal.id);
    expect(store.getWorkspace("unknown").tabs).toEqual([]);
    expect(store.getWorkspace("workspace").tabs).toEqual([terminal]);
  });

  it("treats an absent route as a no-op and explicit collapse as chrome state only", () => {
    const store = createWorkbenchTabStore();
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);

    expect(store.getWorkspace("workspace")).toMatchObject({
      activeTabID: terminal.id,
      expanded: true,
    });
    store.actions.setExpanded("workspace", false);
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [terminal],
      activeTabID: terminal.id,
      expanded: false,
    });
  });

  it("opens an empty shell without creating or activating a tool", () => {
    const store = createWorkbenchTabStore();

    const opened = store.actions.ensureRoute("workspace", { type: "start" }, ownerA);

    expect(opened).toBeNull();
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [],
      activeTabID: null,
      expanded: true,
    });
  });

  it("keeps a closed Side Chat discoverable and reopens the same child", () => {
    const store = createWorkbenchTabStore();
    const child = openCodeSessionRef(server.key, "ses_child");
    const sideChat = store.actions.openSideChat("workspace", ownerA, child, "Research");

    store.actions.close("workspace", sideChat.id);
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [],
      sideChats: [sideChat],
      activeTabID: null,
      expanded: false,
    });

    const reopened = store.actions.openSideChat("workspace", ownerA, child, "Ignored rename");
    expect(reopened).toBe(sideChat);
    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [sideChat],
      sideChats: [sideChat],
      activeTabID: sideChat.id,
      expanded: true,
    });
  });

  it("opens one viewer tab per path and reactivates an already-open file", () => {
    const store = createWorkbenchTabStore();

    const first = store.actions.openFile("workspace", "src/one.ts");
    const second = store.actions.openFile("workspace", "src/two.ts");
    store.actions.openTool("workspace", "changes", ownerA);
    const reopened = store.actions.openFile("workspace", "src/one.ts");

    expect(reopened).toBe(first);
    expect([first, second]).toMatchObject([
      { kind: "file", filePath: "src/one.ts" },
      { kind: "file", filePath: "src/two.ts" },
    ]);
    expect(store.getWorkspace("workspace").tabs).toHaveLength(3);
    expect(store.getWorkspace("workspace")).toMatchObject({
      activeTabID: first.id,
      expanded: true,
    });
  });

  // A Windows sidecar lists `src\one.ts`; the same file reached through a deep link is `src/one.ts`.
  it("collapses separator variants of one path onto a single tab", () => {
    const store = createWorkbenchTabStore();

    const opened = store.actions.openFile("workspace", "src\\one.ts");
    const reopened = store.actions.openFile("workspace", "src/one.ts");

    expect(opened.filePath).toBe("src/one.ts");
    expect(reopened).toBe(opened);
    expect(store.getWorkspace("workspace").tabs).toHaveLength(1);
  });

  it("restores a file tab from its persisted workbench route", () => {
    const store = createWorkbenchTabStore();
    const tabID = fileTabID("src/nested dir/one.ts");

    const restored = store.actions.ensureRoute("workspace", { type: "tab", tabID }, ownerA);

    expect(restored).toMatchObject({ id: tabID, kind: "file", filePath: "src/nested dir/one.ts" });
    expect(store.getWorkspace("workspace")).toMatchObject({
      activeTabID: tabID,
      expanded: true,
    });
  });

  it("falls back to Changes for a malformed file route instead of an empty viewer", () => {
    const store = createWorkbenchTabStore();

    const fallback = store.actions.ensureRoute(
      "workspace",
      { type: "tab", tabID: "file:not/valid/base64url" },
      ownerA,
    );

    expect(fallback).toMatchObject({ id: "changes", kind: "changes" });
  });

  it("remembers a delayed Side Chat without stealing the active tab", () => {
    const store = createWorkbenchTabStore({ createID: ids("terminal") });
    const terminal = store.actions.openTool("workspace", "terminal", ownerA);
    const child = openCodeSessionRef(server.key, "ses_delayed_child");

    const sideChat = store.actions.rememberSideChat("workspace", ownerA, child, "Delayed");

    expect(store.getWorkspace("workspace")).toMatchObject({
      tabs: [terminal],
      sideChats: [sideChat],
      activeTabID: terminal.id,
      expanded: true,
    });
  });
});
