import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Effect, Layer, Queue } from "effect";
import {
  type Harness,
  boundPort,
  makeAuth,
  makeCheckpoints,
  makeCore,
  makeServerLayer,
  makeSessions,
  makeTerminals,
  resolveCoreHome,
} from "@honk/core";
import {
  decodeThreadStreamEvent,
  MessageId,
  ModelId,
  ThreadId,
  type ThreadDetail,
  type ThreadStreamEvent,
} from "@honk/api/core/v1";
import {
  applyThreadEvent,
  connect,
  fromDetail,
	parsePromptTokens,
	serializeToken,
	type HonkClient,
	type TerminalSession,
	type ThreadState,
	type WorkspaceState,
} from "../src";

const echoHarness: Harness = {
  capabilities: { steer: true },
  runTurn: (ctx) =>
    Effect.gen(function* () {
      const partId = ctx.newPartId();
      yield* ctx.createPart({
        _tag: "text",
        id: partId,
        messageId: ctx.assistantMessageId,
        turnId: ctx.turnId,
        origin: "honk",
        state: "active",
        text: "",
        metadata: {
          mode: ctx.interactionMode,
          images: ctx.images.length,
          resumeLeaf: ctx.resumeLeaf,
          hadSessionRef: ctx.sessionRef !== null,
        },
      });
      const words = `Echo: ${ctx.userText}`.split(" ");
      for (let index = 0; index < words.length; index++) {
        const word = index === 0 ? words[index] : ` ${words[index]}`;
        yield* ctx.appendDelta(partId, "text", word ?? "");
        yield* Effect.sleep(25);
        const steered = yield* Queue.clear(ctx.steered);
        for (const item of steered) {
          yield* ctx.appendDelta(partId, "text", ` (steered: ${item.text})`);
        }
      }
      yield* ctx.completePart(partId);
      if (ctx.sessionRef === null) {
        yield* ctx.setSessionRef(`echo/${String(ctx.threadId)}`);
      }
      yield* ctx.setTurnLeaf(`leaf_${String(ctx.turnId)}`);
    }),
};

const PINNED_MODEL = ModelId.make("openai-codex/gpt-5.5");

const makeTestCore = (home: string) => {
  const coreHome = resolveCoreHome(home);
  const auth = makeAuth(coreHome);
  auth.storage.set("openai-codex", { type: "api_key", key: "test-key" });
  return makeCore(coreHome, auth, { "openai-codex": echoHarness }, makeCheckpoints());
};

const tempHome = mkdtempSync(join(tmpdir(), "honk-sdk-test-"));
const terminals = makeTerminals();
afterAll(async () => {
  await Effect.runPromise(terminals.dispose());
  rmSync(tempHome, { recursive: true, force: true });
});

const core = makeTestCore(tempHome);
let coreOrigin: string | null = null;
const sessions = makeSessions(resolveCoreHome(tempHome), core.store, () => coreOrigin);
sessions.publishSecret();
const coreAppSecret = readFileSync(sessions.secretPath, "utf8");
const ServerLive = makeServerLayer(core, sessions, terminals, { port: 0 });

const withServer = <A>(f: (origin: string, bearer: string) => Promise<A>): Promise<A> =>
  Effect.gen(function* () {
    const port = yield* boundPort;
    const origin = `http://127.0.0.1:${port}`;
    coreOrigin = origin;
    return yield* Effect.promise(() => f(origin, coreAppSecret));
  }).pipe(Effect.provide(Layer.mergeAll(ServerLive)), Effect.runPromise);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

const makeDeferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    resolve: (value) => {
      if (resolve === null) throw new Error("deferred resolve missing");
      resolve(value);
    },
    reject: (error) => {
      if (reject === null) throw new Error("deferred reject missing");
      reject(error);
    },
  };
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};

const createPayload = (threadId: ThreadId) => ({
  threadId,
  cwd: tempHome,
  model: PINNED_MODEL,
});

const waitForIdle = async (
  client: HonkClient,
  threadId: ThreadId,
  queueLength = 0,
): Promise<ThreadDetail> => {
  for (let i = 0; i < 200; i++) {
    const detail = await client.threads.get(threadId);
    if (detail.summary.status === "idle" && detail.queue.length === queueLength) return detail;
    await sleep(25);
  }
  throw new Error("thread never settled");
};

