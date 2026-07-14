// Settings surface — lighter host inside the existing Shell frame (parity rethink:
// do not remount the chat workbench). Nav rail + scrollable panel, hairline-split
// inside the one inset card. Section via ?section= search param.

import * as stylex from "@stylexjs/stylex";
import { Badge, Button, Icon, IconButton, Menu, Text, Tooltip } from "@honk/ui";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
// Runtime: Vite resolves @honk/ui/icons via the package export. Types: see
// honk-ui-icons.d.ts (tsc cannot resolve the "./*" wildcard export).
import {
  IconArchive1,
  IconBuildingBlocks,
  IconChevronLeftMedium,
  IconEyeOpen,
  IconSettingsGear2,
  IconStepBack,
} from "@honk/ui/icons";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "./app-settings-store";
import {
  actions as appearanceActions,
  DEFAULT_APPEARANCE,
  useAppearance,
  type ThemePreference,
} from "./appearance-store";
import { pickFolder } from "./desktop-bridge";
import {
  buildNotificationSettingsSupportText,
  requestBrowserNotificationPermission,
  useNotificationPermission,
} from "./notification-permission";
import type {
  ProviderInventory,
  SidecarProvider,
  SidecarProviderAuthMethod,
  SidecarProviderAuthPrompt,
  ThreadSummary,
} from "./sidecar";
import { PRESETS } from "./presets";
import { actions as tabActions } from "./tab-store";
import { getBoundHonkClient } from "./watch-registry";

// ── Section registry ─────────────────────────────────────────────────────────────────────────

export type SettingsSectionId = "general" | "providers" | "appearance" | "archived";

const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: IconSettingsGear2,
  },
  {
    id: "providers",
    label: "Authentication",
    icon: IconBuildingBlocks,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: IconEyeOpen,
  },
  {
    id: "archived",
    label: "Archived",
    icon: IconArchive1,
  },
] as const satisfies readonly {
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly icon: typeof IconSettingsGear2;
}[];

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly {
  readonly value: ThemePreference;
  readonly label: string;
}[];

// ── Anatomy (named intrinsics — settings chrome, not identity vocabulary) ────────────────────

const NAV_RAIL_WIDTH = "200px";
const HAIRLINE = "1px";
const SWATCH_SIZE = "16px";
const STEPPER_VALUE_MIN_WIDTH = "2ch";
// The panel's reading measure — settings rows cap here instead of stretching the full sheet
// (the home content column's discipline, sized for a label + control line).
const PANEL_MAX_WIDTH = "640px";

