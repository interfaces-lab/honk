import * as React from "react";

export const V2_PATH = "/v2";
export const V2_DEFAULT_DIRECTORY = "/tmp/honk-core-demo";

const V2_PAGE_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  height: "100%",
  boxSizing: "border-box",
  overflow: "auto",
};

const V2_CARD_STYLE: React.CSSProperties = {
  border: "1px solid color-mix(in srgb, currentColor 15%, transparent)",
  borderRadius: 8,
  padding: 12,
};

export const V2_INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "monospace",
  fontSize: 13,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
  background: "transparent",
  color: "inherit",
};

const V2_BUTTON_STYLE: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
  background: "color-mix(in srgb, currentColor 8%, transparent)",
  color: "inherit",
  cursor: "pointer",
};

type V2ActionButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "style" | "type"
> & {
  readonly children: React.ReactNode;
};

export function V2ActionButton({ children, ...props }: V2ActionButtonProps): React.ReactElement {
  return (
    <button {...props} type="button" style={V2_BUTTON_STYLE}>
      {children}
    </button>
  );
}

export const V2_LOG_ENTRY_STYLE: React.CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12,
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  opacity: 0.9,
};

type V2PageLayoutProps = {
  readonly actions: React.ReactNode;
  readonly busy?: boolean;
  readonly directoryControl: React.ReactNode;
  readonly endpoint: React.ReactNode;
  readonly log: React.ReactNode;
};

export function V2PageLayout(props: V2PageLayoutProps): React.ReactElement {
  return (
    <div aria-busy={props.busy || undefined} style={V2_PAGE_STYLE}>
      <header>
        <h1 style={{ margin: 0, fontSize: 18 }}>Honk Core v2</h1>
        <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: 13 }}>
          Manual harness for the workspace RPC group served by the desktop main process.
        </p>
      </header>

      <section style={V2_CARD_STYLE}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Endpoint</div>
        <div style={{ fontFamily: "monospace", fontSize: 13 }}>{props.endpoint}</div>
      </section>

      <section style={V2_CARD_STYLE}>
        <label style={{ display: "block", fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
          Workspace directory (absolute; relative input reproduces the typed OpenError)
        </label>
        {props.directoryControl}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>{props.actions}</div>
      </section>

      <section style={{ ...V2_CARD_STYLE, flex: 1, overflow: "auto" }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Log (newest first)</div>
        {props.log}
      </section>
    </div>
  );
}
