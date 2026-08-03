import type { Effect } from "effect";
import type { Rpc } from "effect/unstable/rpc";

// Every service method type derives from its Rpc so the service cannot drift
// from the wire contract; the Rpc definitions in each module stay the single
// source of truth. The Rpc.Any constraint does not widen anything: callers
// instantiate with a concrete Rpc, and the extractors infer from that type.
export type Method<R extends Rpc.Any> = (
  input: Rpc.Payload<R>,
) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>>;
