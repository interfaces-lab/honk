import { Context, Effect, Layer, Path, Ref, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import type { Method } from "./util/rpc";

export const WorkspaceId = Schema.NonEmptyString.pipe(Schema.brand("WorkspaceId")).annotate({
  identifier: "WorkspaceId",
});
export type WorkspaceId = typeof WorkspaceId.Type;

export const WorkspaceDirectory = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceDirectory"),
).annotate({ identifier: "WorkspaceDirectory" });
export type WorkspaceDirectory = typeof WorkspaceDirectory.Type;

const TrustRequired = Schema.Struct({
  type: Schema.tag("trust_required"),
  directory: WorkspaceDirectory,
});

const Ready = Schema.Struct({
  type: Schema.tag("ready"),
  id: WorkspaceId,
  directory: WorkspaceDirectory,
});

// Annotate before toTaggedUnion: annotate rebuilds the union, which would drop
// the attached cases/guards/match utilities.
export const OpenResult = Schema.Union([TrustRequired, Ready])
  .annotate({ identifier: "WorkspaceOpenResult" })
  .pipe(Schema.toTaggedUnion("type"));
export type OpenResult = typeof OpenResult.Type;

export class OpenError extends Schema.TaggedErrorClass<OpenError>()("WorkspaceOpenError", {
  code: Schema.tag("workspace.open_failed"),
  message: Schema.tag("Honk could not open this workspace."),
  directory: Schema.NonEmptyString,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class TrustError extends Schema.TaggedErrorClass<TrustError>()("WorkspaceTrustError", {
  code: Schema.tag("workspace.trust_failed"),
  message: Schema.tag("Honk could not trust this workspace."),
  directory: Schema.NonEmptyString,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export type Error = OpenError | TrustError;

// Rpc definitions are consts; only the RpcGroup below uses class-extends so
// handlers and clients can reference one nominal group type.
export const Open = Rpc.make("workspace.open", {
  payload: { directory: Schema.NonEmptyString },
  success: OpenResult,
  error: OpenError,
});

export const Trust = Rpc.make("workspace.trust", {
  payload: { directory: Schema.NonEmptyString },
  error: TrustError,
});

export class Rpcs extends RpcGroup.make(Open, Trust) {}

export interface Interface {
  readonly open: Method<typeof Open>;
  readonly trust: Method<typeof Trust>;
}

export class Service extends Context.Service<Service, Interface>()("honk/Workspace") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    // In-memory trust store for the first experiment slice; persistence moves
    // to the host data directory with the writer lease.
    const trusted = yield* Ref.make<ReadonlyMap<WorkspaceDirectory, WorkspaceId>>(new Map());

    const open = Effect.fn("Workspace.open")(function* (input: Rpc.Payload<typeof Open>) {
      const directory = resolveDirectory(path, input.directory);
      if (!directory) return yield* new OpenError({ directory: input.directory });
      const id = (yield* Ref.get(trusted)).get(directory);
      if (!id) return { type: "trust_required", directory } satisfies OpenResult;
      return { type: "ready", id, directory } satisfies OpenResult;
    });

    const trust = Effect.fn("Workspace.trust")(function* (input: Rpc.Payload<typeof Trust>) {
      const directory = resolveDirectory(path, input.directory);
      if (!directory) return yield* new TrustError({ directory: input.directory });
      // Mint outside Ref.update so the update function stays pure; the fresh
      // id is simply unused when the directory is already trusted.
      const id = mintWorkspaceId();
      yield* Ref.update(trusted, (map) =>
        map.has(directory) ? map : new Map(map).set(directory, id),
      );
    });

    return Service.of({ open, trust });
  }),
);

// POSIX path rules for tests and browser-adjacent hosts. Node hosts provide
// their platform Path service (for example NodePath.layer) instead.
export const defaultLayer = layer.pipe(Layer.provide(Path.layer));

// Handlers stay thin: decode happened at the RPC boundary, so they only bind
// payloads to the service. Provide `layer` to satisfy the Service requirement.
export const rpcLayer = Rpcs.toLayer(
  Effect.gen(function* () {
    const workspace = yield* Service;
    return {
      "workspace.open": (payload) => workspace.open(payload),
      "workspace.trust": (payload) => workspace.trust(payload),
    };
  }),
);

// A workspace identity needs one canonical absolute path; relative input has
// no canonical form the core could safely resolve on the caller's behalf.
// `.make` is the type-side constructor for trusted values; decode is reserved
// for untrusted encoded input at the RPC boundary.
function resolveDirectory(path: Path.Path, input: string) {
  if (!path.isAbsolute(input)) return undefined;
  return WorkspaceDirectory.make(path.resolve(input));
}

function mintWorkspaceId() {
  return WorkspaceId.make(crypto.randomUUID());
}

// Extensionless on purpose: consumers bundle this source (desktop keeps
// @honk/core in devDependencies so electron-vite bundles it), and consumer
// tsconfigs do not enable allowImportingTsExtensions.
// oxlint-disable-next-line import/no-self-import -- spec/effect.md self-reexport pattern; star imports are banned for consumers.
export * as Workspace from "./workspace";
