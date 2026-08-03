import {
  Button,
  Icon,
  IconButton,
  ListRow,
  Menu,
  Pill,
  Popover,
  PreviewCard,
  Text,
  Tooltip,
} from "@honk/ui";
import {
  IconArrowRotateCounterClockwise,
  IconClawd,
  IconGlobe,
  IconKimi,
  IconOpenaiCodex,
  IconPlusSmall,
  IconZai,
} from "@honk/ui/icons";
import {
  HONK_AGENT_PAIRINGS,
  HONK_MODEL_IDS,
  HONK_PRESET_STOPS,
  honkPairingForFusionAgent,
  type HonkPresetStop,
} from "@honk/opencode/pairing";
import type { OpenCodeModelRef } from "@honk/opencode";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { PromptEditorHandle } from "./types";
import { DEFAULT_MODE, modeById, nextModeId, type ModeId } from "../modes";
import {
  actions as selectionActions,
  DEFAULT_FAST,
  DEFAULT_STOP,
  DEFAULT_VARIANTS,
  familyConnectivity,
  KIMI_MODEL_ID,
  modelName,
  providerConnectivity,
  selectionLabel,
  SINGLE_VARIANTS,
  stopLabel,
  submissionModel,
  supportsFast,
  threadModelLabel,
  useModelSelection,
  variantLabel,
  type ModelSelectionSnapshot,
  type ProviderConnectivity,
  type SingleFamilyId,
  type SingleVariant,
} from "../presets";
import { providerAuthActions, useProviderAuth } from "../provider-auth";
import { actions as settingsActions } from "../settings-store";
import { colorVars, controlVars, fontVars, radiusVars } from "@honk/ui/tokens.stylex";

// Cursor draws the composer mode as one chip: 12px text on a 16px line in a 2px x 8px box
// (`.composer-mode-pill-button`). Honk's `Pill size="inline"` is tuned for chips sitting in running
// prose, so at 1px x 5px on a line-height of 1 the label had almost no room around it.
const modeStyles = stylex.create({
  pill: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px is Cursor's intrinsic mode-chip inset; no Honk spacing token is that small
    paddingBlock: "2px",
    paddingInline: controlVars["--honk-control-pad-sm"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
});

export function ModeControl({
  value,
  onValueChange,
}: {
  readonly value: ModeId;
  readonly onValueChange: (id: ModeId) => void;
}): React.ReactElement | null {
  if (value === DEFAULT_MODE) {
    return null;
  }

  const mode = modeById(value);
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      title={`${mode.label} mode. ${mode.description} Shift+Tab or click to switch.`}
      aria-label={`Mode: ${mode.label}. Shift+Tab or click to switch.`}
      onClick={() => {
        onValueChange(nextModeId(value));
      }}
    >
      <Pill size="inline" tone={mode.tone} style={modeStyles.pill}>
        {mode.label}
      </Pill>
    </Button>
  );
}

// Plain objects: @honk/ui `style` hatches merge inline CSS, not StyleX styles.
// The picker is a menu-class popup: same edge gutter, radius, and row rhythm as the
// Menu/Combobox primitives instead of the popover's content padding.
const POPUP_SURFACE_STYLE: React.CSSProperties = {
  padding: controlVars["--honk-control-menu-pad"],
  borderRadius: radiusVars["--honk-radius-menu"],
};
// Hidden meta copy of the level affordance so row content never flows under the
// interactive overlay drawn in its place.
const RESERVED_META_STYLE: React.CSSProperties = { visibility: "hidden" };
// "Default" reads as a quickpick description right after the label, leaving the
// trailing edge to the radio check.
const DEFAULT_META_STYLE: React.CSSProperties = { marginInlineStart: 0 };
const CARD_TEXT_STYLE: React.CSSProperties = { margin: 0 };
const MODEL_PICKER_WIDTH = "272px";
const MODEL_PREVIEW_WIDTH = "236px";

