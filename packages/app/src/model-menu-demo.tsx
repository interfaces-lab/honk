// Demo: the Cursor-style model selector collapsed into one Base UI menu.
//
// Effort, the Fast toggle, and the model list live in a single popup; the model list is a
// hover-revealed submenu. Because these are model actions, hover only ever *reveals* —
// selection always requires a click (see mayank.co/blog/hover-triangles on why hover
// menus need this discipline). Base UI guards the hover traversal with floating-ui's
// safe-polygon: an invisible triangle from the pointer to the submenu's near edge plus a
// trough between the two surfaces. This page recomputes that exact zone (the math is
// mirrored in model-menu-demo-geometry.ts) and paints it so the overhead is visible.

import { Button, Icon, Menu, PreviewCard, Text } from "@honk/ui";
import { IconChevronRightMedium } from "@honk/ui/icons";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import {
  computeSafeZone,
  isPointInSafeZone,
  PREVIEW_HOVER_CLOSE_DELAY_MS,
  PREVIEW_HOVER_OPEN_DELAY_MS,
  SAFE_POLYGON_GRACE_MS,
  SLOW_CURSOR_THRESHOLD_PX_PER_MS,
  SUBMENU_HOVER_OPEN_REST_MS,
  type Point,
  type SafeZone,
} from "./model-menu-demo-geometry";
import {
  borderVars,
  colorVars,
  controlVars,
  radiusVars,
  spaceVars,
  zVars,
} from "@honk/ui/tokens.stylex";

const EFFORTS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
] as const;

type EffortId = (typeof EFFORTS)[number]["id"];

const MODELS = [
  {
    id: "auto",
    label: "Auto",
    meta: "",
    description: "Picks the best model for each prompt.",
    context: "Context window varies by pick",
    note: undefined,
  },
  {
    id: "fusion",
    label: "Fusion",
    meta: "Multi-model",
    description: "One model orchestrates, one executes.",
    context: "Context window varies by level",
    note: undefined,
  },
  {
    id: "fable5",
    label: "Fable 5",
    meta: "High",
    description: "Anthropic's most powerful model, great for difficult tasks.",
    context: "300k context window",
    note: "This model has special data retention policies.",
  },
  {
    id: "opus5",
    label: "Opus 5",
    meta: "High",
    description: "Anthropic's Opus line, deliberate and thorough on hard changes.",
    context: "200k context window",
    note: undefined,
  },
  {
    id: "sol",
    label: "Sol",
    meta: "1M Extra High",
    description: "OpenAI's fast, capable model for everyday coding.",
    context: "1M context window",
    note: undefined,
  },
  {
    id: "kimi",
    label: "Kimi K3",
    meta: "Medium",
    description: "Moonshot's open model, served through the OpenCode Go gateway.",
    context: "256k context window",
    note: undefined,
  },
] as const;

type ModelEntry = (typeof MODELS)[number];

// Same fixed card width the real model selector uses (controls.tsx MODEL_PREVIEW_WIDTH).
const PANEL_WIDTH = "236px";
// Plain objects: @honk/ui `style` hatches merge inline CSS (same hatch controls.tsx uses).
const PANEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: controlVars["--honk-control-gap"],
  width: PANEL_WIDTH,
};
const PANEL_TEXT_STYLE: React.CSSProperties = { margin: 0 };

type ModelId = (typeof MODELS)[number]["id"];

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: "100dvh",
    padding: spaceVars["--honk-space-panel-pad"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  intro: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    maxWidth: controlVars["--honk-control-picker-max-w"],
    textAlign: "center",
  },
  composerBar: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    width: controlVars["--honk-control-picker-max-w"],
    padding: spaceVars["--honk-space-control-pad-x"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  composerHint: {
    marginInlineStart: "auto",
  },
  hud: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    width: controlVars["--honk-control-picker-max-w"],
    padding: spaceVars["--honk-space-panel-pad"],
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  hudRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
  },
  overlay: {
    position: "fixed",
    inset: 0,
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: zVars["--honk-z-tooltip"],
  },
});

type ZoneSnapshot = {
  readonly zone: SafeZone;
  /** Inside the zone or over one of its surfaces — the popup will stay open. */
  readonly inside: boolean;
};

type OverlaySnapshot = {
  readonly pointer: Point;
  /** Trigger row → model submenu (Base UI side "right"). */
  readonly menu: ZoneSnapshot;
  /** Model row → explanation panel (Base UI side "left"); null until a panel is open. */
  readonly preview: ZoneSnapshot | null;
};

