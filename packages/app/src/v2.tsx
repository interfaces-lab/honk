import * as React from "react";

import { Workspace } from "@honk/core/workspace";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { getHonkCoreEndpoint } from "./desktop-bridge";

export const V2_PATH = "/v2";

// One scoped client per call: the page exercises the wire contract end to end
// (fetch -> RPC serialization -> schema decode -> typed errors), so per-call
// setup cost is irrelevant and no app runtime plumbing is required.
function protocolLayer(baseUrl: string) {
  return RpcClient.layerProtocolHttp({ url: `${baseUrl}/rpc` }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson),
  );
}

function openWorkspace(baseUrl: string, directory: string) {
  return Effect.gen(function* () {
    const client = yield* RpcClient.make(Workspace.Rpcs);
    return yield* client["workspace.open"]({ directory });
  }).pipe(Effect.scoped, Effect.provide(protocolLayer(baseUrl)));
}

function trustWorkspace(baseUrl: string, directory: string) {
  return Effect.gen(function* () {
    const client = yield* RpcClient.make(Workspace.Rpcs);
    yield* client["workspace.trust"]({ directory });
    return { trusted: directory };
  }).pipe(Effect.scoped, Effect.provide(protocolLayer(baseUrl)));
}

function describeError(error: unknown): string {
  if (error instanceof Workspace.OpenError || error instanceof Workspace.TrustError) {
    return `${error._tag} [${error.code}] ${error.message} directory=${error.directory}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

type LogEntry = {
  readonly id: number;
  readonly at: string;
  readonly label: string;
  readonly kind: "ok" | "error";
  readonly detail: string;
};

type Endpoint =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly baseUrl: string };

let nextLogId = 1;

export function V2Page(): React.ReactElement {
  const [endpoint, setEndpoint] = React.useState<Endpoint>({ status: "loading" });
  const [directory, setDirectory] = React.useState("/tmp/honk-core-demo");
  const [log, setLog] = React.useState<readonly LogEntry[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void getHonkCoreEndpoint().then((found) => {
      if (cancelled) return;
      setEndpoint(found === null ? { status: "missing" } : { status: "ready", baseUrl: found.baseUrl });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const append = (label: string, kind: LogEntry["kind"], detail: string) => {
    const entry: LogEntry = {
      id: nextLogId++,
      at: new Date().toLocaleTimeString(),
      label,
      kind,
      detail,
    };
    setLog((entries) => [entry, ...entries].slice(0, 50));
  };

  const run = (label: string, program: Effect.Effect<unknown, unknown>) => {
    void Effect.runPromise(
      program.pipe(
        Effect.match({
          onSuccess: (value) => ({ kind: "ok" as const, detail: JSON.stringify(value, null, 2) }),
          onFailure: (error) => ({ kind: "error" as const, detail: describeError(error) }),
        }),
      ),
    ).then(
      (outcome) => append(label, outcome.kind, outcome.detail),
      (defect: unknown) => append(label, "error", `defect: ${describeError(defect)}`),
    );
  };

  return (
    <div style={pageStyle}>
      <header>
        <h1 style={{ margin: 0, fontSize: 18 }}>Honk Core v2</h1>
        <p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: 13 }}>
          Manual harness for the workspace RPC group served by the desktop main process.
        </p>
      </header>

      <section style={cardStyle}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Endpoint</div>
        <div style={{ fontFamily: "monospace", fontSize: 13 }}>
          {endpoint.status === "loading" && "Resolving…"}
          {endpoint.status === "missing" &&
            "Unavailable. Run inside the desktop app with a preload that exposes getHonkCoreEndpoint."}
          {endpoint.status === "ready" && `${endpoint.baseUrl}/rpc`}
        </div>
      </section>

      <section style={cardStyle}>
        <label style={{ display: "block", fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
          Workspace directory (absolute; relative input reproduces the typed OpenError)
        </label>
        <input
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          style={inputStyle}
          spellCheck={false}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            type="button"
            style={buttonStyle}
            disabled={endpoint.status !== "ready"}
            onClick={() => {
              if (endpoint.status !== "ready") return;
              run("workspace.open", openWorkspace(endpoint.baseUrl, directory));
            }}
          >
            Open
          </button>
          <button
            type="button"
            style={buttonStyle}
            disabled={endpoint.status !== "ready"}
            onClick={() => {
              if (endpoint.status !== "ready") return;
              run("workspace.trust", trustWorkspace(endpoint.baseUrl, directory));
            }}
          >
            Trust
          </button>
        </div>
      </section>

      <section style={{ ...cardStyle, flex: 1, overflow: "auto" }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Log (newest first)</div>
        {log.length === 0 && <div style={{ opacity: 0.5, fontSize: 13 }}>No calls yet.</div>}
        {log.map((entry) => (
          <div key={entry.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontFamily: "monospace" }}>
              <span style={{ opacity: 0.5 }}>{entry.at}</span>{" "}
              <span style={{ color: entry.kind === "ok" ? "#3fb950" : "#f85149" }}>
                {entry.label}
              </span>
            </div>
            <pre style={preStyle}>{entry.detail}</pre>
          </div>
        ))}
      </section>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  height: "100%",
  boxSizing: "border-box",
  overflow: "auto",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid color-mix(in srgb, currentColor 15%, transparent)",
  borderRadius: 8,
  padding: 12,
};

const inputStyle: React.CSSProperties = {
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

const buttonStyle: React.CSSProperties = {
  fontSize: 13,
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid color-mix(in srgb, currentColor 25%, transparent)",
  background: "color-mix(in srgb, currentColor 8%, transparent)",
  color: "inherit",
  cursor: "pointer",
};

const preStyle: React.CSSProperties = {
  margin: "2px 0 0",
  fontSize: 12,
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  opacity: 0.9,
};
