import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { Tree, useTreeModel } from "../../../tree";
import { previewPathFullDirectory, splitPathStaircase } from "./preview-path";

const PREVIEW_PANEL_WIDTH_PX = 320;
const PREVIEW_PANEL_VISUAL_GAP_PX = 6;
/** Visual gap plus slack between the popup edge and the panel. */
const PREVIEW_PANEL_FIT_GAP_PX = 16;
const PREVIEW_VIEWPORT_PADDING_PX = 8;
const PREVIEW_TREE_ROW_HEIGHT_PX = 22;
const PREVIEW_TREE_MAX_HEIGHT_PX = 300;

type ComposerPathPreviewSide = "right" | "left" | "hidden";
type ComposerPathPreviewPlacement = {
  side: ComposerPathPreviewSide;
  left: number;
  top: number;
};

const HIDDEN_PREVIEW_PLACEMENT: ComposerPathPreviewPlacement = {
  side: "hidden",
  left: 0,
  top: 0,
};

function resolvePreviewSide(popupRect: DOMRect): ComposerPathPreviewSide {
  const viewportWidth = document.documentElement.clientWidth;
  if (
    popupRect.right + PREVIEW_PANEL_WIDTH_PX + PREVIEW_PANEL_FIT_GAP_PX <=
    viewportWidth - PREVIEW_VIEWPORT_PADDING_PX
  ) {
    return "right";
  }
  if (
    popupRect.left - PREVIEW_PANEL_WIDTH_PX - PREVIEW_PANEL_FIT_GAP_PX >
    PREVIEW_VIEWPORT_PADDING_PX
  ) {
    return "left";
  }
  return "hidden";
}

function resolvePreviewPlacement(
  popupRect: DOMRect,
  activeItemRect: DOMRect | null,
  containingBlockRect: DOMRect,
): ComposerPathPreviewPlacement {
  const side = resolvePreviewSide(popupRect);
  if (side === "hidden") {
    return HIDDEN_PREVIEW_PLACEMENT;
  }
  const left =
    side === "right"
      ? popupRect.right - containingBlockRect.left + PREVIEW_PANEL_VISUAL_GAP_PX
      : popupRect.left -
        containingBlockRect.left -
        PREVIEW_PANEL_WIDTH_PX -
        PREVIEW_PANEL_VISUAL_GAP_PX;
  return {
    side,
    left: Math.round(left),
    top: Math.round((activeItemRect?.top ?? popupRect.top) - containingBlockRect.top),
  };
}

function previewPlacementEqual(
  left: ComposerPathPreviewPlacement,
  right: ComposerPathPreviewPlacement,
): boolean {
  return left.side === right.side && left.left === right.left && left.top === right.top;
}

function findActivePathItem(popup: HTMLElement): HTMLElement | null {
  return popup.querySelector('[data-menu-item-type="path"][data-is-selected]');
}

/**
 * Pierre-tree staircase preview for the `@` menu's active path item.
 *
 * Mount inside the popup that carries `[data-composer-command-menu-root]` so
 * pointer events stay exempt from outside dismissal. The panel is absolutely
 * positioned to the selected row so it never contributes to Floating UI
 * collision measurement or moves the main menu.
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
  const [placement, setPlacement] =
    useState<ComposerPathPreviewPlacement>(HIDDEN_PREVIEW_PLACEMENT);

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

  // Side/top logic: measure the menu popup and active path row once per
  // open/path change, whenever Base UI repositions the popup, and when the list
  // scrolls. The absolute panel is normalized to the popup viewport so it
  // follows those rects without changing the popup's measured size.
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
    const commandList = popup.querySelector<HTMLElement>('[data-slot="command-list"]');
    const viewport = panel.closest<HTMLElement>('[data-slot="popover-viewport"]');
    const positioner = popup.parentElement;
    const measure = () => {
      const popupRect = popup.getBoundingClientRect();
      const activeItemRect = findActivePathItem(popup)?.getBoundingClientRect() ?? null;
      const containingBlockRect = viewport?.getBoundingClientRect() ?? popupRect;
      const next = resolvePreviewPlacement(popupRect, activeItemRect, containingBlockRect);
      setPlacement((current) => (previewPlacementEqual(current, next) ? current : next));
    };

    measure();
    commandList?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);

    const observer =
      positioner !== null && typeof MutationObserver !== "undefined"
        ? new MutationObserver(measure)
        : null;
    if (observer && positioner) {
      observer.observe(positioner, { attributeFilter: ["style"] });
    }

    return () => {
      commandList?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
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
      data-preview-side={placement.side}
      data-variant="surface"
      style={placement.side === "hidden" ? undefined : { left: placement.left, top: placement.top }}
      className={cn(
        "pointer-events-auto absolute max-h-[342px] w-[320px] overflow-hidden rounded-lg border border-honk-stroke-secondary bg-(--honk-composer-popup-surface-background) shadow-honk-soft honk-glass-inset-ring",
        placement.side === "hidden" && "hidden",
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