const styles = stylex.create({
  root: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "row",
  },
  nav: {
    width: NAV_RAIL_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
  },
  navList: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minHeight: 0,
    flexGrow: 1,
  },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    textDecoration: "none",
    color: colorVars["--honk-color-text-muted"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
    },
  },
  navLinkActive: {
    color: colorVars["--honk-color-text-primary"],
    backgroundColor: colorVars["--honk-color-accent-subtle"],
  },
  panel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    borderLeftWidth: HAIRLINE,
    borderLeftStyle: "solid",
    borderLeftColor: colorVars["--honk-color-border-muted"],
    // Generous page insets; the row column caps at the reading measure inside.
    paddingBlock: "24px",
    paddingInline: "32px",
  },
  panelColumn: {
    width: "100%",
    maxWidth: PANEL_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-panel-pad"],
  },
  // The back affordance — a nav-row, NOT a Button (Button centers its content; every other
  // rail row is a left-aligned flex line, and the back row must sit in the same grid).
  backRow: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    fontFamily: "inherit",
    fontSize: fontVars["--honk-font-size-body"],
    textAlign: "left",
    cursor: "default",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
  },
  rows: {
    display: "flex",
    flexDirection: "column",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: controlVars["--honk-control-h-lg"],
    paddingBlock: controlVars["--honk-control-pad-sm"],
    borderBottomWidth: HAIRLINE,
    borderBottomStyle: "solid",
    borderBottomColor: colorVars["--honk-color-border-muted"],
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowCopy: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
    flexGrow: 1,
  },
  rowTitleLine: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
  stepper: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  stepperValue: {
    minWidth: STEPPER_VALUE_MIN_WIDTH,
    textAlign: "center",
  },
  swatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-accent"],
    flexShrink: 0,
  },
  empty: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
  // Inline credential input (API key / OAuth code) — the boot gate's field recipe at row scale.
  credentialField: {
    boxSizing: "border-box",
    width: "200px",
    height: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-control"],
    boxShadow: `inset 0 0 0 ${HAIRLINE} ${colorVars["--honk-color-border-base"]}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: HAIRLINE,
    outlineOffset: HAIRLINE,
    "::placeholder": {
      color: colorVars["--honk-color-text-muted"],
    },
  },
});

// ── Shared row chrome ────────────────────────────────────────────────────────────────────────

function SettingResetButton(props: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <Tooltip label="Reset to default">
      <IconButton
        size="sm"
        variant="ghost"
        aria-label={`Reset ${props.label} to default`}
        onClick={(event) => {
          event.stopPropagation();
          props.onClick();
        }}
      >
        <Icon icon={IconStepBack} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

function SettingsRow(props: {
  title: string;
  description: string;
  control: React.ReactNode;
  resetAction?: React.ReactNode;
  isLast?: boolean;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.row, props.isLast === true && styles.rowLast)}>
      <div {...stylex.props(styles.rowCopy)}>
        <div {...stylex.props(styles.rowTitleLine)}>
          <Text as="span" size="sm" weight="medium">
            {props.title}
          </Text>
          {props.resetAction}
        </div>
        <Text as="span" size="xs" tone="faint">
          {props.description}
        </Text>
      </div>
      <div {...stylex.props(styles.rowControl)}>{props.control}</div>
    </div>
  );
}

// No Slider/Select primitives in @honk/ui yet — Menu + Button steppers stand in.
function NumberStepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.stepper)} role="group" aria-label={props.label}>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Decrease ${props.label}`}
        disabled={props.value <= props.min}
        onClick={() => {
          props.onChange(props.value - 1);
        }}
      >
        −
      </Button>
      <Text as="span" size="sm" family="mono" xstyle={styles.stepperValue}>
        {props.value}
      </Text>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Increase ${props.label}`}
        disabled={props.value >= props.max}
        onClick={() => {
          props.onChange(props.value + 1);
        }}
      >
        +
      </Button>
    </div>
  );
}

function ThemeSelect(props: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}): React.ReactElement {
  const label = THEME_OPTIONS.find((option) => option.value === props.value)?.label ?? "System";

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button size="sm" variant="outline" aria-label="Theme preference">
            {label}
          </Button>
        }
      />
      <Menu.Popup align="end">
        {THEME_OPTIONS.map((option) => (
          <Menu.Item
            key={option.value}
            onClick={() => {
              props.onChange(option.value);
            }}
          >
            {option.label}
          </Menu.Item>
        ))}
      </Menu.Popup>
    </Menu.Root>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────────────────────

function AppearancePanel(): React.ReactElement {
  const appearance = useAppearance();
  const isDirty =
    appearance.theme !== DEFAULT_APPEARANCE.theme ||
    appearance.tintHue !== DEFAULT_APPEARANCE.tintHue ||
    appearance.tintIntensity !== DEFAULT_APPEARANCE.tintIntensity ||
    appearance.uiFontSize !== DEFAULT_APPEARANCE.uiFontSize ||
    appearance.codeFontSize !== DEFAULT_APPEARANCE.codeFontSize;

  return (
    <>
      <div {...stylex.props(styles.sectionHeader)}>
        <Text as="p" size="lg" weight="semibold">
          Appearance
        </Text>
        {isDirty ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              appearanceActions.resetAll();
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>

      <div {...stylex.props(styles.rows)}>
        <SettingsRow
          title="Theme"
          description="Light, dark, or follow the system."
          resetAction={
            appearance.theme !== DEFAULT_APPEARANCE.theme ? (
              <SettingResetButton
                label="theme"
                onClick={() => {
                  appearanceActions.resetTheme();
                }}
              />
            ) : null
          }
          control={
            <ThemeSelect
              value={appearance.theme}
              onChange={(value) => {
                appearanceActions.setTheme(value);
              }}
            />
          }
        />

        <SettingsRow
          title="Tint Hue"
          description="Color family for the shell and accent."
          resetAction={
            appearance.tintHue !== DEFAULT_APPEARANCE.tintHue ? (
              <SettingResetButton
                label="tint hue"
                onClick={() => {
                  appearanceActions.resetTintHue();
                }}
              />
            ) : null
          }
          control={
            <div {...stylex.props(styles.stepper)}>
              <span {...stylex.props(styles.swatch)} aria-hidden />
              <NumberStepper
                label="Tint Hue"
                min={0}
                max={360}
                value={appearance.tintHue}
                onChange={(value) => {
                  appearanceActions.setTintHue(value);
                }}
              />
            </div>
          }
        />

        <SettingsRow
          title="Tint Intensity"
          description="Strength of the selected hue."
          resetAction={
            appearance.tintIntensity !== DEFAULT_APPEARANCE.tintIntensity ? (
              <SettingResetButton
                label="tint intensity"
                onClick={() => {
                  appearanceActions.resetTintIntensity();
                }}
              />
            ) : null
          }
          control={
            <NumberStepper
              label="Tint Intensity"
              min={0}
              max={100}
              value={appearance.tintIntensity}
              onChange={(value) => {
                appearanceActions.setTintIntensity(value);
              }}
            />
          }
        />

        <SettingsRow
          title="UI Font Size"
          description="Interface text size."
          resetAction={
            appearance.uiFontSize !== DEFAULT_APPEARANCE.uiFontSize ? (
              <SettingResetButton
                label="UI font size"
                onClick={() => {
                  appearanceActions.resetUiFontSize();
                }}
              />
            ) : null
          }
          control={
            <NumberStepper
              label="UI Font Size"
              min={11}
              max={16}
              value={appearance.uiFontSize}
              onChange={(value) => {
                appearanceActions.setUiFontSize(value);
              }}
            />
          }
        />

        <SettingsRow
          title="Code Font Size"
          description="Editor and diff text size."
          resetAction={
            appearance.codeFontSize !== DEFAULT_APPEARANCE.codeFontSize ? (
              <SettingResetButton
                label="code font size"
                onClick={() => {
                  appearanceActions.resetCodeFontSize();
                }}
              />
            ) : null
          }
          control={
            <NumberStepper
              label="Code Font Size"
              min={10}
              max={18}
              value={appearance.codeFontSize}
              onChange={(value) => {
                appearanceActions.setCodeFontSize(value);
              }}
            />
          }
        />

        <NotificationPermissionRow />
      </div>
    </>
  );
}

function NotificationPermissionRow(): React.ReactElement {
  const permission = useNotificationPermission();
  const supportText = buildNotificationSettingsSupportText(permission);
  const isGranted = permission === "granted";
  const canRequest = permission === "default";
  // Desktop auto-grants; the row still reflects granted so remote/web users see parity.
  const isDesktopShell =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-shell-platform") === "electron";

  return (
    <SettingsRow
      title="Desktop Notifications"
      description={
        isDesktopShell && isGranted ? "Enabled automatically in the desktop app." : supportText
      }
      isLast
      control={
        isGranted ? (
          <Text as="span" size="sm" tone="muted">
            On
          </Text>
        ) : canRequest ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void requestBrowserNotificationPermission();
            }}
          >
            Enable
          </Button>
        ) : (
          <Text as="span" size="sm" tone="faint">
            {permission === "denied"
              ? "Blocked"
              : permission === "insecure"
                ? "Unavailable"
                : "Unsupported"}
          </Text>
        )
      }
    />
  );
}

function GeneralPanel(): React.ReactElement {
  const appSettings = useAppSettings();
  const directory = appSettings.defaultProjectDirectory;
  const canChooseDirectory =
    typeof window !== "undefined" && window.desktopBridge?.pickFolder !== undefined;

  const choose = (): void => {
    void pickFolder(directory).then((path) => {
      if (path !== null) {
        appSettingsActions.setDefaultProjectDirectory(path);
      }
    });
  };

  return (
    <>
      <div {...stylex.props(styles.sectionHeader)}>
        <Text as="p" size="lg" weight="semibold">
          General
        </Text>
      </div>

      <div {...stylex.props(styles.rows)}>
        <SettingsRow
          title="Default project location"
          description={directory ?? "New threads start in the engine's own default folder."}
          resetAction={
            directory !== null ? (
              <SettingResetButton
                label="default project location"
                onClick={() => {
                  appSettingsActions.setDefaultProjectDirectory(null);
                }}
              />
            ) : null
          }
          control={
            canChooseDirectory ? (
              <Button size="sm" variant="secondary" onClick={choose}>
                Choose…
              </Button>
            ) : (
              <Text as="span" size="sm" tone="faint">
                Desktop only
              </Text>
            )
          }
        />

        <SettingsRow
          title="Thread titles"
          description="Named from the first prompt automatically — the engine keeps its placeholder otherwise."
          isLast
          control={
            <Text as="span" size="sm" tone="muted">
              Automatic
            </Text>
          }
        />
      </div>
    </>
  );
}

// ── Providers (Codex credentials; Claude is managed by the local Claude Code passthrough) ───

type ProvidersLoad =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly inventory: ProviderInventory };

// Per-provider in-flight UI state (which affordance is open / waiting).
type ProviderFlow =
  | { readonly kind: "apiKey" }
  | {
      readonly kind: "oauthInputs";
      readonly method: SidecarProviderAuthMethod;
      readonly inputs: Readonly<Record<string, string>>;
      readonly promptIndex: number;
    }
  | { readonly kind: "oauthStarting"; readonly methodLabel: string }
  | {
      readonly kind: "oauthCode";
      readonly methodIndex: number;
      readonly url: string;
      readonly instructions: string;
    }
  | { readonly kind: "oauthWaiting"; readonly instructions: string }
  | null;

function isProviderAuthPromptVisible(
  prompt: SidecarProviderAuthPrompt,
  inputs: Readonly<Record<string, string>>,
): boolean {
  if (prompt.when === undefined) {
    return true;
  }
  const current = inputs[prompt.when.key];
  if (current === undefined) {
    return false;
  }
  return prompt.when.op === "eq" ? current === prompt.when.value : current !== prompt.when.value;
}

function nextProviderAuthPromptIndex(
  method: SidecarProviderAuthMethod,
  start: number,
  inputs: Readonly<Record<string, string>>,
): number | null {
  for (let index = start; index < method.prompts.length; index += 1) {
    const prompt = method.prompts[index];
    if (prompt !== undefined && isProviderAuthPromptVisible(prompt, inputs)) {
      return index;
    }
  }
  return null;
}

function ProvidersPanel(): React.ReactElement {
  const [load, setLoad] = React.useState<ProvidersLoad>({ phase: "loading" });
  const [flows, setFlows] = React.useState<Readonly<Record<string, ProviderFlow>>>({});
  const loadSeq = React.useRef(0);

  const refresh = React.useCallback((): void => {
    const seq = ++loadSeq.current;
    const client = getBoundHonkClient();
    if (client === null) {
      setLoad({ phase: "error", message: "Not connected to the engine yet." });
      return;
    }
    setLoad({ phase: "loading" });
    void client
      .listProviders()
      .then((inventory) => {
        if (loadSeq.current === seq) {
          setLoad({ phase: "ready", inventory });
        }
      })
      .catch((error: unknown) => {
        if (loadSeq.current === seq) {
          setLoad({
            phase: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
  }, []);

  const kicked = React.useRef(false);
  const loadOnMount = React.useCallback(
    (node: HTMLDivElement | null): void => {
      if (node !== null && !kicked.current) {
        kicked.current = true;
        refresh();
      }
    },
    [refresh],
  );

  const setFlow = (providerId: string, flow: ProviderFlow): void => {
    setFlows((current) => ({ ...current, [providerId]: flow }));
  };
  const providers = load.phase === "ready" ? rankProviders(load.inventory.providers) : [];

  return (
    <>
      <div ref={loadOnMount} {...stylex.props(styles.sectionHeader)}>
        <Text as="p" size="lg" weight="semibold">
          Authentication
        </Text>
        <Button size="sm" variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      </div>

      {load.phase === "loading" ? (
        <Text as="p" size="sm" tone="muted">
          Loading providers…
        </Text>
      ) : load.phase === "error" ? (
        <div {...stylex.props(styles.rows)}>
          <Text as="p" size="sm" tone="muted">
            {load.message}
          </Text>
        </div>
      ) : (
        <div {...stylex.props(styles.rows)}>
          {providers.length === 0 ? (
            <Text as="p" size="sm" tone="muted">
              Codex authentication and Claude Code passthrough are unavailable from this engine.
            </Text>
          ) : (
            providers.map((provider, index) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                flow={flows[provider.id] ?? null}
                isLast={index === providers.length - 1}
                onFlowChange={(flow) => {
                  setFlow(provider.id, flow);
                }}
                onChanged={refresh}
              />
            ))
          )}
        </div>
      )}
    </>
  );
}

// Authentication mirrors the model surface: if no preset can route to a provider, settings must
// not offer credentials for it. First appearance in the preset table determines the stable order.
const AUTH_PROVIDER_IDS: readonly string[] = Array.from(
  new Set(PRESETS.map((preset) => preset.agentModel.providerID)),
);

function rankProviders(providers: readonly SidecarProvider[]): readonly SidecarProvider[] {
  return providers
    .filter((provider) => AUTH_PROVIDER_IDS.includes(provider.id))
    .sort((a, b) => {
      if (a.connected !== b.connected) {
        return a.connected ? -1 : 1;
      }
      return AUTH_PROVIDER_IDS.indexOf(a.id) - AUTH_PROVIDER_IDS.indexOf(b.id);
    });
}

function ProviderRow({
  provider,
  flow,
  isLast,
  onFlowChange,
  onChanged,
}: {
  readonly provider: SidecarProvider;
  readonly flow: ProviderFlow;
  readonly isLast: boolean;
  readonly onFlowChange: (flow: ProviderFlow) => void;
  readonly onChanged: () => void;
}): React.ReactElement {
  if (provider.id === "anthropic") {
    return (
      <SettingsRow
        title="Claude"
        description={
          provider.connected
            ? "Uses the Claude Code session on the machine running Honk. No Anthropic API key is stored in Honk."
            : "Claude Code passthrough is unavailable from this engine. Sign in with Claude Code on the host machine."
        }
        isLast={isLast}
        control={
          <Badge tone={provider.connected ? "ok" : "neutral"} size="sm">
            {provider.connected ? "Managed locally" : "Unavailable"}
          </Badge>
        }
      />
    );
  }

  return (
    <DirectProviderRow
      provider={provider}
      flow={flow}
      isLast={isLast}
      onFlowChange={onFlowChange}
      onChanged={onChanged}
    />
  );
}

function DirectProviderRow({
  provider,
  flow,
  isLast,
  onFlowChange,
  onChanged,
}: {
  readonly provider: SidecarProvider;
  readonly flow: ProviderFlow;
  readonly isLast: boolean;
  readonly onFlowChange: (flow: ProviderFlow) => void;
  readonly onChanged: () => void;
}): React.ReactElement {
  const keyInputRef = React.useRef<HTMLInputElement>(null);
  const codeInputRef = React.useRef<HTMLInputElement>(null);
  const promptInputRef = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  const oauthMethods = provider.authMethods.filter((method) => method.type === "oauth");
  const primaryOauthMethod = oauthMethods[0] ?? null;
  const hasOauth = oauthMethods.length > 0;
  // No advertised methods ≠ no auth: opencode's auth.set stores an API key for ANY provider,
  // so a methodless row still gets the key affordance.
  const hasApiKey =
    provider.authMethods.some((method) => method.type === "api") ||
    provider.authMethods.length === 0;

  const run = (work: () => Promise<void>): void => {
    setError(null);
    void work().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const saveApiKey = (): void => {
    const key = keyInputRef.current?.value.trim() ?? "";
    if (key.length === 0) {
      return;
    }
    run(async () => {
      const client = requireClient();
      await client.setProviderApiKey(provider.id, key);
      onFlowChange(null);
      onChanged();
    });
  };

  const startOauth = (
    method: SidecarProviderAuthMethod,
    inputs: Readonly<Record<string, string>>,
  ): void => {
    setError(null);
    onFlowChange({ kind: "oauthStarting", methodLabel: method.label });
    void (async () => {
      const client = requireClient();
      const authorization = await client.authorizeProviderOauth(provider.id, method.index, inputs);
      // The URL opens externally (the desktop host routes window.open to the OS browser).
      if (authorization.url.length > 0) {
        window.open(authorization.url, "_blank", "noopener");
      }
      if (authorization.method === "code") {
        onFlowChange({
          kind: "oauthCode",
          methodIndex: method.index,
          url: authorization.url,
          instructions: authorization.instructions,
        });
        return;
      }

      onFlowChange({ kind: "oauthWaiting", instructions: authorization.instructions });
      await client.completeProviderOauth(provider.id, method.index);
      onFlowChange(null);
      onChanged();
    })().catch((cause: unknown) => {
      onFlowChange(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const beginOauth = (method: SidecarProviderAuthMethod): void => {
    const inputs: Readonly<Record<string, string>> = {};
    const promptIndex = nextProviderAuthPromptIndex(method, 0, inputs);
    if (promptIndex === null) {
      startOauth(method, inputs);
      return;
    }
    setError(null);
    onFlowChange({ kind: "oauthInputs", method, inputs, promptIndex });
  };

  const submitOauthPrompt = (value: string): void => {
    if (flow?.kind !== "oauthInputs") {
      return;
    }
    const prompt = flow.method.prompts[flow.promptIndex];
    const normalized = value.trim();
    if (prompt === undefined || normalized.length === 0) {
      return;
    }
    const inputs = { ...flow.inputs, [prompt.key]: normalized };
    const promptIndex = nextProviderAuthPromptIndex(flow.method, flow.promptIndex + 1, inputs);
    if (promptIndex === null) {
      startOauth(flow.method, inputs);
      return;
    }
    onFlowChange({ ...flow, inputs, promptIndex });
  };

  const completeOauth = (): void => {
    if (flow?.kind !== "oauthCode") {
      return;
    }
    const code = codeInputRef.current?.value.trim() ?? "";
    if (code.length === 0) {
      return;
    }
    run(async () => {
      const client = requireClient();
      await client.completeProviderOauth(provider.id, flow.methodIndex, code);
      onFlowChange(null);
      onChanged();
    });
  };

  const disconnect = (): void => {
    run(async () => {
      const client = requireClient();
      await client.removeProviderAuth(provider.id);
      onFlowChange(null);
      onChanged();
    });
  };

  const description =
    error ??
    (flow?.kind === "oauthInputs"
      ? (flow.method.prompts[flow.promptIndex]?.message ?? `Continue with ${flow.method.label}.`)
      : flow?.kind === "oauthStarting"
        ? `Starting ${flow.methodLabel}…`
        : flow?.kind === "oauthCode"
          ? flow.instructions
          : flow?.kind === "oauthWaiting"
            ? flow.instructions
            : provider.connected
              ? "Connected."
              : hasOauth && hasApiKey
                ? "Choose a sign-in method or paste an API key."
                : hasOauth
                  ? "Choose a sign-in method."
                  : "Paste an API key.");

  const authPrompt =
    flow?.kind === "oauthInputs" ? (flow.method.prompts[flow.promptIndex] ?? null) : null;

  return (
    <SettingsRow
      title={provider.name}
      description={description}
      isLast={isLast}
      control={
        flow?.kind === "apiKey" ? (
          <>
            <input
              ref={keyInputRef}
              {...stylex.props(styles.credentialField)}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="API key…"
              aria-label={`${provider.name} API key`}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  saveApiKey();
                }
              }}
            />
            <Button size="sm" variant="primary" onClick={saveApiKey}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onFlowChange(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : flow?.kind === "oauthInputs" && authPrompt?.type === "text" ? (
          <>
            <input
              key={`${flow.method.index}:${authPrompt.key}`}
              ref={promptInputRef}
              {...stylex.props(styles.credentialField)}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={authPrompt.placeholder ?? "Required…"}
              aria-label={authPrompt.message}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitOauthPrompt(promptInputRef.current?.value ?? "");
                }
              }}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                submitOauthPrompt(promptInputRef.current?.value ?? "");
              }}
            >
              Continue
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onFlowChange(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : flow?.kind === "oauthInputs" && authPrompt?.type === "select" ? (
          <>
            <Menu.Root>
              <Menu.Trigger
                render={
                  <Button size="sm" variant="outline" aria-label={authPrompt.message}>
                    Choose…
                  </Button>
                }
              />
              <Menu.Popup align="end">
                {authPrompt.options.map((option) => (
                  <Menu.Item
                    key={option.value}
                    onClick={() => {
                      submitOauthPrompt(option.value);
                    }}
                  >
                    {option.label}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Root>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onFlowChange(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : flow?.kind === "oauthStarting" ? (
          <Text as="span" size="sm" tone="muted">
            Starting…
          </Text>
        ) : flow?.kind === "oauthCode" ? (
          <>
            <input
              ref={codeInputRef}
              {...stylex.props(styles.credentialField)}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste code…"
              aria-label={`${provider.name} authorization code`}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  completeOauth();
                }
              }}
            />
            <Button size="sm" variant="primary" onClick={completeOauth}>
              Complete
            </Button>
            {flow.url.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  window.open(flow.url, "_blank", "noopener");
                }}
              >
                Open page
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onFlowChange(null);
              }}
            >
              Cancel
            </Button>
          </>
        ) : flow?.kind === "oauthWaiting" ? (
          <Text as="span" size="sm" tone="muted">
            Waiting…
          </Text>
        ) : (
          <>
            {provider.connected ? (
              <>
                <Badge tone="ok" size="sm">
                  Connected
                </Badge>
                <Button size="sm" variant="ghost" onClick={disconnect}>
                  Disconnect
                </Button>
              </>
            ) : null}
            {oauthMethods.length === 1 && primaryOauthMethod !== null ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  beginOauth(primaryOauthMethod);
                }}
              >
                {primaryOauthMethod.label}
              </Button>
            ) : oauthMethods.length > 1 ? (
              <Menu.Root>
                <Menu.Trigger
                  render={
                    <Button size="sm" variant="secondary">
                      {provider.connected ? "Change login…" : "Sign in…"}
                    </Button>
                  }
                />
                <Menu.Popup align="end">
                  {oauthMethods.map((method) => (
                    <Menu.Item
                      key={method.index}
                      onClick={() => {
                        beginOauth(method);
                      }}
                    >
                      {method.label}
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Root>
            ) : null}
            {hasApiKey ? (
              <Button
                size="sm"
                variant={hasOauth ? "ghost" : "secondary"}
                onClick={() => {
                  onFlowChange({ kind: "apiKey" });
                }}
              >
                API key…
              </Button>
            ) : null}
          </>
        )
      }
    />
  );
}

function requireClient(): NonNullable<ReturnType<typeof getBoundHonkClient>> {
  const client = getBoundHonkClient();
  if (client === null) {
    throw new Error("Not connected to the engine yet.");
  }
  return client;
}

type ArchivedLoad =
  | { readonly phase: "loading" }
  | { readonly phase: "error"; readonly message: string }
  | { readonly phase: "ready"; readonly threads: readonly ThreadSummary[] };

function ArchivedPanel(): React.ReactElement {
  const [load, setLoad] = React.useState<ArchivedLoad>({ phase: "loading" });
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const loadSeq = React.useRef(0);

  const refresh = React.useCallback((): void => {
    const seq = ++loadSeq.current;
    const client = getBoundHonkClient();
    if (client === null) {
      setLoad({ phase: "error", message: "Not connected to the engine yet." });
      return;
    }
    setLoad({ phase: "loading" });
    void client.threads
      .listArchived()
      .then((threads) => {
        if (loadSeq.current === seq) {
          setLoad({ phase: "ready", threads });
        }
      })
      .catch((error: unknown) => {
        if (loadSeq.current === seq) {
          setLoad({
            phase: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
  }, []);

  const kicked = React.useRef(false);
  const loadOnMount = React.useCallback(
    (node: HTMLDivElement | null): void => {
      if (node !== null && !kicked.current) {
        kicked.current = true;
        refresh();
      }
    },
    [refresh],
  );

  const restore = (thread: ThreadSummary): void => {
    const client = getBoundHonkClient();
    if (client === null || pendingId !== null) {
      return;
    }
    setPendingId(String(thread.id));
    void client.threads
      .restoreAsCopy(thread.id)
      .then((restored) => {
        tabActions.open({
          key: String(restored.id),
          kind: "thread",
          title: restored.title,
          status: "idle",
          repository: { state: "loading" },
        });
      })
      .catch((error: unknown) => {
        setLoad({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        setPendingId(null);
      });
  };

  if (load.phase === "loading") {
    return (
      <div ref={loadOnMount}>
        <Text as="p" size="sm" tone="muted">
          Loading archived threads…
        </Text>
      </div>
    );
  }

  if (load.phase === "error") {
    return (
      <>
        <div {...stylex.props(styles.sectionHeader)}>
          <Text as="p" size="lg" weight="semibold">
            Archived
          </Text>
          <Button size="sm" variant="ghost" onClick={refresh}>
            Retry
          </Button>
        </div>
        <Text as="p" size="sm" tone="muted">
          {load.message}
        </Text>
      </>
    );
  }

  if (load.threads.length > 0) {
    return (
      <>
        <div {...stylex.props(styles.sectionHeader)}>
          <Text as="p" size="lg" weight="semibold">
            Archived
          </Text>
          <Button size="sm" variant="ghost" onClick={refresh}>
            Refresh
          </Button>
        </div>
        <div {...stylex.props(styles.rows)}>
          {load.threads.map((thread, index) => (
            <SettingsRow
              key={String(thread.id)}
              title={thread.title}
              description={`Archived ${formatArchivedAt(thread.archivedAt)}`}
              isLast={index === load.threads.length - 1}
              control={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pendingId !== null}
                  onClick={() => {
                    restore(thread);
                  }}
                >
                  {pendingId === String(thread.id) ? "Restoring…" : "Restore"}
                </Button>
              }
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <div {...stylex.props(styles.empty)}>
      <Icon icon={IconArchive1} size="lg" tone="faint" />
      <Text as="p" size="sm" weight="medium">
        No archived threads
      </Text>
      <Text as="p" size="xs" tone="faint">
        Archived threads will appear here.
      </Text>
    </div>
  );
}

function formatArchivedAt(value: string | null): string {
  if (value === null) {
    return "recently";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString();
}

// ── Page ─────────────────────────────────────────────────────────────────────────────────────

function parseSection(value: unknown): SettingsSectionId {
  if (
    value === "general" ||
    value === "providers" ||
    value === "appearance" ||
    value === "archived"
  ) {
    return value;
  }
  return DEFAULT_SETTINGS_SECTION;
}

function SettingsPage(): React.ReactElement {
  const navigate = useNavigate({ from: "/settings" });
  // Search is validated on the route; cast stays narrow to the section union.
  const search = useSearch({ from: "/settings" });
  const section = parseSection(search.section);

  return (
    <div {...stylex.props(styles.root)}>
      <nav {...stylex.props(styles.nav)} aria-label="Settings">
        <button
          type="button"
          aria-label="Back to home"
          {...stylex.props(styles.backRow)}
          onClick={() => {
            void navigate({ to: "/" });
          }}
        >
          <Icon icon={IconChevronLeftMedium} size="sm" />
          Back
        </button>
        <div {...stylex.props(styles.navList)}>
          {SETTINGS_SECTIONS.map((item) => {
            const active = item.id === section;
            return (
              <Link
                key={item.id}
                to="/settings"
                search={{ section: item.id }}
                aria-current={active ? "page" : undefined}
                {...stylex.props(styles.navLink, active && styles.navLinkActive)}
              >
                <Icon icon={item.icon} size="sm" tone="muted" />
                <Text as="span" size="sm" weight={active ? "medium" : "regular"}>
                  {item.label}
                </Text>
              </Link>
            );
          })}
        </div>
      </nav>

      <div {...stylex.props(styles.panel)}>
        <div {...stylex.props(styles.panelColumn)}>
          {section === "general" ? (
            <GeneralPanel />
          ) : section === "providers" ? (
            <ProvidersPanel />
          ) : section === "appearance" ? (
            <AppearancePanel />
          ) : (
            <ArchivedPanel />
          )}
        </div>
      </div>
    </div>
  );
}

export { SettingsPage };
