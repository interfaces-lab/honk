# Refactoring honk toward pi's style — gap analysis and spec

Companion to `pi-codebase-patterns.md`. Question answered: _if honk were refactored toward the way pi is implemented, what would actually change?_

Method: quantitative survey of all packages + deep reads of `runtime`, `server`, `contracts` (June 2026, `bigrefactor` branch). Ordered by the house principles: subtract before add, minimize reader load, smallest diff that pays.

---

## 0. What does NOT change (already pi-like)

Verified, leave alone:

- **Declaration style**: 1,153 `export function` vs 43 arrow-consts, **0 enums, 0 inline `await import()`, 8 `: any`** across all src. Surface style already matches pi.
- **honk already runs ON pi**: `packages/runtime` + `desktop` consume `@earendil-works/pi-{agent-core,ai,coding-agent}` and use pi's extension API. The refactor target is the code _around_ pi, not an agent engine.
- **contracts' schema-first approach is pi's pattern in spirit**: `Schema.Struct` + `typeof X.Type` is exactly pi's TypeBox + `Static<typeof schema>` (schema is the source of truth, type derived). Keep Effect Schema in contracts.
- **`@honk/server → @honk/app`** turned out to be devDependencies-only, zero src imports. Non-issue.
- **Config is lean** — no dead knobs found in server config.
- **Hand-rolled small primitives** (`TrailingThrottle`, `mapWithConcurrency`, `boundedPush`) are pi-style ("one small primitive over a dependency"). Keep them plain; do _not_ replace with Effect `Schedule` machinery.
- **honkkit / client-runtime**: zero Effect, plain components. Fine.

The gap is not style. It is **four architectural divergences**, three of which are subtraction.

---

## 1. Tier 1 — Subtract first (deletions and collapses, no framework decisions)

### 1.1 Collapse the 10 `Projection*Repository` services → one table-driven module

`packages/server/src/persistence/Projection*.service.ts`: ten near-identical files (~170 lines each, ~76% ceremony, ~40 lines of real SQL+mapping each), all upsert → getById → list → delete over sqlite.

pi pattern applied: registry/table-driven design (`models.generated.ts` + one `getModel`), consolidate the decision once.

Change: one `makeProjectionRepository({ table, rowSchema, toDomain })` factory + a table of configs. Stays inside Effect (still produces Layers).
**Delta: ≈ −1,200 lines. Reader learns the pattern once instead of ten times.**

### 1.2 Collapse per-operation error classes → small category set

40–59 error classes (`OrchestrationDispatchCommandError`, `ProjectReadFileError`, `TerminalCwdError`, …), but only 24 `catchTag` sites in the entire codebase, ~90% of which generically map to HTTP status at the boundary. The per-op contract errors are **caught zero times** by app/desktop consumers — they stringify `.message`.

pi pattern applied: expected failures are _data_ (a reason + message on the result), `Error` subclasses exist only where someone catches by type (pi has ~6 total).

Change: keep the handful that are actually discriminated (`AuthError`, `SqlError`, the HTTP-mapped attachment/favicon set); fold the rest into category errors with an `operation`/`resource` payload field (`FileError`, `CommandError`, `DecodeError`, `OrchestrationError`). Contracts shrink; the RPC error envelope carries `kind` + `message` as data.
**Delta: ~40 classes → ~8. Pure deletion of unrecouped ceremony.**

### 1.3 Unify the timeline projection's triple event dispatch

`runtime/src/display-timeline-projection.ts` (1,313 lines): three independent passes filter the same event list (`projectLiveMessageItems`, `projectToolItems`, `projectExtensionUiRequestItems`), three mutable item maps, and message-merge semantics duplicated between `mergeRuntimeDisplayTimelineItem` and `normalizeIncrementalRuntimeDisplayTimelineEventItem`.

pi pattern applied: one pipeline of phase functions with kind-tagged intermediates; each event classified exactly once. (Same lesson as the unified grouping accumulator from the turn-send work.)

Change: single fold — `classifyEvent(event) → MessageItem | ToolItem | ExtensionUiItem | null` feeding one accumulator; merge semantics defined once.
**Delta: collapse, no behavior change; unblocks 2.2.**

### 1.4 De-ceremonialize stateless Effect services

45 `*Shape` service interfaces; **every one has exactly one implementation** — no mocks, no adapters, no strategy switching. ~30 lines of `Context.Service` + `Layer.effect` indirection per service with zero polymorphism payoff. Representative: `GitStatusBroadcaster` ≈ 62% ceremony; `ProjectionThreads` ≈ 76%.

