# usehonk

Node.js server and CLI package for Honk.

## Boundary

| Owns                                                                                         | Does not own                                                   |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Durable orchestration facts: messages, entries, activities, proposed plans, session metadata | Pi execution, runtime display rows, `chatTimelineRows`         |
| `OrchestrationEngine` command handling and projections                                       | Renderer-side runtime ingestion or semantic chat row synthesis |

Branch navigation order is derived in the app projector from messages and entries, not a server display row list.

- The server is the process and security boundary between GUI clients and coding-agent runtimes.
- Domain folders under `src` are self-contained. Implementation modules use `Foo.ts`; service contracts/tags use `Foo.service.ts`.
- Do not add `Layers/`, `Services/`, or barrel `index.ts` files.
- Keep schemas shared with the app in `@honk/contracts`; keep runtime utilities shared with the app in `@honk/shared`.
- The package name and binary stay `usehonk`/`honk`.

## Orchestration boundary

The server stores and exports **durable orchestration facts** only. It does not execute Pi, synthesize chat display rows, or own UI timeline projection.

| Owns                                                 | Does not own                                            |
| ---------------------------------------------------- | ------------------------------------------------------- |
| Messages, thread entries, activities, proposed plans | Pi agent execution (`@honk/runtime`, desktop main)     |
| Session metadata, turns, projects, pending approvals | Runtime display timelines or overlay rows               |
| Event-sourced projection into `OrchestrationThread`  | `chatTimelineRows` or other pre-rendered chat row lists |
| WebSocket RPC for `EnvironmentApi`                   | Branch navigation order for the chat UI                 |

`OrchestrationThread` is a facts snapshot: `messages`, `entries`, `activities`, `proposedPlans`, and `session`. Branch order and chat row materialization live in the app `thread-timeline-projector`, derived from committed facts plus runtime overlay and local send intent — not from server-side display derivation.

Do not add server helpers that derive chat timeline rows, attach display ordering to thread snapshots, or compete with the app projector.

## Effect Server Patterns

- Use `Effect.fn("Module.operation")(function* (...) {})` for service operations.
- Convert external failures at module edges with existing `Schema.TaggedErrorClass` errors.
- Wrap throwing and Promise APIs with `Effect.try`, `Effect.tryPromise`, or `Result.try`.
- Use `.pipe(Effect.catch(...))` for fallback paths instead of internal `try/catch`.
- Emit recoverable diagnostics with `Effect.logWarning` / `Effect.logError` and attach spans with `Effect.withSpan`.
- Keep `Effect.runPromise` and `ServerRuntime` instance `runPromise` calls at process, transport, SDK callback, or integration boundaries only.

Remaining `try/catch` sites in `src` should be boundary-required:

- `@honk/shared/logging`: synchronous rotating file sink internals.
- `@honk/shared/Net` and `src/process-runner.ts`: socket/process cleanup.
- `@honk/shared/shell` and `src/os-jank.ts`: platform PATH probing.
- `src/open.ts`: platform executable probing and detached process spawn callback.
- `src/observability/TraceRecord.ts` / `TraceSink.ts`: defensive trace parsing and synchronous sink buffering.
- `src/persistence/NodeSqliteClient.ts`: `node:sqlite` statement boundary mapped to `SqlError`.
- Desktop Pi runtime execution lives in `@honk/runtime`; the server no longer owns provider process callback files.
- `src/project/ProjectEntries.ts`: grep false positives from `ProjectEntry` identifiers, not `try/catch` statements.
