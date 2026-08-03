import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface DesktopAuxEndpointSnapshot {
  readonly baseUrl: string;
  readonly bearer: string;
}

export interface DesktopAuxEndpointShape {
  readonly get: Effect.Effect<DesktopAuxEndpointSnapshot | null>;
  readonly set: (snapshot: DesktopAuxEndpointSnapshot | null) => Effect.Effect<void>;
}

export class DesktopAuxEndpoint extends Context.Service<
  DesktopAuxEndpoint,
  DesktopAuxEndpointShape
>()("honk/desktop/AuxEndpoint") {}

export const layer = Layer.effect(
  DesktopAuxEndpoint,
  Effect.gen(function* () {
    const snapshot = yield* Ref.make<DesktopAuxEndpointSnapshot | null>(null);
    return {
      get: Ref.get(snapshot),
      set: (nextSnapshot) => Ref.set(snapshot, nextSnapshot),
    };
  }),
);
