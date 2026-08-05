// Deterministic session fixtures on Pi's own faux provider: the real
// AgentHarness and transcript machinery with only the LLM call faked. Shared
// by core, desktop, and app tests; never imported by production paths.

import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { MessageEntry, SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import type { FauxResponseStep } from "@earendil-works/pi-ai/providers/faux";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Effect, Layer } from "effect";

import { Git } from "./git";
import { Models } from "./models";
import { createNodeExecutionEnv } from "./node";
import { Session } from "./session";
import { Workspace } from "./workspace";

// Tests run in Node, so they use Pi's real Node environment rather than a
// stub: file and git built-ins are only meaningfully tested against a real
// filesystem.
export const createExecutionEnv = createNodeExecutionEnv;

// A fresh host data directory per call: persistence tests get isolation for
// free, and nothing leaks between suites through a shared store.
export const createTestStorage = () =>
  createExecutionEnv(mkdtempSync(join(tmpdir(), "honk-data-")));

export const makeFauxSessionLayer = () => {
  const faux = fauxProvider();
  const collection = createModels();
  collection.setProvider(faux.provider);
  const storage = createTestStorage();
  // The faux provider's auth always resolves, so it is "configured" with an
  // empty credential store — default model resolution lands on it with no
  // setup, exactly as a credentialed provider would in production.
  const credentials = Models.credentialStore(storage);
  const modelsLayer = Models.layer({ collection, credentials });
  // Session snapshots settled turns through Git.Service, so the session
  // layer needs it even in tests that never read a diff.
  const sessionLayer = Session.layer({ storage }).pipe(
    Layer.provide(Git.defaultLayer),
    Layer.provide(modelsLayer),
  );
  // Self-contained app layer: one workspace instance shared by the session
  // layer and the test program, so ids minted by trust are findable.
  const appLayer = sessionLayer.pipe(
    Layer.provideMerge(Workspace.defaultLayer({ createExecutionEnv, storage })),
  );
  // `createModels` is what a host test passes to createHonkCore; the
  // pre-built layers stay for tests that provide services directly.
  return {
    faux,
    model: faux.getModel(),
    createModels: () => collection,
    createExecutionEnv,
    modelsLayer,
    sessionLayer,
    appLayer,
  };
};

// Sessions bind to trusted workspaces only, so nearly every session test
// starts by walking the real trust flow. Trust canonicalizes through the real
// filesystem, so the fixture directory is created first.
export const openTrustedWorkspace = (directory: string) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => mkdir(directory, { recursive: true }));
    const workspace = yield* Workspace.Service;
    yield* workspace.trust({ directory });
    const opened = yield* workspace.open({ directory });
    if (!Workspace.OpenResult.guards.ready(opened)) {
      return yield* Effect.die(new Error("expected a ready workspace after trust"));
    }
    return opened;
  });

// A response the test releases explicitly, so "while the run is active" is a
// deterministic program point instead of a sleep. Honors Pi's abort signal
// like a real provider: an aborted call returns immediately and the faux
// stream marks the message aborted.
export const gatedResponse = (text: string) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response: FauxResponseStep = async (_context, options) => {
    const signal = options?.signal;
    if (signal !== undefined) {
      const aborted = new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      await Promise.race([gate, aborted]);
    } else {
      await gate;
    }
    return fauxAssistantMessage(text);
  };
  return { release, response };
};

export const messageEntries = (entries: readonly SessionTreeEntry[]): MessageEntry[] =>
  entries.filter((entry): entry is MessageEntry => entry.type === "message");

export const textOf = (entry: MessageEntry | undefined): string | undefined => {
  const message = entry?.message;
  if (message?.role !== "user" && message?.role !== "assistant") return undefined;
  if (typeof message.content === "string") return message.content;
  const block = message.content.find((part) => part.type === "text");
  return block?.type === "text" ? block.text : undefined;
};
