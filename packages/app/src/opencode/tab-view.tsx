"use client";

import type { OpenCodeServerDescriptor } from "@honk/opencode";
import { TabStrip } from "@honk/ui";
import * as React from "react";

import type { OpenCodeTabController } from "./tab-controller";
import { openCodeTabKey, type OpenCodeTabKey } from "./tab-model";
import {
  OPEN_CODE_HOME_TAB_KEY,
  openCodeTabDescriptors,
  type OpenCodeTabPresentations,
} from "./tab-presentation";
import type { OpenCodeWindowTabStore } from "./tab-store";

type OpenCodeTabStripProps = {
  readonly store: OpenCodeWindowTabStore;
  readonly controller: OpenCodeTabController;
  readonly servers: readonly OpenCodeServerDescriptor[];
  readonly presentations?: OpenCodeTabPresentations;
  readonly onNew: () => void;
};

function OpenCodeTabStrip(props: OpenCodeTabStripProps): React.ReactElement {
  const state = React.useSyncExternalStore(
    props.store.subscribe,
    props.store.getSnapshot,
    props.store.getSnapshot,
  );
  const tabs = openCodeTabDescriptors({
    state,
    servers: props.servers,
    ...(props.presentations === undefined ? {} : { presentations: props.presentations }),
  });

  const resolveKey = (key: string): OpenCodeTabKey | null => {
    const tab = state.tabs.find((candidate) => openCodeTabKey(candidate) === key);
    return tab === undefined ? null : openCodeTabKey(tab);
  };

  const activate = (key: string): void => {
    if (key === OPEN_CODE_HOME_TAB_KEY) {
      props.controller.actions.showHome();
      return;
    }
    const resolved = resolveKey(key);
    if (resolved !== null) props.controller.actions.activate(resolved);
  };

  const close = (key: string): void => {
    const resolved = resolveKey(key);
    if (resolved !== null) props.controller.actions.close(resolved);
  };

  return (
    <TabStrip
      tabs={tabs}
      activeKey={state.activeKey ?? OPEN_CODE_HOME_TAB_KEY}
      onActivate={activate}
      onClose={close}
      onReorder={props.controller.actions.reorder}
      onNew={props.onNew}
    />
  );
}

export { OpenCodeTabStrip };
export type { OpenCodeTabStripProps };
