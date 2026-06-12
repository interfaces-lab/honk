import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import type * as Electron from "electron";

import * as DesktopEnvironment from "./desktop-environment";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as ElectronApp from "../electron/electron-app";
import * as ElectronTheme from "../electron/electron-theme";
import * as DesktopQuitGuard from "./desktop-quit-guard";
import * as DesktopState from "./desktop-state";
import * as DesktopWindow from "../window/desktop-window";

export interface DesktopShutdownShape {
  readonly request: Effect.Effect<void>;
  readonly awaitRequest: Effect.Effect<void>;
  readonly markComplete: Effect.Effect<void>;
  readonly awaitComplete: Effect.Effect<void>;
  readonly isComplete: Effect.Effect<boolean>;
}

export class DesktopShutdown extends Context.Service<DesktopShutdown, DesktopShutdownShape>()(
  "honk/desktop/Shutdown",
) {}

const makeShutdown = Effect.gen(function* () {
  const requested = yield* Deferred.make<void>();
  const completed = yield* Deferred.make<void>();
  const completedRef = yield* Ref.make(false);

  return DesktopShutdown.of({
    request: Deferred.succeed(requested, undefined).pipe(Effect.asVoid),
    awaitRequest: Deferred.await(requested),
    markComplete: Ref.set(completedRef, true).pipe(
      Effect.andThen(Deferred.succeed(completed, undefined)),
      Effect.asVoid,
    ),
    awaitComplete: Deferred.await(completed),
    isComplete: Ref.get(completedRef),
  });
});

export const layerShutdown = Layer.effect(DesktopShutdown, makeShutdown);

export type DesktopLifecycleRuntimeServices =
  | DesktopEnvironment.DesktopEnvironment
  | DesktopShutdown
  | DesktopQuitGuard.DesktopQuitGuard
  | DesktopState.DesktopState
  | DesktopWindow.DesktopWindow
  | ElectronApp.ElectronApp
  | ElectronTheme.ElectronTheme;

export interface DesktopLifecycleShape {
  readonly relaunch: (
    reason: string,
  ) => Effect.Effect<void, never, DesktopLifecycleRuntimeServices>;
  readonly register: Effect.Effect<void, never, Scope.Scope | DesktopLifecycleRuntimeServices>;
}

export class DesktopLifecycle extends Context.Service<DesktopLifecycle, DesktopLifecycleShape>()(
  "honk/desktop/Lifecycle",
) {}

const elog = EffectLogger.create({ service: "desktop-lifecycle" });

function addScopedListener(
  target: unknown,
  eventName: string,
  listener: (...args: readonly unknown[]) => void,
): Effect.Effect<void, never, Scope.Scope> {
  if (typeof target !== "object" || target === null) {
    return Effect.die(new Error("Expected event emitter target."));
  }

  const on = Reflect.get(target, "on");
  const removeListener = Reflect.get(target, "removeListener");
  if (typeof on !== "function" || typeof removeListener !== "function") {
    return Effect.die(new Error("Expected event emitter target."));
  }

  return Effect.acquireRelease(
    Effect.sync(() => {
      on.call(target, eventName, listener);
    }),
    () =>
      Effect.sync(() => {
        removeListener.call(target, eventName, listener);
      }),
  ).pipe(Effect.asVoid);
}

const requestDesktopShutdownAndWait = Effect.fn("desktop.lifecycle.requestShutdownAndWait")(
  function* (): Effect.fn.Return<void, never, DesktopShutdown> {
    const shutdown = yield* DesktopShutdown;
    yield* shutdown.request;
    yield* shutdown.awaitComplete;
  },
);

function triggerShutdown(
  runEffect: <A, E>(effect: Effect.Effect<A, E, DesktopLifecycleRuntimeServices>) => Promise<A>,
  reason: string,
): void {
  void runEffect(
    Effect.gen(function* () {
      const state = yield* DesktopState.DesktopState;
      yield* Ref.set(state.quitting, true);
      yield* elog.info(reason);
      const shutdown = yield* DesktopShutdown;
      yield* shutdown.request;
    }).pipe(Effect.withSpan(`desktop.lifecycle.${reason}`)),
  );
}

