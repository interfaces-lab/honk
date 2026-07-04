import { Effect, Layer, Option } from "effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { makeAuth } from "./auth";
import { claudeCodeProbe, makeClaudeHarness } from "./claude";
import { makeCheckpoints } from "./checkpoint";
import { makeCore } from "./core";
import { cursorProbe, makeCursorHarness } from "./cursor";
import { claimDiscovery, clearDiscoveryIfOwn, probeCore } from "./discovery";
import { resolveCoreHome } from "./home";
import { makePiHarness } from "./pi";
import { boundPort, makeServerLayer } from "./server";
import { makeSessions } from "./session";
import { makeTerminals } from "./terminal";

interface CliArgs {
  readonly serve: boolean;
  readonly port: number | undefined;
  readonly home: string | undefined;
}

const parseArgs = (argv: Array<string>): CliArgs => {
  let serve = false;
  let port: number | undefined;
  let home: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "serve") serve = true;
    else if (arg === "--port") port = Number(argv[++index]);
    else if (arg === "--home") home = argv[++index];
  }
  return { serve, port, home };
};

/**
 * Discover-or-start (ADR 0002). The order matters everywhere here:
 * boot = probe (fast path) -> crash-recovery sweep -> bind -> exclusive
 * discovery claim (O_EXCL beats the probe's TOCTOU; losing the claim means
 * another Core won the race and we exit). Teardown runs finalizers in
 * reverse: goodbye + discovery clear first (clients learn shutdown while the
 * socket still lives), then the HTTP server stops, and core.dispose (fiber
 * interrupts + store close) runs dead last so no request touches a closed
 * database. `serve` is the explicit long-lived mode; bearer sessions apply
 * to every non-health endpoint.
 */
const program = Effect.scoped(
  Effect.gen(function* () {
    const args = parseArgs(process.argv.slice(2));
    const home = resolveCoreHome(args.home);
    const existing = yield* Effect.promise(() => probeCore(home.discoveryPath));
    if (Option.isSome(existing)) {
      yield* Effect.log(
        `Core already running at ${existing.value.origin} (pid ${existing.value.pid})`,
      );
      return;
    }

    // Explicit wiring, visible here: the auth domain first (it owns THE
    // AuthStorage instance and the harness probes), then the three arms
    // constructed over it (ADR 0016: one Harness per Provider).
    const auth = makeAuth(home, { "claude-code": claudeCodeProbe, cursor: cursorProbe });
    const checkpoints = makeCheckpoints();
    const core = makeCore(
      home,
      auth,
      {
        "openai-codex": makePiHarness({ piDir: home.piDir, storage: auth.storage }),
        anthropic: makeClaudeHarness({ claudeDir: home.claudeDir }),
        cursor: makeCursorHarness({
          cursorDir: home.cursorDir,
          apiKey: () => {
            const credential = auth.storage.get("cursor");
            return credential !== undefined &&
              credential.type === "api_key" &&
              typeof credential.key === "string" &&
              credential.key !== ""
              ? credential.key
              : null;
          },
        }),
      },
      checkpoints,
    );
    let coreOrigin: string | null = null;
    const sessions = makeSessions(home, core.store, () => coreOrigin);
    const terminals = makeTerminals();
    yield* Effect.addFinalizer(() =>
      terminals
        .dispose()
        .pipe(Effect.catchCause((cause) => Effect.logError("terminal dispose failed", cause))),
    );
    yield* Effect.addFinalizer(() =>
      core
        .dispose()
        .pipe(Effect.catchCause((cause) => Effect.logError("core dispose failed", cause))),
    );
    yield* core.recover();
    // Boot probe (grill decision: probe at boot, serve cached): the first
    // snapshot forks the harness probes so the first picker read is warm.
    yield* core.auth.snapshot();
    yield* Effect.logInfo("core boot", {
      storePath: home.dbPath,
      harnesses: ["openai-codex", "anthropic", "cursor"],
    });

    const serverLayer = makeServerLayer(core, sessions, terminals, {
      port: args.port ?? (args.serve ? 4923 : 0),
    });
    const discoveryLayer = Layer.effectDiscard(
      Effect.acquireRelease(
        Effect.gen(function* () {
          const port = yield* boundPort;
          coreOrigin = `http://127.0.0.1:${port}`;
          const claim = claimDiscovery(home.discoveryPath, {
            version: 2,
            apiVersion: "core/v1",
            pid: process.pid,
            port,
            origin: coreOrigin,
            startedAt: core.startedAt,
          });
          if (claim._tag === "lost") {
            const winner = Option.isSome(claim.existing)
              ? `pid ${claim.existing.value.pid} at ${claim.existing.value.origin}`
              : "an unreadable claim";
            return yield* Effect.die(
              new Error(`another Core won the discovery claim (${winner}); refusing to run twice`),
            );
          }
          sessions.publishSecret();
          yield* Effect.log(`honk core listening on http://127.0.0.1:${port}`);
          return home.discoveryPath;
        }),
        (path) =>
          Effect.gen(function* () {
            yield* core.buses.dispose();
            clearDiscoveryIfOwn(path, process.pid);
          }),
      ),
    ).pipe(Layer.provide(serverLayer));

    yield* Layer.launch(Layer.mergeAll(serverLayer, discoveryLayer));
  }),
);

NodeRuntime.runMain(Effect.asVoid(program));
