import { ContextMenu, Icon, type TabDescriptor } from "@honk/ui";
import { IconClipboard, IconCrossSmall, IconPlusSmall } from "@honk/ui/icons";
import * as React from "react";

import { errorMessage } from "./error-message";
import { actions as tabActions } from "./tab-store";
import { actions as toastActions } from "./toast-store";

function copyWorkspacePath(path: string): void {
  void navigator.clipboard.writeText(path).then(
    () => {
      toastActions.add({ type: "success", title: "Copied workspace path" });
    },
    (error: unknown) => {
      toastActions.add({
        type: "error",
        title: "Could not copy workspace path",
        description: errorMessage(error),
      });
    },
  );
}

function OpenTabContextMenu(props: {
  readonly tab: TabDescriptor;
  readonly children: React.ReactElement;
}): React.ReactElement {
  const hasPath = props.tab.kind !== "home" && props.tab.path !== undefined;
  const canClose = props.tab.kind !== "home";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={props.children} />
      <ContextMenu.Popup>
        <ContextMenu.Item
          onClick={() => {
            if (props.tab.kind === "home") {
              tabActions.openNew();
              return;
            }
            tabActions.openNewInWorkspace(props.tab.key);
          }}
        >
          <Icon icon={IconPlusSmall} size="sm" tone="muted" />
          New thread
        </ContextMenu.Item>
        {hasPath ? (
          <ContextMenu.Item
            onClick={() => {
              const path = props.tab.kind === "home" ? undefined : props.tab.path;
              if (path === undefined) {
                return;
              }
              copyWorkspacePath(path);
            }}
          >
            <Icon icon={IconClipboard} size="sm" tone="muted" />
            Copy workspace path
          </ContextMenu.Item>
        ) : null}
        {canClose ? (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item
              onClick={() => {
                tabActions.close(props.tab.key);
              }}
            >
              <Icon icon={IconCrossSmall} size="sm" tone="muted" />
              Close tab
            </ContextMenu.Item>
            {hasPath ? (
              <ContextMenu.Item
                onClick={() => {
                  tabActions.closeWorkspaceTabs(props.tab.key);
                }}
              >
                <Icon icon={IconCrossSmall} size="sm" tone="muted" />
                Close workspace tabs
              </ContextMenu.Item>
            ) : null}
          </>
        ) : null}
      </ContextMenu.Popup>
    </ContextMenu.Root>
  );
}

function WorkspaceContextMenu(props: {
  readonly tabKey: string;
  readonly path?: string;
  readonly children: React.ReactElement;
}): React.ReactElement {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={props.children} />
      <ContextMenu.Popup>
        <ContextMenu.Item
          onClick={() => {
            tabActions.openNewInWorkspace(props.tabKey);
          }}
        >
          <Icon icon={IconPlusSmall} size="sm" tone="muted" />
          New thread
        </ContextMenu.Item>
        {props.path === undefined ? null : (
          <ContextMenu.Item
            onClick={() => {
              if (props.path !== undefined) {
                copyWorkspacePath(props.path);
              }
            }}
          >
            <Icon icon={IconClipboard} size="sm" tone="muted" />
            Copy workspace path
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        <ContextMenu.Item
          onClick={() => {
            tabActions.closeWorkspaceTabs(props.tabKey);
          }}
        >
          <Icon icon={IconCrossSmall} size="sm" tone="muted" />
          Close workspace tabs
        </ContextMenu.Item>
      </ContextMenu.Popup>
    </ContextMenu.Root>
  );
}

export { OpenTabContextMenu, WorkspaceContextMenu };
