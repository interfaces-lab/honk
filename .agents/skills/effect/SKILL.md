---
name: effect
description: Work with Effect v4 / effect-smol TypeScript code in this repo
---

# Effect

This codebase uses Effect for typed, composable TypeScript services, schemas, and workflows.

## Source Of Truth

Use the current Effect v4 / effect-smol source, not memory or older Effect v2/v3 examples.

1. Prefer the installed package: probe `node_modules/effect` (dist .d.ts files, or `node -e` against the
   real module) for exact APIs and signatures before writing Effect code — v4 renamed and removed APIs
   (`Effect.catch` not `catchAll`, `Schema.Literals`, `Schema.TaggedErrorClass`, options-form
   `Effect.tryPromise`).
2. For fuller examples and tests, clone `https://github.com/Effect-TS/effect-smol` into a project-local
   references directory (never into the skill folder) and search it.
3. Also inspect existing repo code for local house style before introducing new patterns.
4. Prefer answers and implementations backed by specific source files or nearby repo examples.

## Guidelines

- Prefer current Effect v4 APIs and project-local patterns over old blog posts, examples, or
  package-memory guesses.
- Use `Effect.gen(function* () { ... })` for multi-step workflows.
- Use `Effect.fn("Name")` or `Effect.fnUntraced(...)` for named effects when adding reusable service
  methods or important workflows.
- Prefer Effect `Schema` for API and domain data shapes. Use branded schemas for IDs and
  `Schema.TaggedErrorClass` for typed domain errors when modeling new error surfaces.
- Keep HTTP handlers thin: decode input, read request context, call services, and map transport errors.
  Put business rules in services.
- In Effect service code, prefer Effect-aware platform abstractions and dependencies over ad hoc
  promises where the surrounding code already does so.
- Keep layer composition explicit. Avoid broad hidden provisioning that makes missing dependencies hard
  to see.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing,
  validation, and option building should stay synchronous.
- Prefer Effect schema helpers such as `Schema.fromJsonString` and `Schema.decodeUnknownOption` over
  manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Do not introduce `any`, non-null assertions, unchecked casts, or older Effect APIs just to satisfy
  types.
- Do not answer from memory. Verify against the installed effect source or nearby code first.

## Testing Patterns

- Prefer live end-to-end tests over mocks: real HTTP server on an ephemeral port, real sqlite in a
  temp directory, real SSE streams (see packages/core/test/core-server.test.ts for the house pattern).
- Run tests from package directories (e.g. `packages/core`); never from the repo root.
- Keep dependency provisioning visible in the test file: explicit `Layer.mergeAll(...)` +
  `Effect.provide`, no hidden managed runtimes.
- Use scoped fixtures and finalizers for resources that must be cleaned up: temp directories, fibers,
  servers, databases, global state.
