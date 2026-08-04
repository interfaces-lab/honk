import * as React from "react";

import { Workspace } from "@honk/core/workspace";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { getHonkCoreEndpoint } from "./desktop-bridge";
import {
  V2ActionButton,
  V2_DEFAULT_DIRECTORY,
  V2_INPUT_STYLE,
  V2_LOG_ENTRY_STYLE,
  V2PageLayout,
} from "./v2-layout";

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
  const [directory, setDirectory] = React.useState(V2_DEFAULT_DIRECTORY);
  const [log, setLog] = React.useState<readonly LogEntry[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void getHonkCoreEndpoint().then((found) => {
      if (cancelled) return;
      setEndpoint(
        found === null ? { status: "missing" } : { status: "ready", baseUrl: found.baseUrl },
      );
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
    <V2PageLayout
      endpoint={
        <>
          {endpoint.status === "loading" && "Resolving…"}
          {endpoint.status === "missing" &&
            "Unavailable. Run inside the desktop app with a preload that exposes getHonkCoreEndpoint."}
          {endpoint.status === "ready" && `${endpoint.baseUrl}/rpc`}
        </>
      }
      directoryControl={
        <input
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          style={V2_INPUT_STYLE}
          spellCheck={false}
        />
      }
      actions={
        <>
          <V2ActionButton
            disabled={endpoint.status !== "ready"}
            onClick={() => {
              if (endpoint.status !== "ready") return;
              run("workspace.open", openWorkspace(endpoint.baseUrl, directory));
            }}
          >
            Open
          </V2ActionButton>
          <V2ActionButton
            disabled={endpoint.status !== "ready"}
            onClick={() => {
              if (endpoint.status !== "ready") return;
              run("workspace.trust", trustWorkspace(endpoint.baseUrl, directory));
            }}
          >
            Trust
          </V2ActionButton>
        </>
      }
      log={
        <>
          {log.length === 0 && <div style={{ opacity: 0.5, fontSize: 13 }}>No calls yet.</div>}
          {log.map((entry) => (
            <div key={entry.id} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontFamily: "monospace" }}>
                <span style={{ opacity: 0.5 }}>{entry.at}</span>{" "}
                <span style={{ color: entry.kind === "ok" ? "#3fb950" : "#f85149" }}>
                  {entry.label}
                </span>
              </div>
              <pre style={V2_LOG_ENTRY_STYLE}>{entry.detail}</pre>
            </div>
          ))}
        </>
      }
    />
  );
}
