# usemulti

Node.js server and CLI package for Multi.

- The server is the process and security boundary between GUI clients and coding-agent runtimes.
- Domain folders under `src` are self-contained. Implementation modules use `Foo.ts`; service contracts/tags use `Foo.service.ts`.
- Do not add `Layers/`, `Services/`, or barrel `index.ts` files.
- Keep schemas shared with the app in `@multi/contracts`; keep runtime utilities shared with the app in `@multi/shared`.
- The package name and binary stay `usemulti`/`multi`.

## Effect Server Patterns

- Use `Effect.fn("Module.operation")(function* (...) {})` for service operations.
- Convert external failures at module edges with existing `Schema.TaggedErrorClass` errors.
- Wrap throwing and Promise APIs with `Effect.try`, `Effect.tryPromise`, or `Result.try`.
- Use `.pipe(Effect.catch(...))` for fallback paths instead of internal `try/catch`.
- Emit recoverable diagnostics with `Effect.logWarning` / `Effect.logError` and attach spans with `Effect.withSpan`.
- Keep `Effect.runPromise` and `ServerRuntime` instance `runPromise` calls at process, transport, SDK callback, or integration boundaries only.

Remaining `try/catch` sites in `src` should be boundary-required:

- `@multi/shared/logging`: synchronous rotating file sink internals.
- `@multi/shared/Net` and `src/process-runner.ts`: socket/process cleanup.
- `@multi/shared/shell` and `src/os-jank.ts`: platform PATH probing.
- `src/open.ts`: platform executable probing and detached process spawn callback.
- `src/observability/TraceRecord.ts` / `TraceSink.ts`: defensive trace parsing and synchronous sink buffering.
- `src/persistence/NodeSqliteClient.ts`: `node:sqlite` statement boundary mapped to `SqlError`.
- Provider SDK/process callback files (`ClaudeAdapter`, `ClaudeProvider`, `CursorProvider`, `CodexProvider`, `CodexSessionRuntime`): JSON/platform/SDK callback boundaries.
- `src/project/ProjectEntries.ts`: grep false positives from `ProjectEntry` identifiers, not `try/catch` statements.
