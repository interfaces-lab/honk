import { createOpenCodeServer, openCodeLocationRef, openCodeSessionRef } from "@honk/opencode";
import { describe, expect, it } from "vitest";

import {
  addOpenCodeDraftTab,
  addOpenCodeSessionTab,
  createOpenCodeTabState,
  openCodeTabKey,
  rememberOpenCodeSessionInfo,
} from "./tab-model";
import { OPEN_CODE_HOME_TAB_KEY, openCodeTabDescriptors } from "./tab-presentation";

const local = createOpenCodeServer({
  origin: "http://127.0.0.1:4096",
  label: "This Mac",
  kind: "local",
});
const cloud = createOpenCodeServer({
  origin: "https://cloud.example.test",
  label: "Cloud",
  kind: "cloud",
});

describe("OpenCode tab descriptors", () => {
  it("pins Home, disambiguates servers, and carries needs-you to the yellow matrix status", () => {
    const localRef = openCodeSessionRef(local.key, "ses_local");
    const cloudRef = openCodeSessionRef(cloud.key, "ses_cloud");
    let state = createOpenCodeTabState();
    state = addOpenCodeSessionTab(state, localRef);
    state = rememberOpenCodeSessionInfo(state, localRef, {
      title: "Fix the build",
      location: { directory: "/Users/me/honk" },
    });
    state = addOpenCodeSessionTab(state, cloudRef);
    state = rememberOpenCodeSessionInfo(state, cloudRef, {
      title: "Ship docs",
      location: { directory: "/workspace/docs" },
    });
    state = addOpenCodeDraftTab(state, {
      draftID: "draft-1",
      server: cloud.key,
      location: openCodeLocationRef({ directory: "/workspace/new" }),
    });
    const cloudTab = state.tabs[1];
    if (cloudTab === undefined) throw new Error("Expected the cloud tab.");
    const cloudKey = openCodeTabKey(cloudTab);

    const descriptors = openCodeTabDescriptors({
      state,
      servers: [local, cloud],
      presentations: {
        [cloudKey]: { status: "needs-you" },
      },
    });

    expect(descriptors[0]).toEqual({
      key: OPEN_CODE_HOME_TAB_KEY,
      title: "Home",
      kind: "home",
      status: "idle",
    });
    expect(descriptors[1]).toMatchObject({
      title: "Fix the build",
      status: "idle",
      repository: { state: "ready", label: "honk" },
      path: "/Users/me/honk",
      server: { label: "This Mac", kind: "local" },
    });
    expect(descriptors[2]).toMatchObject({
      title: "Ship docs",
      status: "needs-you",
      repository: { state: "ready", label: "docs" },
      path: "/workspace/docs",
      server: { label: "Cloud", kind: "cloud" },
    });
    expect(descriptors[3]).toMatchObject({
      title: "New session",
      status: "draft",
      repository: { state: "ready", label: "new" },
    });
  });

  it("omits redundant server labels for a single connected instance", () => {
    const ref = openCodeSessionRef(local.key, "ses_local");
    const state = addOpenCodeSessionTab(createOpenCodeTabState(), ref);
    const descriptors = openCodeTabDescriptors({ state, servers: [local] });
    expect(descriptors[1]).not.toHaveProperty("server");
  });
});
