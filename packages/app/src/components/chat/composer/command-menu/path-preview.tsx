import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Tree, useTreeModel } from "../../../tree";
import { previewPathFullDirectory, splitPathStaircase } from "./preview-path";

const PREVIEW_PANEL_WIDTH_PX = 320;
/** Side gap (ml-1.5/mr-1.5 = 6px) plus slack between the popup edge and the panel. */
const PREVIEW_PANEL_GAP_PX = 16;
const PREVIEW_VIEWPORT_PADDING_PX = 8;
const PREVIEW_TREE_ROW_HEIGHT_PX = 22;
const PREVIEW_TREE_MAX_HEIGHT_PX = 300;

type ComposerPathPreviewSide = "right" | "left" | "hidden";

/**
 * Side class sets are swapped wholesale (never combined): `right` places the
 * panel at the menu popup's right edge, `left` is the flipped placement, and
 * `hidden` removes it when neither side fits the viewport.
 */
const PREVIEW_SIDE_CLASSES: Record<ComposerPathPreviewSide, string> = {
  right: "left-full ml-1.5",
  left: "right-full mr-1.5",
  hidden: "hidden",
};

function resolvePreviewSide(popupRect: DOMRect): ComposerPathPreviewSide {
  const viewportWidth = document.documentElement.clientWidth;
  if (
    popupRect.right + PREVIEW_PANEL_WIDTH_PX + PREVIEW_PANEL_GAP_PX <=
    viewportWidth - PREVIEW_VIEWPORT_PADDING_PX
  ) {
    return "right";
  }
  if (
    popupRect.left - PREVIEW_PANEL_WIDTH_PX - PREVIEW_PANEL_GAP_PX >
    PREVIEW_VIEWPORT_PADDING_PX
  ) {
    return "left";
  }
  return "hidden";
}

/**
 * Pierre-tree staircase preview for the `@` menu's active path item.
 *
 * Mount as a sibling of the menu shell inside the popup that carries
 * `[data-composer-command-menu-root]`: placement walks up to that popup to
 * measure which side fits, and the same ancestor keeps pointer events on the
 * panel exempt from the composer menu's outside-pointer dismissal.
 *
 * Display-only: the root keeps pointer-events auto + preventDefault on
 * mousedown (clicks must neither move focus out of the Lexical editor nor
 * fall through to UI behind), while the content is `pointer-events-none`.
 */
export function ComposerPathPreviewPanel(props: {
  open: boolean;
  path: string | null;
  pathKind: "file" | "directory" | null;
  resolvedTheme: "light" | "dark";
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [side, setSide] = useState<ComposerPathPreviewSide>("right");

  const staircase =
    props.path !== null ? splitPathStaircase(props.path, props.pathKind ?? "file") : null;
  const suffixPath = staircase !== null && staircase.rowCount > 0 ? staircase.suffixPath : null;
  const visible = props.open && suffixPath !== null;

  const { model } = useTreeModel({
    paths: suffixPath !== null ? [suffixPath] : [],
    flattenEmptyDirectories: false,
    initialExpansion: "open",
    search: false,
    initialSelectedPaths: suffixPath !== null ? [suffixPath] : [],
  });

  // useTreeModel captures construction options only; sync later path changes
  // imperatively (same pattern as git-changes-file-tree.tsx). resetPaths
  // re-applies initialExpansion "open"; selection is re-pinned to the leaf.
  useLayoutEffect(() => {
    if (suffixPath === null) {
      return;
    }
    model.resetPaths([suffixPath]);
    for (const selectedPath of model.getSelectedPaths()) {
      if (selectedPath !== suffixPath) {
        model.getItem(selectedPath)?.deselect();
      }
    }
    const leaf = model.getItem(suffixPath);
    if (leaf && !leaf.isSelected()) {
      leaf.select();
    }
  }, [model, suffixPath]);

  // Flip logic: measure the menu popup rect against the viewport once per
  // open/path change and whenever Base UI repositions it. The positioner is
  // the popup's parent element (Portal > Positioner > Popup, see
  // packages/honkkit/src/popover.tsx); Base UI writes its position into the
  // positioner's style attribute, so a MutationObserver on that attribute
  // mirrors the caret-span observer pattern in input.tsx.
  useLayoutEffect(() => {
    if (!visible) {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const popup = panel.closest<HTMLElement>("[data-composer-command-menu-root]");
    if (!popup) {
      return;
    }
    const measure = () => {
      const next = resolvePreviewSide(popup.getBoundingClientRect());
      // Equality-gated: returning the identical value bails out of re-render.
      setSide((current) => (current === next ? current : next));
    };
    measure();
    const positioner = popup.parentElement;
    if (positioner === null || typeof MutationObserver === "undefined") {
      return;
    }
    const observer = new MutationObserver(measure);
    observer.observe(positioner, { attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
    };
  }, [visible, props.path]);

  if (!visible || staircase === null) {
    return null;
  }

  const treeHeightPx = Math.min(
    staircase.rowCount * PREVIEW_TREE_ROW_HEIGHT_PX + 8,
    PREVIEW_TREE_MAX_HEIGHT_PX,
  );
  const fullDirectoryPath = props.path !== null ? previewPathFullDirectory(props.path) : null;

  return (
    <div
      ref={panelRef}
      aria-hidden
      data-composer-menu-preview=""
      data-variant="surface"
      className={cn(
        "pointer-events-auto absolute bottom-0 max-h-[342px] w-[320px] overflow-hidden rounded-lg border border-honk-stroke-secondary bg-(--honk-composer-popup-surface-background) shadow-honk-popup",
        PREVIEW_SIDE_CLASSES[side],
      )}
      onMouseDown={(event) => {
        // Keep focus in the Lexical editor (menu rows do the same).
        event.preventDefault();
      }}
    >
      <div className="pointer-events-none py-1">
        {staircase.collapsedPrefix !== null ? (
          <div
            className="truncate px-2 pb-1 text-detail text-honk-fg-tertiary"
            title={fullDirectoryPath ?? undefined}
          >
            {staircase.collapsedPrefix}
          </div>
        ) : null}
        {/* The pierre host fills its parent; it needs a real pixel height. */}
        <div style={{ height: treeHeightPx }}>
          <Tree
            model={model}
            resolvedTheme={props.resolvedTheme}
            style={{
              "--trees-bg-override": "transparent",
              "--trees-selected-bg-override": "var(--honk-bg-quaternary)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