const styles = stylex.create({
  popup: {
    display: "flex",
    flexDirection: "column",
    width: MODEL_PICKER_WIDTH,
  },
  modelIndicator: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  separator: {
    height: controlVars["--honk-control-border-width"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px is the compact menu separator's vertical breathing room; no spacing token owns this inset
    marginBlock: "3px",
    marginInline: `calc(-1 * ${controlVars["--honk-control-menu-pad"]})`,
    backgroundColor: colorVars["--honk-color-border-muted"],
  },
  groupLabel: {
    display: "block",
    paddingInline: controlVars["--honk-control-pad-sm"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px keeps compact menu group labels vertically balanced; no spacing token owns this inset
    paddingBlock: "3px",
  },
  rowWrap: {
    position: "relative",
    "--_honk-model-row-actions-opacity": {
      default: 0,
      ":hover": { "@media (hover: hover)": 1 },
      ":focus-within": 1,
    },
    "--_honk-model-row-actions-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
    },
  },
  rowActions: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: controlVars["--honk-control-pad-sm"],
    display: "flex",
    alignItems: "center",
    opacity: "var(--_honk-model-row-actions-opacity)",
    pointerEvents: "var(--_honk-model-row-actions-pointer-events)",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    width: MODEL_PREVIEW_WIDTH,
  },
  cardHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
  },
  cardActions: {
    display: "flex",
    marginTop: controlVars["--honk-control-gap"],
  },
});

const VARIANT_MEANINGS: Readonly<Record<SingleVariant, string>> = {
  medium: "balanced speed and reasoning depth",
  high: "spends longer reasoning before answering",
  xhigh: "deep reasoning for hard problems",
  max: "maximum reasoning depth, slowest responses",
};

// Kimi and GLM share the OpenCode Go provider, so the glyph keys off the model id
// first; the provider only decides for Claude Code, Codex, and unseen Go models.
function ModelIcon({ model }: { readonly model: OpenCodeModelRef }): React.ReactElement {
  return <Icon icon={modelGlyph(model)} size="sm" tone="muted" />;
}

function modelGlyph(model: OpenCodeModelRef) {
  if (model.id === HONK_MODEL_IDS.kimi.id) return IconKimi;
  if (model.id === HONK_MODEL_IDS.glm.id) return IconZai;
  if (model.providerID === HONK_MODEL_IDS.fable5.providerID) return IconClawd;
  if (model.providerID === "opencode-go") return IconGlobe;
  return IconOpenaiCodex;
}

// Read-only side card. Its only interactive element is the Settings link shown
// for rows whose account is disconnected.
function ModelPreviewCard({
  title,
  provider,
  description,
  detail,
  connectMessage,
}: {
  readonly title: string;
  readonly provider: string;
  readonly description: string;
  readonly detail?: React.ReactNode;
  readonly connectMessage?: string | undefined;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.cardHeader)}>
        <Text size="sm" weight="semibold">
          {title}
        </Text>
        <Text size="xs" tone="faint">
          {provider}
        </Text>
      </div>
      <Text as="p" size="xs" tone="muted" style={CARD_TEXT_STYLE}>
        {description}
      </Text>
      {connectMessage === undefined ? (
        detail
      ) : (
        <>
          <Text as="p" size="xs" tone="warn" style={CARD_TEXT_STYLE}>
            {connectMessage}
          </Text>
          <div {...stylex.props(styles.cardActions)}>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                settingsActions.open("providers");
              }}
            >
              Open Settings
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

type PickerEditOptions = {
  readonly ariaLabel: string;
  readonly stops: readonly { readonly id: string; readonly label: string }[];
  readonly value: string;
  readonly defaultId: string;
  readonly onValueChange: (id: string) => void;
  readonly fast?:
    | {
        readonly value: boolean;
        readonly onValueChange: (fast: boolean) => void;
      }
    | undefined;
  readonly onReset?: (() => void) | undefined;
};

