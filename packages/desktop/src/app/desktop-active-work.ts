import type { DesktopActiveWorkState } from "@honk/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface DesktopActiveWorkShape {
  readonly get: Effect.Effect<DesktopActiveWorkState>;
  readonly set: (state: DesktopActiveWorkState) => Effect.Effect<void>;
}

export class DesktopActiveWork extends Context.Service<DesktopActiveWork, DesktopActiveWorkShape>()(
  "honk/desktop/ActiveWork",
) {}

export const layer = Layer.effect(
  DesktopActiveWork,
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<DesktopActiveWorkState>({
      runningThreadCount: 0,
    });

    return DesktopActiveWork.of({
      get: Ref.get(stateRef),
      set: (state) => Ref.set(stateRef, state),
    });
  }),
);