pi pattern applied: factories + explicit options, `*Operations` interfaces only where a second implementation exists; "collapse layers that do not earn their keep."

Change (incremental, not big-bang): for stateless/pure services (`ProjectPaths`, `image-mime`-adjacent, resolvers), demote to plain exported functions imported directly; keep Service/Layer only for things with lifecycle/state (event store, broadcaster, terminal manager). Each demotion deletes a tag, a Shape, a Layer, and the `yield*` choreography at every call site.
**Delta: −25–30 lines per demoted service, and "where does X come from" becomes an import statement instead of a 5-minute Layer-graph trace (41 `Layer.*` calls in `server-runtime.ts` today).**

### 1.5 Normalization: one definition per concern, proof in the type

Moved to its own work order: **`docs/normalize-once.md`** — goal, full entry inventory (project root/cwd attribution wrappers, thread-key re-derivations, duplicate search-text canonicalizers, fragmented path rules, misnamed clamps), per-entry rationale for why downstream must not re-normalize, and execution constraints. Summary: honk has ~277 `normalize*` definitions/locals vs pi's ~30 single-definition functions; the fix is deletion plus boundary-proof (spans for attribution, decode-is-the-normalization for types).

---

## 2. Tier 2 — Restructure the runtime hot core (the known pain, now with pi's shapes)

### 2.1 `ThreadAgentRuntime` (976 lines, 13 mutable arrays) → phase functions + bounded state

Current: one class owns subscription, projection, turn bookkeeping, deferred events, pending prompts; arrays grow unboundedly mid-stream; re-`subscribe()` per thread can double-fire events.

pi pattern applied: the agent-loop decomposition — orchestrator → `prepare* / execute* / finalize*` phase functions, each returning a named kind-tagged type declared next to its function; effects injected as an `emit` sink; class keeps only identity + queues (pi's `Agent` is 557 lines _because_ `agent-loop.ts` holds the logic as functions).

Change: extract pure phases (`projectPiEvent`, `resolveTurnAttribution`, `drainDeferred`) into module functions with explicit inputs/outputs; one subscription with dedup guard; pending-state cleared per-phase rather than in one terminal `finally`.

### 2.2 `DesktopRuntimeHost`: stop re-projecting the whole timeline per streaming event

Current: every pi streaming event triggers full `projectRuntimeDisplayTimeline` over the thread's event array; the throttle only gates the _broadcast_, the projection still recomputes (the file's own comment calls it "the dominant freeze/energy cost").

pi pattern applied: the `partial` snapshot idiom — the producer maintains **one accumulating output** mutated per event; consumers receive snapshots; nothing re-derives from history on the hot path.

