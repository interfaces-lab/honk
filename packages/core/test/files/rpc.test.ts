// The wire path: the same operations traveling through the RPC handlers.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { Files } from "../../src/files";
import { openTrustedWorkspace } from "../../src/testing";
import { handlers } from "./fixture";

describe("files rpc handlers", () => {
  it.effect("write, list, and read travel the wire path intact", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "honk-files-rpc-")));
      const opened = yield* openTrustedWorkspace(directory);
      const client = yield* RpcTest.makeClient(Files.Rpcs);

      yield* client["files.write"]({
        workspaceId: opened.id,
        path: "hello.txt",
        content: "hello",
      });

      const listed = yield* client["files.list"]({ workspaceId: opened.id });
      expect(listed.map((entry) => entry.path)).toEqual(["hello.txt"]);

      const read = yield* client["files.read"]({ workspaceId: opened.id, path: "hello.txt" });
      expect(read).toEqual({ type: "text", text: "hello", truncated: false });

      const escaped = yield* client["files.read"]({
        workspaceId: opened.id,
        path: "../escape.txt",
      }).pipe(Effect.flip);
      expect(escaped).toBeInstanceOf(Files.EscapeError);

      yield* Effect.promise(() => rm(directory, { recursive: true, force: true }));
    }).pipe(Effect.provide(handlers)),
  );
});
