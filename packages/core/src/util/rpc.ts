import type { Effect } from "effect";
import type { Rpc } from "effect/unstable/rpc";

// Every service method type derives from its Rpc so the service cannot drift
// from the wire contract; the Rpc definitions in each module stay the single
// source of truth. The Rpc.Any constraint does not widen anything: callers
// instantiate with a concrete Rpc, and the extractors infer from that type.
export type Method<R extends Rpc.Any> = (
  input: Rpc.Payload<R>,
) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>>;

// A whole service interface derived from a module's `commands` record: one
// method per command, each typed by its Rpc. Modules declare the record once
// and derive their Interface from it, so adding a command cannot leave the
// service shape behind. Stream commands are not request/response methods and
// stay declared by hand next to the derived part.
export type ServiceOf<Commands extends Record<string, Rpc.Any>> = {
  readonly [K in keyof Commands]: Method<Commands[K]>;
};