// One safe zone: trough rect plus intent polygon. Escaping flips the tint to err and
// dashes the outline — the moment Base UI would start closing that surface.
function ZoneLayer({
  snapshot,
  insideTone,
}: {
  readonly snapshot: ZoneSnapshot;
  readonly insideTone: string;
}): React.ReactElement {
  const { zone, inside } = snapshot;
  const tone = inside ? insideTone : colorVars["--honk-color-err-fg"];
  const points = zone.polygon.map((p) => `${p.x},${p.y}`).join(" ");
  const troughWidth = Math.max(0, zone.trough.right - zone.trough.left);
  const troughHeight = Math.max(0, zone.trough.bottom - zone.trough.top);
  return (
    <g>
      <rect
        x={zone.trough.left}
        y={zone.trough.top}
        width={troughWidth}
        height={troughHeight}
        fill={tone}
        fillOpacity={0.1}
      />
      <polygon
        points={points}
        fill={tone}
        fillOpacity={0.18}
        stroke={tone}
        strokeOpacity={0.7}
        strokeWidth={1}
        strokeDasharray={inside ? undefined : "4 3"}
      />
    </g>
  );
}

// Fixed full-viewport SVG in client coordinates, so the geometry maps 1:1 onto the menu.
function SafeZoneOverlay({ snapshot }: { readonly snapshot: OverlaySnapshot }): React.ReactElement {
  const dotTone =
    snapshot.menu.inside && snapshot.preview?.inside !== false
      ? colorVars["--honk-color-ok-fg"]
      : colorVars["--honk-color-err-fg"];
  return (
    <svg aria-hidden="true" {...stylex.props(styles.overlay)}>
      <ZoneLayer snapshot={snapshot.menu} insideTone={colorVars["--honk-color-ok-fg"]} />
      {snapshot.preview === null ? null : (
        <ZoneLayer snapshot={snapshot.preview} insideTone={colorVars["--honk-color-accent"]} />
      )}
      <circle cx={snapshot.pointer.x} cy={snapshot.pointer.y} r={4} fill={dotTone} fillOpacity={0.9} />
    </svg>
  );
}

// The explanation panel from the Cursor screenshots: read-only body, so hovering it can
// never change the selection — the affordance is purely informational.
function ModelPanel({ model, effortLabel }: {
  readonly model: ModelEntry;
  readonly effortLabel: string;
}): React.ReactElement {
  return (
    <div style={PANEL_STYLE}>
      <Text as="p" size="sm" weight="semibold" style={PANEL_TEXT_STYLE}>
        {model.label}
      </Text>
      <Text as="p" size="xs" tone="muted" style={PANEL_TEXT_STYLE}>
        {model.description}
      </Text>
      <Text as="p" size="xs" style={PANEL_TEXT_STYLE}>
        {model.context}
      </Text>
      {model.note === undefined ? null : (
        <Text as="p" size="xs" tone="warn" style={PANEL_TEXT_STYLE}>
          {model.note}
        </Text>
      )}
      <Text as="p" size="xs" tone="faint" style={PANEL_TEXT_STYLE}>
        {`Version: ${effortLabel.toLowerCase()} effort`}
      </Text>
    </div>
  );
}

