// Boot / gate surfaces — the rewrite of the blank bootstrap + dead-end auth failure page
// (ui-parity onboarding-auth rethink). Structure from .design/wireframes/onboarding.html §A/C:
// centered splash for connecting; card with paste field for requires-auth; explicit failure
// with Retry for unreachable. Zero useEffect — connection lifecycle is connection-store.

import * as stylex from "@stylexjs/stylex";
import { Button, Matrix, Shell, StatusDot, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import { type ErrorComponentProps, useNavigate } from "@tanstack/react-router";
import * as React from "react";

import { useAppearanceTheme } from "./appearance-store";
import {
  actions as connectionActions,
  useConnection,
  type ConnectionSnapshot,
} from "./connection-store";
import { AppShell } from "./shell";

// ── Anatomy (named intrinsics — gate chrome, not identity vocabulary) ────────────────────────

const GATE_CARD_WIDTH = "320px";
// Splash brand geometry — the boot wordmark is a one-off larger than the prose ramp's 16px cap, so
// its size is a named intrinsic (like the gate card width), not a Text size step.
const SPLASH_WORDMARK_SIZE = "24px";
const SPLASH_GAP = "16px";
const FIELD_MIN_HEIGHT = "36px";
const DETAILS_MAX_HEIGHT = "12rem";
// The details panel bleeds out to the card's inner edge so its light background isn't double-inset
// (card padding + its own padding) from the outer border; its own padding then supplies the single
// text inset that lines up with the title and description above it.
const DETAILS_BLEED = `calc(-1 * ${spaceVars["--honk-space-panel-pad"]})`;
const HAIRLINE = "1px";
const FIELD_RING = `inset 0 0 0 ${HAIRLINE} ${colorVars["--honk-color-border-base"]}`;

const schemeStyles = stylex.create({
  system: { colorScheme: "light dark" },
  light: { colorScheme: "light" },
  dark: { colorScheme: "dark" },
});

const styles = stylex.create({
  center: {
    flexGrow: 1,
    display: "grid",
    placeItems: "center",
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
  },
  splash: {
    display: "grid",
    gap: SPLASH_GAP,
    justifyItems: "center",
    textAlign: "center",
  },
  // The boot wordmark: larger than the prose ramp so "honk" reads as a brand mark, not body text.
  wordmark: {
    fontSize: SPLASH_WORDMARK_SIZE,
    lineHeight: 1.1,
  },
  // The matrix glyph is honk's signature working mark; on the splash it carries the one brand-hue
  // moment (accent) instead of the muted smudge it read as before.
  splashGlyph: {
    color: colorVars["--honk-color-accent"],
  },
  card: {
    width: "100%",
    maxWidth: GATE_CARD_WIDTH,
    display: "grid",
    gap: spaceVars["--honk-space-panel-pad"],
    padding: spaceVars["--honk-space-panel-pad"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: elevationVars["--honk-elevation-raised"],
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  field: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: FIELD_MIN_HEIGHT,
    paddingBlock: controlVars["--honk-control-pad-sm"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-control"],
    boxShadow: FIELD_RING,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: HAIRLINE,
    outlineOffset: HAIRLINE,
    "::placeholder": {
      color: colorVars["--honk-color-text-muted"],
    },
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    alignItems: "center",
  },
  details: {
    maxHeight: DETAILS_MAX_HEIGHT,
    overflow: "auto",
    marginBlock: 0,
    marginInline: DETAILS_BLEED,
    paddingBlock: controlVars["--honk-control-pad-sm"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
    lineHeight: fontVars["--honk-leading-caption"],
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    textAlign: "start",
  },
  centerFill: {
    // Stage is a plain relative canvas; stretch so the gate centers in the full pane.
    alignSelf: "stretch",
    width: "100%",
  },
});

// ── Shared gate frame (Shell-compatible deep root; no tab strip until authenticated) ─────────

function GateFrame(props: {
  readonly children: React.ReactNode;
  readonly originChip?: string | null;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  const trailing = props.originChip ? (
    <span data-shell-no-drag="">
      <Text size="xs" tone="muted" family="mono">
        {props.originChip}
      </Text>
    </span>
  ) : undefined;
  return (
    <Shell xstyle={schemeStyles[theme]}>
      <Shell.TitleBar trailing={trailing} />
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.center, styles.centerFill)}>{props.children}</div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

function ConnectingSplash(props: {
  readonly origin: string | null;
  readonly label: string;
}): React.ReactElement {
  return (
    <GateFrame originChip={props.origin}>
      <div {...stylex.props(styles.splash)}>
        <Text size="xl" weight="semibold" xstyle={styles.wordmark}>
          honk
        </Text>
        <Matrix isActive grid={6} xstyle={styles.splashGlyph} />
        <Text size="sm" tone="muted">
          {props.label}
        </Text>
      </div>
    </GateFrame>
  );
}

function RequiresAuthCard(props: {
  readonly origin: string | null;
  readonly errorMessage: string | null;
}): React.ReactElement {
  // Uncontrolled input — submit reads the DOM value so we never need effect-synced state.
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    connectionActions.submitToken(inputRef.current?.value ?? "");
  };

  return (
    <GateFrame originChip={props.origin}>
      <form {...stylex.props(styles.card)} onSubmit={onSubmit}>
        <Text size="lg" weight="semibold">
          honk
        </Text>
        <Text size="sm" tone="muted">
          {props.errorMessage ??
            "This Core is running. Paste a pairing link from the desktop app to attach this browser."}
        </Text>
        <input
          ref={inputRef}
          {...stylex.props(styles.field)}
          type="text"
          name="pairing-token"
          autoComplete="off"
          spellCheck={false}
          placeholder="paste pairing link or token…"
          aria-label="Pairing link or token"
        />
        <div {...stylex.props(styles.actions)}>
          <Button type="submit" variant="primary" size="sm">
            Attach
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
        </div>
      </form>
    </GateFrame>
  );
}

function UnreachableCard(props: {
  readonly origin: string | null;
  readonly errorMessage: string | null;
}): React.ReactElement {
  return (
    <GateFrame originChip={props.origin}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.titleRow)}>
          <StatusDot tone="err" />
          <Text size="base" weight="semibold">
            Couldn&apos;t reach your Core
          </Text>
        </div>
        <Text size="sm" tone="muted">
          {props.errorMessage ??
            "Check that the Core is running, then retry. If you have a pairing link, you can also paste it after the Core is back."}
        </Text>
        <div {...stylex.props(styles.actions)}>
          <Button type="button" variant="primary" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
        </div>
      </div>
    </GateFrame>
  );
}

function GateByStatus(props: { readonly connection: ConnectionSnapshot }): React.ReactElement {
  switch (props.connection.status) {
    case "connecting":
      return (
        <ConnectingSplash
          origin={props.connection.origin}
          label="Connecting to your Core"
        />
      );
    case "requires-auth":
      return (
        <RequiresAuthCard
          origin={props.connection.origin}
          errorMessage={props.connection.errorMessage}
        />
      );
    case "unreachable":
      return (
        <UnreachableCard
          origin={props.connection.origin}
          errorMessage={props.connection.errorMessage}
        />
      );
    case "authenticated":
      // RootGate never renders this branch — authenticated mounts AppShell.
      return (
        <ConnectingSplash origin={props.connection.origin} label="Connected" />
      );
  }
}

/**
 * Root route component: gate until authenticated, then the real shell + outlet.
 * Reads the connection store via useSyncExternalStore (no effects).
 */
export function RootGate(): React.ReactElement {
  const connection = useConnection();
  if (connection.status === "authenticated") {
    return <AppShell />;
  }
  return <GateByStatus connection={connection} />;
}

// ── Router error / not-found (parity keep, restyled on @honk/ui) ─────────────────────────────

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details = error.stack ?? error.message;
    return details.trim().length > 0 ? details : "No additional error details are available.";
  }
  if (typeof error === "string") {
    return error.trim().length > 0 ? error : "No additional error details are available.";
  }
  try {
    const details = JSON.stringify(error, null, 2);
    if (typeof details === "string" && details.trim().length > 0) {
      return details;
    }
    return "No additional error details are available.";
  } catch {
    return "No additional error details are available.";
  }
}

