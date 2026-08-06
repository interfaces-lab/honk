# Effect

Honk's conventions for Effect code. Prefer this shape for new code and for
changes already in scope. Probe the pinned `effect` package before inventing
APIs.

## Service shape

Use one module per service: flat top-level exports, traced Effect methods,
explicit layers, and a self-reexport at the bottom.

Declare the construction effect on the class as its `make` (Effect v4's
`Context.Service` option), so the service identity and how to build it live
together and the layer is one line. Annotate `make`'s type explicitly: the
annotation is what lets the generator body mention the class declared below
it without a type-inference cycle.

```ts
export interface Interface {
  readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>;
}

const make: Effect.Effect<Interface, never, FooDep.Service> = Effect.gen(function* () {
  const get = Effect.fn("Foo.get")(function* (id: FooID) {
    return yield* loadFoo(id);
  });

  return { get } satisfies Interface;
});

export class Service extends Context.Service<Service, Interface>()("honk/Foo", { make }) {}

export const layer = Layer.effect(Service, Service.make);

export const defaultLayer = layer.pipe(Layer.provide(FooDep.defaultLayer));

export * as Foo from "./foo";
```

- A parameterized service makes `make` a function of its options —
  `const make = (options: LayerOptions): Effect.Effect<...> => Effect.gen(...)`
  — and the layer becomes
  `(options) => Layer.effect(Service, Service.make(options))`.
- Do not use `export namespace Foo { ... }`.
- Use `Effect.fn("Foo.method")` for public service methods; `Effect.fnUntraced`
  for small internal helpers that do not need a span.
- `Effect.fn` / `Effect.fnUntraced` accept pipeable operators as extra
  arguments — avoid unnecessary outer `.pipe()` wrappers.
- Keep helpers as non-exported top-level declarations in the same file.
- Self-reexport with `export * as Foo from "."` for `index.ts`, otherwise
  `export * as Foo from "./foo"`.
- In Effect generators, bind services to named variables before calling
  methods. Do not nest yields such as `yield* (yield* Foo.Service).bar()`.

## Composition

- Compose with `Effect.gen(function* () { ... })`.
- Use `Effect.callback` for callback-based APIs.
- Use `Effect.void` instead of `Effect.succeed(undefined)`.
- Prefer `DateTime.nowAsDate` over `new Date(yield* Clock.currentTimeMillis)`
  when you need a `Date`.
- Use `Effect.cached` when concurrent callers should share one in-flight
  computation.
- For background loops, use `Effect.repeat` / `Effect.schedule` with
  `Effect.forkScoped` in the owning layer scope.
- A layer that hands out resources owns their teardown: register
  `Effect.addFinalizer` in the construction effect (`Layer.effect` provides
  the scope) instead of leaving a `cleanup()` no one calls. Reach for `RcMap`
  only when consumers hold the resource strictly inside Effect scopes;
  a resource shared with non-Effect holders (a Pi harness) must not be
  reference-counted away underneath them.
- Effect v4: `Effect.fork` / `Effect.forkDaemon` do not exist; use
  `Effect.forkIn(scope)` (or scoped forks in the owning scope).
- Do not return `Effect` from helpers unless they perform effectful work.
  Synchronous parsing, validation, and option building stay synchronous.

## Errors

Expected domain failures belong on the Effect error channel. Defects are for
bugs, impossible states, and final unknown-boundary fallbacks.

- Prefer `Schema.TaggedErrorClass` for new expected domain errors; export a
  domain-level `Error` union from service modules.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` for direct
  expected failures.
- Use `Schema.Defect()` for unknown cause fields.
- Translate external failures with `Effect.try`, `Effect.tryPromise`,
  `Effect.mapError`, `Effect.catchTag`, and `Effect.catchTags`.
- Do not use `Effect.die` for user, IO, validation, missing-resource, auth,
  provider, or busy-state failures.
- Keep HTTP/IPC handlers thin: decode input, call services, map typed errors
  to transport responses. Service modules stay transport-agnostic.

## Schemas

- Use Effect Schema as the source of truth at untrusted boundaries.
- Prefer `Schema.Struct` for ordinary records; branded schemas for single-value
  IDs; `Schema.Class` only when the type has a clear multi-field identity that
  benefits from it.
- Express validation rules as schema checks —
  `Schema.check(Schema.isPattern(...), Schema.makeFilter(...))` piped into
  `Schema.brand(...)` — with a validator helper wrapping `Schema.decodeOption`.
  The check schema is not necessarily the wire type: keep a payload field
  `NonEmptyString` when a bad value should be the domain's typed error rather
  than a decode failure, and let the brand travel internally.
- Prefer `Schema.UnknownFromJsonString` / `Schema.decodeUnknownOption` (or the
  project’s current decode helpers) over manual `JSON.parse` wrapped in
  `Effect.try`.

## Preferred services

Inside Effect code, yield platform services instead of dropping to ad hoc APIs:

- `FileSystem.FileSystem` instead of raw `fs/promises`
- `ChildProcessSpawner` / `ChildProcess.make` instead of custom process
  wrappers when already in Effect
- `HttpClient.HttpClient` instead of raw `fetch` inside Effect code
- `Path.Path`, `Config`, `Clock`, and `DateTime` when those concerns are
  already inside Effect