export function ModelMenuDemoPage(): React.ReactElement {
  const [effort, setEffort] = React.useState<EffortId>("high");
  const [fast, setFast] = React.useState(false);
  const [modelId, setModelId] = React.useState<ModelId>("fable5");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [submenuOpen, setSubmenuOpen] = React.useState(false);
  const [previewModelId, setPreviewModelId] = React.useState<ModelId | null>(null);
  const [snapshot, setSnapshot] = React.useState<OverlaySnapshot | null>(null);
  // Mirror for the submenu's onOpenChange veto: Base UI's close requests arrive outside
  // the React render cycle, so they must read the current panel state, not a closure.
  const previewModelIdRef = React.useRef<ModelId | null>(null);
  previewModelIdRef.current = previewModelId;

  const submenuTriggerRef = React.useRef<HTMLDivElement | null>(null);
  const submenuPopupRef = React.useRef<HTMLDivElement | null>(null);
  const modelRowRefs = React.useRef(new Map<ModelId, HTMLDivElement>());
  const panelPopupRef = React.useRef<HTMLDivElement | null>(null);
  // Base UI anchors each polygon at the pointer position captured when it leaves the
  // trigger; while still over the trigger the apex tracks the pointer live.
  const anchorRef = React.useRef<Point | null>(null);
  const panelAnchorRef = React.useRef<Point | null>(null);

  React.useEffect(() => {
    if (!menuOpen) {
      anchorRef.current = null;
      panelAnchorRef.current = null;
      setSnapshot(null);
      return undefined;
    }
    const within = (point: Point, rect: DOMRect): boolean =>
      point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
    const onMouseMove = (event: MouseEvent): void => {
      const pointer: Point = { x: event.clientX, y: event.clientY };
      const triggerRect = submenuTriggerRef.current?.getBoundingClientRect();
      const popupRect = submenuPopupRef.current?.getBoundingClientRect();
      if (triggerRect !== undefined && within(pointer, triggerRect)) {
        anchorRef.current = pointer;
      }
      const anchor = anchorRef.current;
      if (triggerRect === undefined || popupRect === undefined || anchor === null) {
        setSnapshot(null);
        return;
      }

      // Second affordance: hovered model row -> explanation panel, mirrored to the left.
      let preview: ZoneSnapshot | null = null;
      const rowRect =
        previewModelId === null
          ? undefined
          : modelRowRefs.current.get(previewModelId)?.getBoundingClientRect();
      const panelRect = previewModelId === null
        ? undefined
        : panelPopupRef.current?.getBoundingClientRect();
      if (rowRect !== undefined && within(pointer, rowRect)) {
        panelAnchorRef.current = pointer;
      }
      const panelAnchor = panelAnchorRef.current;
      if (rowRect !== undefined && panelRect !== undefined && panelAnchor !== null) {
        const zone = computeSafeZone(panelAnchor, rowRect, panelRect, "left");
        preview = {
          zone,
          inside:
            within(pointer, rowRect) ||
            within(pointer, panelRect) ||
            isPointInSafeZone(pointer, zone),
        };
      }

      const menuZone = computeSafeZone(anchor, triggerRect, popupRect);
      setSnapshot({
        pointer,
        menu: {
          zone: menuZone,
          inside:
            within(pointer, triggerRect) ||
            within(pointer, popupRect) ||
            isPointInSafeZone(pointer, menuZone),
        },
        preview,
      });
    };
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, [menuOpen, previewModelId]);

  const model = MODELS.find((entry) => entry.id === modelId) ?? MODELS[0];
  const effortLabel = EFFORTS.find((entry) => entry.id === effort)?.label ?? effort;
  const triggerLabel = `${model.label} · ${effortLabel}${fast ? " · Fast" : ""}`;

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.intro)}>
        <Text as="div" size="lg" weight="semibold">
          Model selector demo
        </Text>
        <Text as="p" size="sm" tone="muted">
          One menu instead of stacked buttons: effort, the Fast toggle, and the model list in a
          single popup. Hover only reveals the model submenu and each model's explanation panel —
          picking a model always takes a click. Open the menu and hover “Model”, then rest on a
          model row: green is the submenu's safe area, blue is the panel's. The panel itself is
          hoverable — the submenu holds open while you're on it, and pausing on a different row
          swaps the panel instead of stacking a second one.
        </Text>
      </div>

      <div {...stylex.props(styles.composerBar)}>
        <Menu.Root
          onOpenChange={(open) => {
            setMenuOpen(open);
            if (!open) {
              setSubmenuOpen(false);
              setPreviewModelId(null);
            }
          }}
        >
          <Menu.Trigger
            render={
              <Button type="button" size="sm" variant="quiet" aria-label={`Model: ${triggerLabel}`} />
            }
          >
            {triggerLabel}
          </Menu.Trigger>
          <Menu.Popup side="top" align="start">
            <Menu.Group>
              <Menu.GroupLabel>Effort</Menu.GroupLabel>
              <Menu.RadioGroup
                value={effort}
                onValueChange={(value) => {
                  setEffort(value as EffortId);
                }}
              >
                {EFFORTS.map((entry) => (
                  <Menu.RadioItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>Options</Menu.GroupLabel>
              <Menu.SwitchItem checked={fast} closeOnClick={false} onCheckedChange={setFast}>
                Fast
              </Menu.SwitchItem>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>Model</Menu.GroupLabel>
              {/*
                Controlled: PreviewCard.Root wraps itself in a private FloatingTree, so the
                menu's safe-polygon `hasOpenChildNode()` cannot see an open panel. Hovering
                the panel (which sits left of the "Model" trigger row) would otherwise trip
                the submenu's opposite-side close. While a panel is active, veto the close.
              */}
              <Menu.SubmenuRoot
                open={submenuOpen}
                onOpenChange={(open) => {
                  if (!open && previewModelIdRef.current !== null) return;
                  setSubmenuOpen(open);
                }}
              >
                <Menu.SubmenuTrigger ref={submenuTriggerRef}>
                  {model.label}
                  <Menu.ItemMeta>
                    <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
                  </Menu.ItemMeta>
                </Menu.SubmenuTrigger>
                <Menu.SubmenuPopup ref={submenuPopupRef} aria-label="Model">
                  <Menu.RadioGroup
                    value={modelId}
                    onValueChange={(value) => {
                      setModelId(value as ModelId);
                    }}
                  >
                    {/*
                      Controlled single-open: per-row roots are independent, so two panels
                      could open at once (pause on another row mid-traversal). Routing all
                      open requests through one id makes a new row's panel replace the
                      current one instead of stacking on it.
                    */}
                    {MODELS.map((entry) => (
                      <PreviewCard.Root
                        key={entry.id}
                        open={previewModelId === entry.id}
                        onOpenChange={(open) => {
                          panelAnchorRef.current = null;
                          setPreviewModelId((prev) =>
                            open ? entry.id : prev === entry.id ? null : prev,
                          );
                        }}
                      >
                        <PreviewCard.Trigger
                          render={
                            <Menu.RadioItem
                              value={entry.id}
                              closeOnClick
                              ref={(node: HTMLDivElement | null) => {
                                if (node === null) modelRowRefs.current.delete(entry.id);
                                else modelRowRefs.current.set(entry.id, node);
                              }}
                            />
                          }
                        >
                          {entry.label}
                          {entry.meta.length === 0 ? null : (
                            <Menu.ItemMeta>{entry.meta}</Menu.ItemMeta>
                          )}
                        </PreviewCard.Trigger>
                        <PreviewCard.Popup
                          ref={panelPopupRef}
                          side="inline-start"
                          align="start"
                          aria-label={`About ${entry.label}`}
                        >
                          <ModelPanel model={entry} effortLabel={effortLabel} />
                        </PreviewCard.Popup>
                      </PreviewCard.Root>
                    ))}
                  </Menu.RadioGroup>
                </Menu.SubmenuPopup>
              </Menu.SubmenuRoot>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Root>
        <span {...stylex.props(styles.composerHint)}>
          <Text size="xs" tone="faint">
            Mock composer
          </Text>
        </span>
      </div>

      <div {...stylex.props(styles.hud)}>
        <Text size="sm" weight="semibold">
          Hover overhead (Base UI safe-polygon)
        </Text>
        <div {...stylex.props(styles.hudRow)}>
          <Text size="xs" tone="muted">
            Rest on “Model” to open
          </Text>
          <Text size="xs">{SUBMENU_HOVER_OPEN_REST_MS} ms</Text>
        </div>
        <div {...stylex.props(styles.hudRow)}>
          <Text size="xs" tone="muted">
            Grace per move outside both surfaces
          </Text>
          <Text size="xs">{SAFE_POLYGON_GRACE_MS} ms</Text>
        </div>
        <div {...stylex.props(styles.hudRow)}>
          <Text size="xs" tone="muted">
            Slow-cursor cutoff (resting outside closes)
          </Text>
          <Text size="xs">{SLOW_CURSOR_THRESHOLD_PX_PER_MS} px/ms</Text>
        </div>
        <div {...stylex.props(styles.hudRow)}>
          <Text size="xs" tone="muted">
            Rest on a model row to open its panel
          </Text>
          <Text size="xs">{PREVIEW_HOVER_OPEN_DELAY_MS} ms</Text>
        </div>
        <div {...stylex.props(styles.hudRow)}>
          <Text size="xs" tone="muted">
            Panel lingers after the pointer leaves
          </Text>
          <Text size="xs">{PREVIEW_HOVER_CLOSE_DELAY_MS} ms</Text>
        </div>
        <div {...stylex.props(styles.hudRow)}>
          <Text size="xs" tone="muted">
            Pointer
          </Text>
          <Text size="xs">
            {snapshot === null
              ? submenuOpen
                ? "measuring…"
                : "open the Model submenu"
              : `${Math.round(snapshot.pointer.x)}, ${Math.round(snapshot.pointer.y)} — submenu ${
                  snapshot.menu.inside ? "safe" : "closing"
                }${
                  snapshot.preview === null
                    ? ""
                    : ` · panel ${snapshot.preview.inside ? "safe" : "closing"}`
                }`}
          </Text>
        </div>
      </div>

      {submenuOpen && snapshot !== null ? <SafeZoneOverlay snapshot={snapshot} /> : null}
    </div>
  );
}
