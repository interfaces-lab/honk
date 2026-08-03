import type { OpenCodeServerDescriptor } from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import type { TabDescriptor } from "@honk/ui";

import {
  openCodeSessionTabKey,
  openCodeTabKey,
  openCodeTabSessionRef,
  type OpenCodeTabState,
} from "./tab-model";

const OPEN_CODE_HOME_TAB_KEY = "home";

type OpenCodeThreadDescriptor = Extract<TabDescriptor, { readonly kind: "thread" }>;
type OpenCodeHomeDescriptor = Extract<TabDescriptor, { readonly kind: "home" }>;
type OpenCodeTabDescriptor = OpenCodeHomeDescriptor | OpenCodeThreadDescriptor;
type OpenCodeTabStatus = OpenCodeThreadDescriptor["status"];

type OpenCodeTabPresentation = {
  readonly title?: string;
  readonly status?: OpenCodeTabStatus;
  readonly repository?: OpenCodeThreadDescriptor["repository"];
};

type OpenCodeTabPresentations = Readonly<Record<string, OpenCodeTabPresentation>>;

function openCodeTabDescriptors(input: {
  readonly state: OpenCodeTabState;
  readonly servers: readonly OpenCodeServerDescriptor[];
  readonly presentations?: OpenCodeTabPresentations;
  // Server home directories by server key. The tab preview abbreviates paths with ~.
  readonly homes?: Readonly<Record<string, string>>;
}): readonly OpenCodeTabDescriptor[] {
  const serverByKey = new Map(input.servers.map((server) => [server.key, server]));
  const showServer = input.servers.length > 1;
  const tabs: OpenCodeThreadDescriptor[] = input.state.tabs.map((tab) => {
    const key = openCodeTabKey(tab);
    const presentation = input.presentations?.[key];
    const server = showServer ? serverByKey.get(tab.server) : undefined;
    const homePath = input.homes?.[tab.server];
    const owner = openCodeTabSessionRef(tab);
    const info = input.state.info[owner === null ? key : openCodeSessionTabKey(owner)];
    const directory = tab.type === "draft" ? tab.location.directory : info?.directory;
    const repository =
      presentation?.repository ??
      (directory === undefined
        ? ({ state: "loading" } as const)
        : ({ state: "ready", label: basename(directory) } as const));

    return Object.freeze({
      key,
      title:
        presentation?.title ??
        (tab.type === "draft" ? "New session" : (info?.title ?? "Loading session")),
      kind: "thread",
      status: presentation?.status ?? (tab.type === "draft" ? "draft" : "idle"),
      repository,
      ...(directory === undefined ? {} : { path: directory }),
      ...(homePath === undefined ? {} : { homePath }),
      ...(server === undefined
        ? {}
        : {
            server: {
              label: server.label,
              kind: server.kind,
            },
          }),
    });
  });
  return Object.freeze([
    Object.freeze({
      key: OPEN_CODE_HOME_TAB_KEY,
      title: "Home",
      kind: "home",
      status: "idle",
    }),
    ...tabs,
  ]);
}

export { OPEN_CODE_HOME_TAB_KEY, openCodeTabDescriptors };
export type {
  OpenCodeTabDescriptor,
  OpenCodeTabPresentation,
  OpenCodeTabPresentations,
  OpenCodeTabStatus,
};