function ModelOptionsMenu({ edit }: { readonly edit: PickerEditOptions }): React.ReactElement {
  return (
    <>
      <Menu.Group>
        <Menu.GroupLabel>Thinking level</Menu.GroupLabel>
        <Menu.RadioGroup value={edit.value} onValueChange={edit.onValueChange}>
          {edit.stops.map((stop) => (
            <Menu.RadioItem key={stop.id} value={stop.id} closeOnClick={false}>
              {stop.label}
              {stop.id === edit.defaultId ? (
                <Menu.ItemMeta style={DEFAULT_META_STYLE}>Default</Menu.ItemMeta>
              ) : null}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Group>
      {edit.fast === undefined ? null : (
        <>
          <Menu.Separator />
          <Menu.Group>
            <Menu.GroupLabel>Options</Menu.GroupLabel>
            <Menu.SwitchItem
              checked={edit.fast.value}
              closeOnClick={false}
              onCheckedChange={edit.fast.onValueChange}
            >
              Fast
            </Menu.SwitchItem>
          </Menu.Group>
        </>
      )}
    </>
  );
}

function fusionEditOptions(selection: ModelSelectionSnapshot): PickerEditOptions {
  return {
    ariaLabel: "Edit Fusion effort",
    stops: HONK_PRESET_STOPS.map((stop) => ({ id: stop, label: stopLabel(stop) })),
    value: selection.stop,
    defaultId: DEFAULT_STOP,
    onValueChange: (id) => {
      selectionActions.setFusionStop(id as HonkPresetStop);
    },
    ...(selection.stop === DEFAULT_STOP
      ? {}
      : {
          onReset: () => {
            selectionActions.setFusionStop(DEFAULT_STOP);
          },
        }),
  };
}

function singleEditOptions(
  selection: ModelSelectionSnapshot,
  family: SingleFamilyId,
  title: string,
): PickerEditOptions | undefined {
  if (family === KIMI_MODEL_ID) return undefined;
  const fastFamily = supportsFast(family) ? family : undefined;
  return {
    ariaLabel: `Edit ${title} options`,
    stops: SINGLE_VARIANTS.map((stop) => ({ id: stop, label: variantLabel(stop) })),
    value: selection.variants[family],
    defaultId: DEFAULT_VARIANTS[family],
    onValueChange: (id) => {
      selectionActions.setSingleVariant(family, id as SingleVariant);
    },
    ...(fastFamily === undefined
      ? {}
      : {
          fast: {
            value: selection.fast[fastFamily],
            onValueChange: (value: boolean) => {
              selectionActions.setSingleFast(fastFamily, value);
            },
          },
        }),
    ...(selection.variants[family] === DEFAULT_VARIANTS[family] &&
    (fastFamily === undefined || selection.fast[fastFamily] === DEFAULT_FAST[fastFamily])
      ? {}
      : {
          onReset: () => {
            selectionActions.resetSingleOptions(family);
          },
        }),
  };
}

// Every configurable row reveals reset/edit actions on hover or focus, independently
// of selection. Its option menu stays open across thinking-level and Fast changes. Rows
// are never disabled: a disconnected account is explained in the preview card but the
// pick still goes through and fails at runtime.
function PickerRow({
  isSelected,
  onSelect,
  meta,
  edit,
  preview,
  children,
}: {
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly meta: string;
  readonly edit?: PickerEditOptions | undefined;
  readonly preview: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const levelLabel =
    edit === undefined ? "" : (edit.stops.find((stop) => stop.id === edit.value)?.label ?? "");
  const optionsLabel = `${levelLabel}${edit?.fast?.value === true ? " Fast" : ""}`;

  return (
    <div {...stylex.props(styles.rowWrap)}>
      <PreviewCard.Root
        open={previewOpen && !menuOpen && !(isSelected && edit !== undefined)}
        onOpenChange={setPreviewOpen}
      >
        <PreviewCard.Trigger
          render={
            <ListRow
              role="radio"
              size="menu"
              aria-checked={isSelected}
              isSelected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={onSelect}
            />
          }
        >
          {children}
          {meta.length === 0 ? null : (
            <Text size="xs" tone="muted">
              {meta}
            </Text>
          )}
          {edit === undefined ? null : (
            <ListRow.Meta style={RESERVED_META_STYLE}>
              Edit
              {edit.onReset === undefined ? null : (
                <Icon icon={IconArrowRotateCounterClockwise} size="xs" />
              )}
            </ListRow.Meta>
          )}
        </PreviewCard.Trigger>
        <PreviewCard.Popup>{preview}</PreviewCard.Popup>
      </PreviewCard.Root>
      {edit === undefined ? null : (
        <span {...stylex.props(styles.rowActions)}>
          <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Menu.Trigger
              render={
                <ListRow.Action
                  variant="meta"
                  isActive={menuOpen}
                  aria-label={`${edit.ariaLabel}: ${optionsLabel}`}
                />
              }
            >
              Edit
            </Menu.Trigger>
            <Menu.Popup side="inline-end" align="start">
              <ModelOptionsMenu edit={edit} />
            </Menu.Popup>
          </Menu.Root>
          {edit.onReset === undefined ? null : (
            <ListRow.Action
              variant="meta"
              aria-label="Reset to default"
              title="Reset to default"
              onClick={edit.onReset}
            >
              <Icon icon={IconArrowRotateCounterClockwise} size="xs" />
            </ListRow.Action>
          )}
        </span>
      )}
    </div>
  );
}

export function ThinkingLevelControl(): React.ReactElement | null {
  const selection = useModelSelection();
  const edit =
    selection.active === "fusion"
      ? fusionEditOptions(selection)
      : singleEditOptions(
          selection,
          selection.singleFamily,
          SINGLE_MODEL_ROWS.find((row) => row.family === selection.singleFamily)?.title ??
            selection.singleFamily,
        );
  if (edit === undefined) return null;
  const levelLabel = edit.stops.find((stop) => stop.id === edit.value)?.label ?? edit.value;
  const label = `${levelLabel}${edit.fast?.value === true ? " · Fast" : ""}`;

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button type="button" size="sm" variant="quiet" aria-label={`Thinking level: ${label}`} />
        }
      >
        {label}
      </Menu.Trigger>
      <Menu.Popup>
        <ModelOptionsMenu edit={edit} />
      </Menu.Popup>
    </Menu.Root>
  );
}

const SINGLE_MODEL_ROWS: readonly {
  readonly family: SingleFamilyId;
  readonly title: string;
  readonly model: { readonly providerID: string; readonly id: string };
  readonly provider: string;
  readonly description: string;
  readonly connectMessage: string;
}[] = [
  {
    family: "fable5",
    title: "Fable 5",
    model: HONK_MODEL_IDS.fable5,
    provider: "Claude Code",
    description: "Anthropic's flagship model for deep, multi-step engineering work.",
    connectMessage: "Connect Claude Code in Settings to use Fable 5.",
  },
  {
    family: "opus5",
    title: "Opus 5",
    model: HONK_MODEL_IDS.opus5,
    provider: "Claude Code",
    description: "Anthropic's Opus line, deliberate and thorough on hard changes.",
    connectMessage: "Connect Claude Code in Settings to use Opus 5.",
  },
  {
    family: "sol",
    title: "Sol",
    model: HONK_MODEL_IDS.sol,
    provider: "Codex",
    description: "OpenAI's fast, capable model for everyday coding.",
    connectMessage: "Connect Codex in Settings to use Sol.",
  },
  {
    family: KIMI_MODEL_ID,
    title: "Kimi K3",
    model: HONK_MODEL_IDS.kimi,
    provider: "OpenCode Go",
    description: "Moonshot's open model, served through the OpenCode Go gateway.",
    connectMessage: "Connect OpenCode Go in Settings to use Kimi K3.",
  },
];

// Fusion is never gated: any stop stays selectable and a missing account
// fails the run instead, so this line just sets expectations honestly.
function codexStatusLine(connectivity: ProviderConnectivity): string {
  if (connectivity.openAi === true) return "Codex connected";
  if (connectivity.openAi === false) return "Codex not connected — levels that use it will fail";
  return "Checking Codex connection…";
}

// Threads show the model that runs the next prompt but never switch it. Fusion owns model
// choice inside a thread, so this is a label, not a picker.
export function ThreadModelIndicator(props: {
  readonly agent: string;
  readonly model: OpenCodeModelRef | null;
}): React.ReactElement {
  const pairing = honkPairingForFusionAgent(props.agent);
  if (pairing !== undefined) {
    return (
      <Text size="sm" tone="muted">
        {threadModelLabel(props.agent, props.model)}
      </Text>
    );
  }
  if (props.model === null) {
    return (
      <Text size="sm" tone="muted">
        {threadModelLabel(props.agent, props.model)}
      </Text>
    );
  }
  return (
    <span {...stylex.props(styles.modelIndicator)}>
      <ModelIcon model={props.model} />
      <Text size="sm" tone="muted">
        {threadModelLabel(props.agent, props.model)}
      </Text>
    </span>
  );
}

export function ModelSelector(): React.ReactElement {
  const selection = useModelSelection();
  const auth = useProviderAuth();
  const connectivity = providerConnectivity(auth);
  const label = selectionLabel(selection);
  const plan = submissionModel(selection);

  return (
    <Popover.Root
      onOpenChange={(open) => {
        // The local claude CLI's auth can change outside the app (a terminal
        // `claude login`/logout), so re-probe it every time the picker opens.
        if (open) void providerAuthActions.refreshClaude();
      }}
    >
      <Popover.Trigger
        render={
          <Button
            type="button"
            size="sm"
            variant="quiet"
            aria-label={`Model: ${label}`}
            iconStart={<ModelIcon model={plan.model} />}
          >
            {label}
          </Button>
        }
      />
      <Popover.Popup side="bottom" align="start" sideOffset={4} style={POPUP_SURFACE_STYLE}>
        <div
          {...stylex.props(styles.popup)}
          role="radiogroup"
          aria-label="Model"
          onKeyDown={onModelRadioGroupKeyDown}
        >
          <PickerRow
            isSelected={selection.active === "fusion"}
            onSelect={() => {
              selectionActions.selectFusion();
            }}
            meta={stopLabel(selection.stop)}
            edit={fusionEditOptions(selection)}
            preview={
              <ModelPreviewCard
                title="Fusion"
                provider="Multi-model"
                description="One model orchestrates, one executes."
                detail={
                  <>
                    {HONK_AGENT_PAIRINGS.map((pairing) => (
                      <Text
                        key={pairing.stop}
                        as="p"
                        size="xs"
                        tone="muted"
                        style={CARD_TEXT_STYLE}
                      >
                        {`${stopLabel(pairing.stop)} · ${modelName(pairing.main.id)} + ${modelName(pairing.sidekick.id)}`}
                      </Text>
                    ))}
                    <Text as="p" size="xs" tone="faint" style={CARD_TEXT_STYLE}>
                      {codexStatusLine(connectivity)}
                    </Text>
                  </>
                }
              />
            }
          >
            <ListRow.Content>
              <ListRow.Title>Fusion</ListRow.Title>
              <ListRow.Description>One model orchestrates, one executes</ListRow.Description>
            </ListRow.Content>
          </PickerRow>
          <div aria-hidden="true" {...stylex.props(styles.separator)} />
          <div {...stylex.props(styles.groupLabel)}>
            <Text size="xs" tone="muted">
              Single models
            </Text>
          </div>
          {SINGLE_MODEL_ROWS.map((row) => {
            const variantFamily = row.family === KIMI_MODEL_ID ? undefined : row.family;
            const variant =
              variantFamily === undefined ? undefined : selection.variants[variantFamily];
            const fastFamily = supportsFast(row.family) ? row.family : undefined;
            const fast = fastFamily === undefined ? undefined : selection.fast[fastFamily];
            const disconnected = familyConnectivity(row.family, connectivity) === false;
            return (
              <PickerRow
                key={row.family}
                isSelected={selection.active === "single" && selection.singleFamily === row.family}
                onSelect={() => {
                  selectionActions.selectSingle(row.family);
                }}
                meta={
                  variant === undefined
                    ? ""
                    : `${variantLabel(variant)}${fast === true ? " Fast" : ""}`
                }
                edit={singleEditOptions(selection, row.family, row.title)}
                preview={
                  <ModelPreviewCard
                    title={row.title}
                    provider={row.provider}
                    description={row.description}
                    connectMessage={disconnected ? row.connectMessage : undefined}
                    detail={
                      <Text as="p" size="xs" tone="muted" style={CARD_TEXT_STYLE}>
                        {variant === undefined
                          ? "No thinking-level control; runs at the gateway default."
                          : `Thinking ${variantLabel(variant)} — ${VARIANT_MEANINGS[variant]}.`}
                      </Text>
                    }
                  />
                }
              >
                <ListRow.Slot>
                  <ModelIcon model={row.model} />
                </ListRow.Slot>
                <ListRow.Title>{row.title}</ListRow.Title>
              </PickerRow>
            );
          })}
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
}

const RADIO_ARROW_DELTAS: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

// ARIA radio-group keyboard pattern for the picker: the selected row is the
// group's single Tab stop (roving tabindex above) and arrows move focus
// between rows, wrapping at the ends, selecting the row they land on. Keys
// landing on the pencil actions fall through untouched.
function onModelRadioGroupKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
  const delta = RADIO_ARROW_DELTAS[event.key];
  if (delta === undefined) return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const index = radios.indexOf(event.target as HTMLElement);
  if (index === -1) return;
  event.preventDefault();
  const next = radios[(index + delta + radios.length) % radios.length];
  if (next === undefined) return;
  next.focus();
  next.click();
}

export function ComposerAttachmentButton(props: {
  readonly editorRef: React.RefObject<PromptEditorHandle | null>;
}): React.ReactElement {
  return (
    <Tooltip label="Add attachments">
      <IconButton
        type="button"
        aria-label="Add attachments"
        size="sm"
        variant="quiet"
        onClick={() => props.editorRef.current?.chooseImages()}
      >
        <Icon icon={IconPlusSmall} size="sm" />
      </IconButton>
    </Tooltip>
  );
}