async function copyText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    return;
  }
  await navigator.clipboard.writeText(value);
}

function StatusCard(props: {
  readonly title: string;
  readonly description: string;
  readonly details?: string;
  readonly actions: React.ReactNode;
}): React.ReactElement {
  const theme = useAppearanceTheme();
  return (
    <Shell xstyle={schemeStyles[theme]}>
      <Shell.TitleBar />
      <Shell.Stage>
        <Shell.Sheet>
          <div {...stylex.props(styles.center, styles.centerFill)}>
            <div {...stylex.props(styles.card)}>
              <Text size="base" weight="semibold" align="center">
                {props.title}
              </Text>
              <Text size="sm" tone="muted" align="center">
                {props.description}
              </Text>
              {props.details ? (
                <pre {...stylex.props(styles.details)}>{props.details}</pre>
              ) : null}
              <div {...stylex.props(styles.actions)}>{props.actions}</div>
            </div>
          </div>
        </Shell.Sheet>
      </Shell.Stage>
    </Shell>
  );
}

export function RootErrorView({ error }: ErrorComponentProps): React.ReactElement {
  const details = errorDetails(error);
  // Local UI flag for the copy button label — set from the click handler, not an effect.
  const [copied, setCopied] = React.useState(false);

  return (
    <StatusCard
      title="Something went wrong"
      description="An unexpected error occurred. Retry the connection or reload the window."
      details={details}
      actions={
        <>
          <Button type="button" variant="primary" size="sm" onClick={connectionActions.retry}>
            Retry
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void copyText(details).then(() => {
                setCopied(true);
              });
            }}
          >
            {copied ? "Copied" : "Copy error"}
          </Button>
        </>
      }
    />
  );
}

export function RootNotFoundView(): React.ReactElement {
  const navigate = useNavigate();
  return (
    <StatusCard
      title="Page not found"
      description="The requested page could not be found."
      actions={
        <>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              void navigate({ to: "/", replace: true });
            }}
          >
            Go home
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </>
      }
    />
  );
}
