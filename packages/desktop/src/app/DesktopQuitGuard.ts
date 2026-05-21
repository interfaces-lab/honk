import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ElectronDialog from "../electron/ElectronDialog";
import * as DesktopActiveWork from "./DesktopActiveWork";
import * as DesktopState from "./DesktopState";

export type DesktopBeforeQuitDecision =
  | {
      readonly type: "allow";
      readonly reason: "beforeQuit" | "beforeQuitAlreadyQuitting";
    }
  | {
      readonly type: "prevent";
      readonly runningThreadCount: number;
    };

export type DesktopQuitConfirmation = "confirmed" | "canceled" | "alreadyPrompting";

export interface DesktopQuitGuardShape {
  readonly evaluateBeforeQuit: Effect.Effect<DesktopBeforeQuitDecision>;
  readonly confirmPreventedQuit: (
    runningThreadCount: number,
  ) => Effect.Effect<DesktopQuitConfirmation>;
  readonly allowQuit: Effect.Effect<void>;
}

export class DesktopQuitGuard extends Context.Service<DesktopQuitGuard, DesktopQuitGuardShape>()(
  "multi/desktop/QuitGuard",
) {}

const confirmQuitWithRunningThreads = Effect.fn("desktop.quitGuard.confirmRunningThreads")(
  function* (
    electronDialog: ElectronDialog.ElectronDialogShape,
    runningThreadCount: number,
  ): Effect.fn.Return<boolean> {
    const pronoun = runningThreadCount === 1 ? "its" : "their";
    const result = yield* electronDialog.showMessageBox({
      type: "warning",
      buttons: ["Keep Running", "Quit Anyway"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: runningThreadCount === 1 ? "Thread is still running" : "Threads are still running",
      message:
        runningThreadCount === 1
          ? "A thread is still running."
          : `${runningThreadCount} threads are still running.`,
      detail: `Quitting now will stop ${pronoun} current work.`,
    });
    return result.response === 1;
  },
);

export const layer = Layer.effect(
  DesktopQuitGuard,
  Effect.gen(function* () {
    const desktopActiveWork = yield* DesktopActiveWork.DesktopActiveWork;
    const desktopState = yield* DesktopState.DesktopState;
    const electronDialog = yield* ElectronDialog.ElectronDialog;
    const quitAllowed = yield* Ref.make(false);
    const quitPromptOpen = yield* Ref.make(false);

    return DesktopQuitGuard.of({
      evaluateBeforeQuit: Effect.gen(function* () {
        if (yield* Ref.get(quitAllowed)) {
          return { type: "allow", reason: "beforeQuit" } as const;
        }

        if (yield* Ref.get(desktopState.quitting)) {
          return { type: "allow", reason: "beforeQuitAlreadyQuitting" } as const;
        }

        const activeWork = yield* desktopActiveWork.get;
        if (activeWork.runningThreadCount <= 0) {
          return { type: "allow", reason: "beforeQuit" } as const;
        }

        return {
          type: "prevent",
          runningThreadCount: activeWork.runningThreadCount,
        } as const;
      }),
      confirmPreventedQuit: Effect.fn("desktop.quitGuard.confirmPreventedQuit")(
        function* (runningThreadCount) {
          if (runningThreadCount <= 0) {
            return "confirmed";
          }

          const promptAlreadyOpen = yield* Ref.getAndSet(quitPromptOpen, true);
          if (promptAlreadyOpen) {
            return "alreadyPrompting";
          }

          const confirmed = yield* confirmQuitWithRunningThreads(
            electronDialog,
            runningThreadCount,
          ).pipe(Effect.ensuring(Ref.set(quitPromptOpen, false)));

          return confirmed ? "confirmed" : "canceled";
        },
      ),
      allowQuit: Ref.set(quitAllowed, true),
    });
  }),
);