Change: keep an incremental projection state per thread (enabled by 1.3's single accumulator), apply each event as a delta, snapshot on throttle tick. Event retention split: live tail (bounded) vs committed history (session tree), instead of one bounded-array compromise.

### 2.3 Subagents: already-known workstream, pi confirms the direction

`subagent-extension.ts` spawns a full in-process `ThreadAgentRuntime` per task (8 parallel) and republishes the full activities array into tool-result `details` per throttle tick. This matches the standing diagnosis (in-process embedding is the bug; pi-subagents uses subprocesses). pi's own loop also shows the cheap intermediate fix: stream deltas via `onUpdate`, keep the _final_ summary small in `details`.

---

## 3. Tier 3 — The Effect direction (REVISED after studying t3code)

> Original position ("keep Effect in server, never expand it") was revised after studying
> https://github.com/pingdotgg/t3code (June 2026). Evidence below.

**The lineage finding**: honk and t3code are architectural siblings, not just comparable apps. Same Effect line (honk `4.0.0-beta.59`, t3code `4.0.0-beta.78`); same package names (`contracts`, `client-runtime`, `shared`); **33 of honk's 50 desktop files share names with t3code's desktop** (`DesktopLifecycle`, `DesktopBackendManager`, `DesktopIpc`, `ElectronUpdater`, `UpdateMachine`, …); identical server layer names (`ReactorLayerLive`, `RuntimeDependenciesLive`, `RuntimeServicesLive`) and identical service names (`ProjectionThreads`, `OrchestrationEventStore`, `RepositoryIdentityResolver`). honk's desktop is effectively a de-Effected port of t3code's desktop. t3code is therefore not an analogy — it is a working reference implementation of _this_ architecture, fully Effect.

**Revised verdict: deepen Effect, don't shrink it.** Three moves:

1. **Desktop main process → full Effect, by file-by-file convergence with t3code.** What t3code demonstrates concretely: `Scope`/`acquireRelease` for Electron listeners (guaranteed deregistration), `Deferred`-coordinated shutdown (`request → awaitComplete → exit`, no quit races), `Effect.addFinalizer` guaranteeing backend stop, Schema-typed IPC (32 channels, payload+result codecs, one uniform `ipc.handle(...)` registration), and Scope-managed backend subprocess with exponential-backoff restart + HTTP readiness probe. Every one of these maps 1:1 onto an existing honk desktop file. **Renderer and preload stay plain TS — t3code keeps them plain too.**
2. **The pi bridge in `runtime` → Effect wrapper modeled on t3code's `effect-acp`** (Scope-managed agent subprocess, Stream-based stdio JSON-RPC framing, buffered notification dispatch until handlers attach, termination as typed error). This is the same vehicle that delivers the subagent out-of-process isolation (2.3): subagents become scoped subprocesses with structured interruption instead of in-process `ThreadAgentRuntime` instances, and the unbounded-array/double-subscription class of bugs (2.1) becomes structurally impossible (bounded `Queue`/`PubSub`, `Stream.concat(snapshot, live)` with cursor replay).
3. **Server stays Effect and adopts t3code's leaner idioms** — same library version, so directly portable:
   - `SqlSchema.findAll`/`findOneOption`/`void` from `effect/unstable/sql` for the 10 projection repositories: schema is the contract, decode is automatic. Supersedes the hand-written table-driven factory idea in 1.1.
   - Domain error unions, not per-operation classes (`type ProjectionRepositoryError = PersistenceSqlError | PersistenceDecodeError`) — independently validates 1.2.
   - `Effect.fn("name")` on named operations: tracing/spans for free.
   - Named layer stacks with intent comments (t3code's `server.ts`) instead of one dense 206-line wiring block.

**What survives from pi**: everything framework-independent. pi's value to this codebase was never "no Effect" — it is reader-load discipline _inside_ whatever framework: normalize at the boundary once, phase functions with kind-tagged intermediate types, one-pass projection accumulators, expected-failure-as-data vs misuse-throws, collapse single-caller wrappers. Tiers 1.2, 1.3, 2.1, 2.2 are unchanged; they apply to Effect code verbatim.

**Residual honesty**: t3code self-describes as "VERY EARLY WIP" — it proves viability and shape, not years of production hardening. The intrinsic Effect costs remain (Layer-graph opacity, `Effect<A, E, R>` learning curve, generator idioms), and t3code pays them too. The mitigation is theirs as well: vendored reference repos + an LLMS.md so agents write idiomatic Effect, and strict boundaries — no Effect in renderer/preload/marketing.

---

## 4. Sequencing (subtract → restructure → never big-bang)

| Step | What                                                                      | Why first                                                                                                                     |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1    | 1.2 error-class collapse + 1.3 projection unification                     | Pure deletion; shrinks contracts and the projection file before anything builds on them                                       |
| 2    | 1.1 repository collapse                                                   | Mechanical, table-driven, −1,200 lines                                                                                        |
| 3    | 2.1 + 2.2 runtime restructure                                             | Now operates on the unified accumulator; the hot-path fix lands on simpler ground                                             |
| 4    | 1.1-via-SqlSchema + `Effect.fn` adoption in server, per-file when touched | t3code idioms on the same Effect version; each touch deletes ceremony                                                         |
| 5    | Desktop main → Effect, converging file-by-file with t3code                | 33/50 files have a working Effect reference of the same name; do it as files get touched, lifecycle/IPC/backend-manager first |
| 6    | 2.3 subagent isolation via the effect-acp-style scoped-subprocess bridge  | Existing workstream; lands on 2.1's extracted phases and step 5's patterns                                                    |

**Anti-goals** (laziness protocol): no Effect removal from server; no Effect in renderer/preload/`app`/`honkkit` (t3code keeps these plain too); no TypeBox introduction alongside Schema; no new abstraction layers "to match pi" (pi's lesson is _fewer_ layers); no big-bang desktop rewrite — converge per-file with the t3code reference; no touching `thread-sync.ts`/`session-logic.ts` (3.9k/3.7k lines) until a real task requires it — size alone isn't a defect in pi's book, a 1,225-line provider file is fine when it's one self-contained unit.

The 30-second test after Tiers 1–2: "where does a timeline item come from?" → one classify function, one accumulator. "What can change runtime state?" → named phase functions with typed results, not 13 arrays.