const textParts = (detail: {
  readonly parts: ReadonlyArray<{ readonly _tag: string; readonly text?: string }>;
}): Array<string> =>
  detail.parts.flatMap((part) =>
    part._tag === "text" && part.text !== undefined ? [part.text] : [],
  );

const detailFromState = (state: ThreadState): ThreadDetail => ({
  summary: state.summary,
  cwd: state.cwd,
  capabilities: state.capabilities,
  entries: state.entries,
  leafId: state.leafId,
  messages: state.messages,
  parts: state.parts,
  queue: state.queue,
  seq: state.seq,
});

const reducerComparable = (detail: ThreadDetail) => ({
  summary: detail.summary,
  leafId: detail.leafId,
  messages: detail.messages,
  parts: detail.parts,
  queue: detail.queue,
});

const threadEvents = (threadId: ThreadId): Array<ThreadStreamEvent> =>
  core.store
    .listThreadEvents(String(threadId), 0)
    .map((event) => decodeThreadStreamEvent(JSON.parse(event.encoded) as unknown));

describe("@honk/sdk", () => {
  it("connects with a bearer, sends, watches, and folds to the fresh snapshot", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const threadId = ThreadId.make("sdk_watch_canonical");
      const messageId = MessageId.make("sdk_msg_watch_canonical");
      let receiptSeq = 0;
      const watchedIdle = makeDeferred<ThreadState>();
      await honk.threads.create(createPayload(threadId));
      const watch = honk.threads.watch(threadId, {
        onChange: (state) => {
          if (
            receiptSeq > 0 &&
            state.seq >= receiptSeq &&
            state.summary.status === "idle" &&
            textParts(state).includes("Echo: hello sdk")
          ) {
            watchedIdle.resolve(state);
          }
        },
      });
      try {
        const receipt = await honk.threads.send(threadId, { messageId, text: "hello sdk" });
        receiptSeq = receipt.seq;
        const watched = await withTimeout(watchedIdle.promise, 8000, "watch did not settle");
        const fresh = await waitForIdle(honk, threadId);
        expect(detailFromState(watched)).toEqual(fresh);
      } finally {
        watch.close();
        await honk.close();
      }
    });
  });

  it("attaches to a terminal and receives PTY output", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const receivedOutput = makeDeferred<string>();
      let output = "";
      let session: TerminalSession | null = null;
      try {
        const terminal = await honk.terminals.create({
          cwd: tempHome,
          title: "sdk pty test",
          cols: 80,
          rows: 24,
        });
        session = await honk.terminals.attach(terminal.id, {
          onData: (data) => {
            output += data;
            if (output.includes("hi")) receivedOutput.resolve(output);
          },
        });
        session.write("echo hi\r");
        const result = await withTimeout(
          receivedOutput.promise,
          5000,
          "terminal output did not include hi",
        );
        expect(result).toContain("hi");
        await honk.terminals.close(terminal.id);
      } finally {
        session?.close();
        await honk.close();
      }
    });
  });

  it("folds the durable event list from seq 0 to the final snapshot", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const threadId = ThreadId.make("sdk_reducer_purity");
      try {
        await honk.threads.create(createPayload(threadId));
        const empty = await honk.threads.get(threadId);
        await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_reducer_purity"),
          text: "fold me",
        });
        const finalDetail = await waitForIdle(honk, threadId);
        let folded = fromDetail(empty);
        for (const event of threadEvents(threadId)) {
          const applied = applyThreadEvent(folded, event);
          expect(applied.refetch).toBe(false);
          folded = applied.state;
        }
        expect(reducerComparable(detailFromState(folded))).toEqual(reducerComparable(finalDetail));
      } finally {
        await honk.close();
      }
    });
  });

  it("exchanges a pairing token, enforces web permissions, and rejects after revoke", async () => {
    await withServer(async (origin, bearer) => {
      const app = await connect({ origin, bearer });
      let web: HonkClient | null = null;
      try {
        const pairing = await app.sessions.pair();
        web = await connect({ origin, pairingToken: pairing.token });
        const auth = await web.auth.get();
        expect(auth.flow).toBeNull();
        await expect(web.auth.logout({ kind: "codex-oauth" })).rejects.toMatchObject({
          _tag: "ForbiddenError",
        });
        const listed = await app.sessions.list();
        const webSession = listed.sessions.find((session) => session.role === "web");
        if (webSession === undefined) throw new Error("web session missing");
        await app.sessions.revoke(webSession.id);
        await expect(web.auth.get()).rejects.toMatchObject({ _tag: "UnauthorizedError" });
      } finally {
        if (web !== null) await web.close();
        await app.close();
      }
    });
  });

  it("refetches when tree.moved targets a branch outside the active snapshot", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const threadId = ThreadId.make("sdk_tree_moved_refetch");
      const reachedLinearLeaf = makeDeferred<ThreadState>();
      try {
        await honk.threads.create(createPayload(threadId));
        await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_tree_first"),
          text: "first branch",
        });
        const afterFirst = await waitForIdle(honk, threadId);
        const linearLeaf = afterFirst.leafId;
        const rootUserEntry = afterFirst.entries.find((entry) => entry.parentId === null);
        if (linearLeaf === null || rootUserEntry === undefined) {
          throw new Error("branch setup failed");
        }
        await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_tree_second"),
          text: "second branch",
          parentEntryId: rootUserEntry.id,
        });
        await waitForIdle(honk, threadId);
        const initialBranch = makeDeferred<ThreadState>();
        let sawImpossibleRefetchState = false;
        const watch = honk.threads.watch(threadId, {
          onChange: (state) => {
            if (
              String(state.leafId) === String(linearLeaf) &&
              textParts(state).includes("Echo: second branch")
            ) {
              sawImpossibleRefetchState = true;
            }
            if (textParts(state).includes("Echo: second branch")) {
              initialBranch.resolve(state);
            }
            if (
              String(state.leafId) === String(linearLeaf) &&
              textParts(state).includes("Echo: first branch")
            ) {
              reachedLinearLeaf.resolve(state);
            }
          },
        });
        try {
          await withTimeout(initialBranch.promise, 8000, "watch did not receive branch snapshot");
          await honk.threads.navigate(threadId, { entryId: linearLeaf });
          const watched = await withTimeout(
            reachedLinearLeaf.promise,
            8000,
            "watch did not refetch branch",
          );
          const fresh = await honk.threads.get(threadId);
          expect(detailFromState(watched)).toEqual(fresh);
          expect(sawImpossibleRefetchState).toBe(false);
        } finally {
          watch.close();
        }
      } finally {
        await honk.close();
      }
    });
  });

  it("keeps watch parity after two queued sends drain", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const threadId = ThreadId.make("sdk_watch_two_queued");
      const initial = makeDeferred<ThreadState>();
      const settled = makeDeferred<ThreadState>();
      await honk.threads.create(createPayload(threadId));
      const watch = honk.threads.watch(threadId, {
        onChange: (state) => {
          initial.resolve(state);
          if (
            state.summary.status === "idle" &&
            state.queue.length === 0 &&
            state.messages.length === 6 &&
            textParts(state).includes("Echo: second queued")
          ) {
            settled.resolve(state);
          }
        },
      });
      try {
        await withTimeout(initial.promise, 8000, "watch did not receive initial snapshot");
        await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_two_queued_running"),
          text: "one two three four five six seven eight",
        });
        const firstQueued = await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_two_queued_q1"),
          text: "first queued",
        });
        const secondQueued = await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_two_queued_q2"),
          text: "second queued",
        });
        expect(firstQueued.disposition).toBe("queued");
        expect(secondQueued.disposition).toBe("queued");
        const watched = await withTimeout(
          settled.promise,
          8000,
          "watch did not drain queued sends",
        );
        const fresh = await waitForIdle(honk, threadId);
        expect(detailFromState(watched)).toEqual(fresh);
      } finally {
        watch.close();
        await honk.close();
      }
    });
  });

  it("does not project a cancelled queued send's text part", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const threadId = ThreadId.make("sdk_watch_cancel_queued");
      const initial = makeDeferred<ThreadState>();
      const settled = makeDeferred<ThreadState>();
      let sawCancelledText = false;
      let cancelIssued = false;
      await honk.threads.create(createPayload(threadId));
      const watch = honk.threads.watch(threadId, {
        onChange: (state) => {
          initial.resolve(state);
          if (textParts(state).includes("cancel me")) sawCancelledText = true;
          if (
            cancelIssued &&
            state.summary.status === "idle" &&
            state.queue.length === 0 &&
            textParts(state).includes("Echo: one two three four five six seven eight")
          ) {
            settled.resolve(state);
          }
        },
      });
      try {
        await withTimeout(initial.promise, 8000, "watch did not receive initial snapshot");
        await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_cancel_running"),
          text: "one two three four five six seven eight",
        });
        await honk.threads.send(threadId, {
          messageId: MessageId.make("sdk_msg_cancel_queued"),
          text: "cancel me",
        });
        await honk.threads.cancelQueued(threadId, MessageId.make("sdk_msg_cancel_queued"));
        cancelIssued = true;
        const watched = await withTimeout(
          settled.promise,
          8000,
          "watch did not settle after cancel",
        );
        await waitForIdle(honk, threadId);
        expect(sawCancelledText).toBe(false);
        expect(textParts(watched)).not.toContain("cancel me");
      } finally {
        watch.close();
        await honk.close();
      }
    });
  });

  it("removes archived threads from workspace watch and restores them on unarchive", async () => {
    await withServer(async (origin, bearer) => {
      const honk = await connect({ origin, bearer });
      const threadId = ThreadId.make("sdk_workspace_archive_restore");
      const initial = makeDeferred<WorkspaceState>();
      const archived = makeDeferred<WorkspaceState>();
      const unarchived = makeDeferred<WorkspaceState>();
      let sawInitial = false;
      let sawArchived = false;
      await honk.threads.create(createPayload(threadId));
      const watch = honk.workspace.watch({
        onChange: (state) => {
          const hasThread = state.threads.some((thread) => String(thread.id) === String(threadId));
          if (hasThread && !sawInitial) {
            sawInitial = true;
            initial.resolve(state);
          }
          if (sawInitial && !hasThread && !sawArchived) {
            sawArchived = true;
            archived.resolve(state);
          }
          if (sawArchived && hasThread) {
            unarchived.resolve(state);
          }
        },
      });
      try {
        await withTimeout(initial.promise, 8000, "workspace watch did not include thread");
        await honk.threads.archive(threadId);
        const archivedState = await withTimeout(
          archived.promise,
          8000,
          "workspace watch did not remove archived thread",
        );
        expect(archivedState.threads.some((thread) => String(thread.id) === String(threadId))).toBe(
          false,
        );
        await honk.threads.unarchive(threadId);
        const unarchivedState = await withTimeout(
          unarchived.promise,
          8000,
          "workspace watch did not restore unarchived thread",
        );
        expect(
          unarchivedState.threads.some((thread) => String(thread.id) === String(threadId)),
        ).toBe(true);
      } finally {
        watch.close();
        await honk.close();
      }
    });
  });

  it("parses prompt tokens with the production grammar", () => {
    const cases = [
      {
        text: "open @packages/app ",
        kinds: ["text", "mention", "text"],
      },
      {
        text: "run $review ",
        kinds: ["text", "skill", "text"],
      },
      {
        text: "run [$review](skills/review.md) ",
        kinds: ["text", "skill", "text"],
      },
      {
        text: "see [@thread](file://thread.json)",
        kinds: ["text", "inline"],
      },
      {
        text: "prefer [$review](skills/review.md) over [x](file://x)",
        kinds: ["text", "skill", "text", "inline"],
      },
      {
        text: "@no-trailing-space",
        kinds: ["text"],
      },
      {
        text: "$no-trailing-space",
        kinds: ["text"],
      },
    ];

    for (const item of cases) {
      const tokens = parsePromptTokens(item.text);
      expect(tokens.map((token) => token.kind)).toEqual(item.kinds);
      expect(tokens.map(serializeToken).join("")).toBe(item.text);
    }
    expect(parsePromptTokens("see [@label](file://x)")[1]).toMatchObject({
      kind: "inline",
      label: "label",
      uri: "file://x",
    });
    expect(parsePromptTokens("run [$review](skills/review.md) ")[1]).toMatchObject({
      kind: "skill",
      name: "review",
      path: "skills/review.md",
    });
  });

  it.skip("treats server goodbye as closed, not reconnecting", () => {
    // The in-process server layer is scoped per test helper call; orchestrating
    // shutdown while keeping the SDK watch alive needs a separate harness.
  });
});
