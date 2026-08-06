import { Button, Icon, IconButton, Menu, Pill, PreviewCard, Text, Tooltip } from "@honk/ui";
import {
  IconArrowRotateCounterClockwise,
  IconChevronRightMedium,
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
import { usePreviewPanelHold, type PreviewPanelHold } from "./preview-panel-hold";
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
import { controlVars, fontVars } from "@honk/ui/tokens.stylex";

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

// "Default" reads as a quickpick description right after the label, leaving the
// trailing edge to the radio check.
const DEFAULT_META_STYLE: React.CSSProperties = { marginInlineStart: 0 };
const CARD_TEXT_STYLE: React.CSSProperties = { margin: 0 };
const MODEL_PREVIEW_WIDTH = "236px";

const styles = stylex.create({
  modelIndicator: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
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

type PickerRowId = "fusion" | SingleFamilyId;

// A model row: radio item that commits on click, plus a hover-held explanation panel
// opening inline-start. The panel's lifetime is owned by the shared hold logic; Base UI
// alone would dismiss it from menu focus movement (see preview-panel-hold.ts).
function ModelPickerRow({
  hold,
  id,
  title,
  meta,
  icon,
  panel,
}: {
  readonly hold: PreviewPanelHold<PickerRowId>;
  readonly id: PickerRowId;
  readonly title: string;
  readonly meta: string;
  readonly icon: React.ReactNode;
  readonly panel: React.ReactNode;
}): React.ReactElement {
  return (
    <PreviewCard.Root
      open={hold.openId === id}
      onOpenChange={(open) => {
        hold.handleOpenChange(id, open);
      }}
    >
      <PreviewCard.Trigger render={<Menu.RadioItem value={id} closeOnClick ref={hold.rowRef(id)} />}>
        <Menu.ItemIcon>{icon}</Menu.ItemIcon>
        {title}
        {meta.length === 0 ? null : <Menu.ItemMeta>{meta}</Menu.ItemMeta>}
      </PreviewCard.Trigger>
      <PreviewCard.Popup
        ref={hold.panelRef}
        side="inline-start"
        align="start"
        aria-label={`About ${title}`}
        style={hold.panelStyle}
      >
        {panel}
      </PreviewCard.Popup>
    </PreviewCard.Root>
  );
}

// One menu owns the whole selection, Cursor-style: thinking level and Fast for the
// active pick up top, then the model list as a hover-revealed submenu whose rows carry
// hover-held explanation panels. Hover only reveals; every mutation is a click.
export function ModelSelector(): React.ReactElement {
  const selection = useModelSelection();
  const auth = useProviderAuth();
  const connectivity = providerConnectivity(auth);
  const label = selectionLabel(selection);
  const plan = submissionModel(selection);
  const [submenuOpen, setSubmenuOpen] = React.useState(false);
  const hold = usePreviewPanelHold<PickerRowId>();

  const activeTitle =
    selection.active === "fusion"
      ? "Fusion"
      : (SINGLE_MODEL_ROWS.find((row) => row.family === selection.singleFamily)?.title ??
        selection.singleFamily);
  const edit =
    selection.active === "fusion"
      ? fusionEditOptions(selection)
      : singleEditOptions(selection, selection.singleFamily, activeTitle);
  const activeRowId: PickerRowId = selection.active === "fusion" ? "fusion" : selection.singleFamily;

  return (
    <Menu.Root
      onOpenChange={(open) => {
        // The local claude CLI's auth can change outside the app (a terminal
        // `claude login`/logout), so re-probe it every time the picker opens.
        if (open) {
          void providerAuthActions.refreshClaude();
        } else {
          setSubmenuOpen(false);
          hold.reset();
        }
      }}
    >
      <Menu.Trigger
        render={
          <Button
            type="button"
            size="sm"
            variant="quiet"
            aria-label={`Model: ${label}`}
            iconStart={<ModelIcon model={plan.model} />}
          />
        }
      >
        {label}
      </Menu.Trigger>
      <Menu.Popup side="bottom" align="start" sideOffset={4}>
        {edit === undefined ? null : (
          <>
            <ModelOptionsMenu edit={edit} />
            {edit.onReset === undefined ? null : (
              <Menu.Item closeOnClick={false} onClick={edit.onReset}>
                <Menu.ItemIcon>
                  <Icon icon={IconArrowRotateCounterClockwise} size="xs" />
                </Menu.ItemIcon>
                Reset to default
              </Menu.Item>
            )}
            <Menu.Separator />
          </>
        )}
        <Menu.Group>
          <Menu.GroupLabel>Model</Menu.GroupLabel>
          {/*
            Controlled: each row's explanation panel lives in its own FloatingTree, so
            the submenu's safe-polygon child check cannot see it. Veto hover-closes
            while a panel is held; the hold logic dismisses the panel when the pointer
            truly leaves, and the next close request then goes through.
          */}
          <Menu.SubmenuRoot
            open={submenuOpen}
            onOpenChange={(open) => {
              if (!open && hold.isActive()) return;
              setSubmenuOpen(open);
              if (!open) hold.reset();
            }}
          >
            <Menu.SubmenuTrigger>
              {activeTitle}
              <Menu.ItemMeta>
                <Icon icon={IconChevronRightMedium} size="xs" tone="faint" />
              </Menu.ItemMeta>
            </Menu.SubmenuTrigger>
            <Menu.SubmenuPopup aria-label="Model">
              <Menu.RadioGroup
                value={activeRowId}
                onValueChange={(value) => {
                  if (value === "fusion") selectionActions.selectFusion();
                  else selectionActions.selectSingle(value as SingleFamilyId);
                }}
              >
                <ModelPickerRow
                  hold={hold}
                  id="fusion"
                  title="Fusion"
                  meta={stopLabel(selection.stop)}
                  icon={null}
                  panel={
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
                />
                {SINGLE_MODEL_ROWS.map((row) => {
                  const variantFamily = row.family === KIMI_MODEL_ID ? undefined : row.family;
                  const variant =
                    variantFamily === undefined ? undefined : selection.variants[variantFamily];
                  const fastFamily = supportsFast(row.family) ? row.family : undefined;
                  const fast = fastFamily === undefined ? undefined : selection.fast[fastFamily];
                  const disconnected = familyConnectivity(row.family, connectivity) === false;
                  return (
                    <ModelPickerRow
                      key={row.family}
                      hold={hold}
                      id={row.family}
                      title={row.title}
                      meta={
                        variant === undefined
                          ? ""
                          : `${variantLabel(variant)}${fast === true ? " Fast" : ""}`
                      }
                      icon={<ModelIcon model={row.model} />}
                      panel={
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
                    />
                  );
                })}
              </Menu.RadioGroup>
            </Menu.SubmenuPopup>
          </Menu.SubmenuRoot>
        </Menu.Group>
      </Menu.Popup>
    </Menu.Root>
  );
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