const requestQuitAfterPreventingDefault = Effect.fn(
  "desktop.lifecycle.requestQuitAfterPreventingDefault",
)(function* (runningThreadCount: number) {
  const quitGuard = yield* DesktopQuitGuard.DesktopQuitGuard;
  const confirmation = yield* quitGuard.confirmPreventedQuit(runningThreadCount);

  if (confirmation === "alreadyPrompting") {
    return;
  }

  if (confirmation === "canceled") {
    yield* elog.info("quit canceled because threads are still running", {
      runningThreadCount,
    });
    return;
  }

  const app = yield* ElectronApp.ElectronApp;
  const state = yield* DesktopState.DesktopState;
  yield* quitGuard.allowQuit;
  yield* Ref.set(state.quitting, true);
  const shutdown = yield* DesktopShutdown;
  if (runningThreadCount > 0) {
    yield* elog.info("quit confirmed with running threads", { runningThreadCount });
  } else {
    yield* elog.info("beforeQuit");
  }
  yield* shutdown.request;
  yield* app.quit;
});

function quitFromSignal(
  signal: "SIGINT" | "SIGTERM",
  runEffect: <A, E>(effect: Effect.Effect<A, E, DesktopLifecycleRuntimeServices>) => Promise<A>,
): void {
  void runEffect(
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({ signal });
      const electronApp = yield* ElectronApp.ElectronApp;
      const state = yield* DesktopState.DesktopState;
      const wasQuitting = yield* Ref.getAndSet(state.quitting, true);
      if (wasQuitting) return;
      yield* elog.info("process signal received", { signal });
      const shutdown = yield* DesktopShutdown;
      yield* shutdown.request;
      yield* electronApp.quit;
    }).pipe(Effect.withSpan("desktop.lifecycle.processSignal")),
  );
}

export const layer = Layer.succeed(
  DesktopLifecycle,
  DesktopLifecycle.of({
    relaunch: Effect.fn("desktop.lifecycle.relaunch")(function* (reason) {
      const electronApp = yield* ElectronApp.ElectronApp;
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      const state = yield* DesktopState.DesktopState;
      yield* elog.info("desktop relaunch requested", { reason });
      yield* Effect.gen(function* () {
        yield* Effect.yieldNow;
        yield* Ref.set(state.quitting, true);
        yield* requestDesktopShutdownAndWait();
        if (environment.isDevelopment) {
          yield* electronApp.exit(75);
          return;
        }
        yield* electronApp.relaunch({
          execPath: process.execPath,
          args: process.argv.slice(1),
        });
        yield* electronApp.exit(0);
      }).pipe(
        Effect.catchCause((cause) =>
          elog.error("desktop relaunch failed", {
            cause: Cause.pretty(cause),
          }),
        ),
        Effect.forkDetach,
        Effect.asVoid,
      );
    }),
    register: Effect.gen(function* () {
      const desktopWindow = yield* DesktopWindow.DesktopWindow;
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronTheme = yield* ElectronTheme.ElectronTheme;
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      const quitGuard = yield* DesktopQuitGuard.DesktopQuitGuard;
      const context = yield* Effect.context<DesktopLifecycleRuntimeServices>();
      const runEffect = Effect.runPromiseWith(context);
      const runSync = Effect.runSyncWith(context);
      yield* electronTheme.onUpdated(() => {
        void runEffect(
          desktopWindow.syncAppearance.pipe(Effect.withSpan("desktop.lifecycle.themeUpdated")),
        );
      });
      yield* electronApp.on("before-quit", (event) => {
        const quitEvent = event as Electron.Event;
        const decision = runSync(quitGuard.evaluateBeforeQuit);
        if (decision.type === "allow") {
          triggerShutdown(runEffect, decision.reason);
          return;
        }

        quitEvent.preventDefault();
        void runEffect(
          requestQuitAfterPreventingDefault(decision.runningThreadCount).pipe(
            Effect.withSpan("desktop.lifecycle.beforeQuit"),
          ),
        );
      });
      yield* electronApp.on("will-quit", () => {
        triggerShutdown(runEffect, "willQuit");
      });
      yield* electronApp.on("activate", () => {
        void runEffect(desktopWindow.activate.pipe(Effect.withSpan("desktop.lifecycle.activate")));
      });
      yield* electronApp.on("window-all-closed", () => {
        void runEffect(
          Effect.gen(function* () {
            const app = yield* ElectronApp.ElectronApp;
            const state = yield* DesktopState.DesktopState;
            if (environment.platform !== "darwin" && !(yield* Ref.get(state.quitting))) {
              yield* app.quit;
            }
          }).pipe(Effect.withSpan("desktop.lifecycle.windowAllClosed")),
        );
      });

      if (environment.platform !== "win32") {
        yield* addScopedListener(process, "SIGINT", () => {
          quitFromSignal("SIGINT", runEffect);
        });
        yield* addScopedListener(process, "SIGTERM", () => {
          quitFromSignal("SIGTERM", runEffect);
        });
      }
    }).pipe(Effect.withSpan("desktop.lifecycle.register")),
  }),
);
