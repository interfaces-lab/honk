import type { OpencodeClient, SessionV2Info } from "@opencode-ai/sdk/v2/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenCodeClient, OpenCodeRequestError } from "./client";
import {
  createOpenCodeServer,
  openCodeMessageID,
  openCodeSessionRef,
  type OpenCodeMessageID,
} from "./identity";
import type { OpenCodeEventSourceInput } from "./event-stream";

const sdk = vi.hoisted(() => ({
  createOpencodeClient: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: sdk.createOpencodeClient,
}));

function response<Data>(data: Data, init?: ResponseInit) {
  return {
    data,
    error: undefined,
    request: new Request("http://opencode.test"),
    response: new Response(undefined, init),
  };
}

function session(index: number, directory: string, updated: number): SessionV2Info {
  return {
    id: `ses_${String(index)}`,
    slug: `session-${String(index)}`,
    projectID: directory,
    title: `Session ${String(index)}`,
    time: { created: updated, updated },
    location: { directory },
  } as unknown as SessionV2Info;
}

describe("createOpenCodeClient sessions.list", () => {
  beforeEach(() => {
    sdk.createOpencodeClient.mockReset();
  });

  it("lists sessions through the generated SDK namespace", async () => {
    const documents = Array.from({ length: 2 }, (_, index) =>
      session(index, "/Users/test/Documents", 1_000 - index),
    );
    const list = vi.fn(() => Promise.resolve(response({ data: documents, cursor: undefined })));
    const opencode = {
      v2: {
        session: { list },
        health: { get: () => Promise.resolve(response({ healthy: true })) },
      },
    } as unknown as OpencodeClient;
    sdk.createOpencodeClient.mockReturnValue(opencode);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const result = await client.sessions.list({ limit: 100 });
    client.close();

    expect(result.data).toHaveLength(2);
    expect(list).toHaveBeenCalled();
  });

  it("finds files through the V2 filesystem namespace", async () => {
    const find = vi.fn(() =>
      Promise.resolve(
        response({
          location: { directory: "/Users/test/Documents" },
          data: [{ path: "src/index.ts", type: "file" as const }],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({ v2: { fs: { find } } } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const controller = new AbortController();
    const result = await client.files.find(
      "index",
      { directory: "/Users/test/Documents" },
      { signal: controller.signal },
    );
    client.close();

    expect(result.data).toEqual([{ path: "src/index.ts", type: "file" }]);
    expect(find).toHaveBeenCalledWith(
      {
        query: "index",
        limit: "32",
        location: { directory: "/Users/test/Documents" },
      },
      { signal: controller.signal },
    );
  });

  it("lists directory children through the V2 filesystem namespace", async () => {
    const list = vi.fn(() =>
      Promise.resolve(
        response({
          location: { directory: "/Users/test/Documents" },
          data: [
            { path: "src/lib/", type: "directory" as const },
            { path: "src/index.ts", type: "file" as const },
          ],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({ v2: { fs: { list } } } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const result = await client.files.list("src", { directory: "/Users/test/Documents" });
    // Omitting the path must not send `path: undefined`; the sidecar defaults it to the root.
    await client.files.list();
    client.close();

    expect(result.data).toEqual([
      { path: "src/lib/", type: "directory" },
      { path: "src/index.ts", type: "file" },
    ]);
    expect(list).toHaveBeenNthCalledWith(1, {
      path: "src",
      location: { directory: "/Users/test/Documents" },
    });
    expect(list).toHaveBeenNthCalledWith(2, {});
  });

  it("reads byte-accurate text through the V2 filesystem route", async () => {
    const request = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response("export const a = 1;  \n", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    const result = await client.files.read("src/index.ts", {
      directory: "/Users/test/Documents",
    });
    client.close();

    expect(result).toEqual({ kind: "text", text: "export const a = 1;  \n" });
    const sent = request.mock.calls[0]?.[0];
    expect(sent).toBeInstanceOf(Request);
    const url = new URL((sent as Request).url);
    expect(url.pathname).toBe("/api/fs/read/src/index.ts");
    expect(url.searchParams.get("location[directory]")).toBe("/Users/test/Documents");
  });

  it("preserves a UTF-8 byte order mark", async () => {
    const request = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), {
          headers: { "content-type": "text/plain" },
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    const result = await client.files.read("src/index.ts");
    client.close();

    expect(result).toEqual({ kind: "text", text: "\uFEFFa" });
  });

  it("reads binary files as base64 with their mime type", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png" } }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    const result = await client.files.read("assets/icon.png", {
      directory: "/Users/test/Documents",
    });
    client.close();

    expect(result).toEqual({ kind: "binary", base64: "AQI=", mimeType: "image/png" });
  });

  it("omits mimeType entirely for undecodable bytes without a content type", async () => {
    const request = vi.fn(() =>
      Promise.resolve(
        new Response(new Uint8Array([0xff, 0xfe]), {
          headers: { "content-type": "" },
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    const result = await client.files.read("assets/blob.bin");
    client.close();

    expect(result).toEqual({ kind: "binary", base64: "//4=" });
    expect("mimeType" in result).toBe(false);
  });

  it("sends no location keys when the location is omitted", async () => {
    const request = vi.fn((_input: RequestInfo | URL) => Promise.resolve(new Response("a")));
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    await client.files.read("src/index.ts");
    client.close();

    const sent = request.mock.calls[0]?.[0] as Request;
    expect(new URL(sent.url).search).toBe("");
  });

  it("reads an empty file without a parent directory listing", async () => {
    const request = vi.fn(() => Promise.resolve(new Response("")));
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    const result = await client.files.read("empty.ts");
    client.close();

    expect(result).toEqual({ kind: "text", text: "" });
  });

  it("surfaces read failures as OpenCodeRequestError with the response status", async () => {
    const request = vi.fn(() =>
      Promise.resolve(new Response("Path is not a file", { status: 400 })),
    );
    sdk.createOpencodeClient.mockReturnValue({} as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }), {
      fetch: request,
    });
    const failure = await client.files.read("src/").catch((error: unknown) => error);
    client.close();

    expect(failure).toBeInstanceOf(OpenCodeRequestError);
    expect(failure).toMatchObject({
      message: "Path is not a file",
      operation: "fs.read",
      status: 400,
    });
  });

  it("saves text through a contextual VCS patch", async () => {
    const apply = vi.fn(() => Promise.resolve(response({ applied: true })));
    sdk.createOpencodeClient.mockReturnValue({ vcs: { apply } } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    await client.files.write(
      "src/value.ts",
      { expectedContents: "const value = 1;\n", contents: "const value = 2;\n" },
      { directory: "/Users/test/Documents" },
    );
    client.close();

    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({
      directory: "/Users/test/Documents",
      patch: expect.stringContaining("-const value = 1;\n+const value = 2;"),
    });
  });

  it("quotes file names with spaces in the generated patch", async () => {
    const apply = vi.fn(() => Promise.resolve(response({ applied: true })));
    sdk.createOpencodeClient.mockReturnValue({ vcs: { apply } } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    await client.files.write("src dir/value file.ts", {
      expectedContents: "one\n",
      contents: "two\n",
    });
    client.close();

    expect(apply).toHaveBeenCalledWith({
      patch: expect.stringContaining('--- "a/src dir/value file.ts"'),
    });
  });

  it("does not call the sidecar when the file has no edits", async () => {
    const apply = vi.fn();
    sdk.createOpencodeClient.mockReturnValue({ vcs: { apply } } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    await client.files.write("src/value.ts", { expectedContents: "same", contents: "same" });
    client.close();

    expect(apply).not.toHaveBeenCalled();
  });

  it("surfaces a rejected patch from a non-git or overlapping working tree", async () => {
    const apply = vi.fn(() =>
      Promise.resolve({
        data: undefined,
        error: {
          name: "VcsApplyError",
          data: { message: "Patch can't be applied", reason: "not-clean" },
        },
        request: new Request("http://opencode.test"),
        response: new Response(undefined, { status: 400 }),
      }),
    );
    sdk.createOpencodeClient.mockReturnValue({ vcs: { apply } } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const failure = await client.files
      .write("src/value.ts", { expectedContents: "one", contents: "two" })
      .catch((error: unknown) => error);
    client.close();

    expect(failure).toMatchObject({
      message: "Patch can't be applied",
      operation: "vcs.apply",
      status: 400,
    });
  });

  it("lists commands through the V2 command namespace", async () => {
    const list = vi.fn(() =>
      Promise.resolve(
        response({
          location: { directory: "/Users/test/Documents" },
          data: [{ name: "test", template: "Run tests" }],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      v2: { command: { list } },
    } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const result = await client.commands.list({ directory: "/Users/test/Documents" });
    client.close();

    expect(result.data).toEqual([{ name: "test", template: "Run tests" }]);
    expect(list).toHaveBeenCalledWith({ location: { directory: "/Users/test/Documents" } });
  });

  it("lists skills through the V2 skill namespace", async () => {
    const list = vi.fn(() =>
      Promise.resolve(
        response({
          location: { directory: "/Users/test/Documents" },
          data: [
            {
              name: "review",
              description: "Review changes",
              slash: true,
              location: "/skills/review/SKILL.md",
              content: "Review the current changes.",
            },
          ],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      v2: { skill: { list } },
    } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const result = await client.skills.list({ directory: "/Users/test/Documents" });
    client.close();

    expect(result.data[0]?.name).toBe("review");
    expect(list).toHaveBeenCalledWith({ location: { directory: "/Users/test/Documents" } });
  });

  it("creates parented sessions through the stable runner and returns the V2 projection", async () => {
    const parent = session(1, "/Users/test/Documents", 1_000);
    const child = {
      ...session(2, "/Users/test/Documents", 1_100),
      parentID: parent.id,
      title: "New Side Chat",
      agent: "honk-build",
      model: { id: "gpt-5.6-sol", providerID: "openai", variant: "high" },
    };
    const create = vi.fn(() => Promise.resolve(response({ id: child.id })));
    const switchAgent = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    const switchModel = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    const get = vi.fn(() => Promise.resolve(response({ data: child })));
    sdk.createOpencodeClient.mockReturnValue({
      session: { create },
      v2: { session: { get, switchAgent, switchModel } },
    } as unknown as OpencodeClient);

    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);
    const created = await client.sessions.create({
      parentID: parent.id,
      title: "New Side Chat",
      agent: "honk-build",
      model: { id: "gpt-5.6-sol", providerID: "openai", variant: "high" },
      location: { directory: "/Users/test/Documents" },
    });
    client.close();

    expect(created).toMatchObject({ id: child.id, parentID: parent.id, title: "New Side Chat" });
    expect(create).toHaveBeenCalledWith({
      parentID: parent.id,
      title: "New Side Chat",
      directory: "/Users/test/Documents",
    });
    expect(switchAgent).toHaveBeenCalledWith({ sessionID: child.id, agent: "honk-build" });
    expect(switchModel).toHaveBeenCalledWith({
      sessionID: child.id,
      model: { id: "gpt-5.6-sol", providerID: "openai", variant: "high" },
    });
    expect(get).toHaveBeenCalledWith({ sessionID: child.id });
  });

  it("loads persisted messages when the projected transcript is empty", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const persistedMessages = [
      {
        info: {
          id: "msg_persisted",
          sessionID: info.id,
          role: "user" as const,
          time: { created: 900 },
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
        parts: [
          {
            id: "prt_persisted",
            sessionID: info.id,
            messageID: "msg_persisted",
            type: "text" as const,
            text: "Persisted history",
          },
        ],
      },
    ];
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const projected = vi.fn(() =>
      Promise.resolve(response({ data: [], cursor: { next: undefined } })),
    );
    const persisted = vi.fn(() => Promise.resolve(response(persistedMessages)));
    sdk.createOpencodeClient.mockReturnValue({
      session: { messages: persisted },
      v2: { session: { get, messages: projected } },
    } as unknown as OpencodeClient);

    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);
    const transcript = await client.sessions.transcript(openCodeSessionRef(server.key, info.id));
    client.close();

    expect(transcript.messages.map((message) => message.id)).toEqual(["msg_persisted"]);
    expect(transcript.parts).toEqual([
      expect.objectContaining({ id: "prt_persisted", text: "Persisted history" }),
    ]);
    expect(transcript.sources).toEqual({ persistedMessages: 1, projectedMessages: 0 });
    expect(persisted).toHaveBeenCalledWith({
      sessionID: info.id,
      limit: 200,
    });
  });

  it("continues projected message pagination without resending the encoded order", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const projected = vi
      .fn()
      .mockResolvedValueOnce(response({ data: [], cursor: { next: "next-page" } }))
      .mockResolvedValueOnce(response({ data: [], cursor: {} }));
    const persisted = vi.fn(() => Promise.resolve(response([])));
    sdk.createOpencodeClient.mockReturnValue({
      session: { messages: persisted },
      v2: { session: { get, messages: projected } },
    } as unknown as OpencodeClient);

    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);
    await client.sessions.transcript(openCodeSessionRef(server.key, info.id));
    client.close();

    expect(projected.mock.calls).toEqual([
      [{ sessionID: info.id, limit: 200, order: "asc" }],
      [{ sessionID: info.id, limit: 200, cursor: "next-page" }],
    ]);
  });

  it("constructs message IDs accepted by OpenCode", () => {
    expect(openCodeMessageID("3bb9e4f3-4ebe-406c-a59c-48f6db0fb522")).toBe(
      "msg_3bb9e4f3-4ebe-406c-a59c-48f6db0fb522",
    );
    expect(openCodeMessageID("msg_existing")).toBe("msg_existing");
  });

  it("routes prompts through the stable runner with normalized IDs and attachments", async () => {
    const info = {
      ...session(1, "/Users/test/Documents", 1_000),
      agent: "honk-build",
      model: { id: "gpt-5.6-sol", providerID: "openai", variant: "high" },
    };
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const promptAsync = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    sdk.createOpencodeClient.mockReturnValue({
      session: { promptAsync },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);

    await client.sessions.prompt(openCodeSessionRef(server.key, "ses_1"), {
      id: "uuid" as OpenCodeMessageID,
      prompt: {
        text: "Hello",
        files: [
          {
            uri: "src/index.ts",
            name: "index.ts",
            description: "text/typescript",
            source: { text: "src/index.ts", start: 0, end: 12 },
          },
          {
            uri: "data:image/png;base64,AAAA",
            name: "screenshot.png",
          },
        ],
        agents: [{ name: "review", source: { text: "@review", start: 13, end: 20 } }],
      },
    });
    client.close();

    expect(get).toHaveBeenCalledWith({ sessionID: "ses_1" });
    expect(promptAsync).toHaveBeenCalledWith({
      sessionID: "ses_1",
      directory: "/Users/test/Documents",
      messageID: "msg_uuid",
      agent: "honk-build",
      model: { providerID: "openai", modelID: "gpt-5.6-sol" },
      variant: "high",
      parts: [
        { type: "text", text: "Hello" },
        {
          type: "file",
          mime: "text/typescript",
          filename: "index.ts",
          url: "file:///Users/test/Documents/src/index.ts",
          source: {
            type: "file",
            path: "src/index.ts",
            text: { value: "src/index.ts", start: 0, end: 12 },
          },
        },
        {
          type: "file",
          mime: "image/png",
          filename: "screenshot.png",
          url: "data:image/png;base64,AAAA",
        },
        {
          type: "agent",
          name: "review",
          source: { value: "@review", start: 13, end: 20 },
        },
      ],
    });
  });

  it("routes explicit compaction through the stable runner", async () => {
    const info = {
      ...session(1, "/Users/test/Documents", 1_000),
      model: { id: "gpt-5.6-sol", providerID: "openai", variant: "high" },
    };
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const summarize = vi.fn(() => Promise.resolve(response(true)));
    sdk.createOpencodeClient.mockReturnValue({
      session: { summarize },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);

    await client.sessions.compact(openCodeSessionRef(server.key, info.id));
    client.close();

    expect(summarize).toHaveBeenCalledWith({
      sessionID: info.id,
      directory: "/Users/test/Documents",
      providerID: "openai",
      modelID: "gpt-5.6-sol",
      auto: false,
    });
  });

  it("attaches prompt metadata and synthetic presentation to the emitted text part", async () => {
    const info = {
      ...session(1, "/Users/test/Documents", 1_000),
      agent: "honk-build",
    };
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const promptAsync = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    sdk.createOpencodeClient.mockReturnValue({
      session: { promptAsync },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);

    await client.sessions.prompt(openCodeSessionRef(server.key, "ses_1"), {
      prompt: {
        text: "Hello",
        metadata: { source: "quick-action" },
        synthetic: true,
      },
    });
    client.close();

    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: "text",
            text: "Hello",
            metadata: { source: "quick-action" },
            synthetic: true,
          },
        ],
      }),
    );
  });

  it("reads active sessions from the host-configured runner", async () => {
    const status = vi.fn(() =>
      Promise.resolve(
        response({
          ses_busy: { type: "busy" as const },
          ses_idle: { type: "idle" as const },
          ses_retry: { type: "retry" as const, attempt: 1, message: "retry", next: 2 },
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      session: { status },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    await expect(client.sessions.active()).resolves.toEqual({
      ses_busy: { type: "running" },
      ses_retry: { type: "running" },
    });
    expect(status).toHaveBeenCalledOnce();
    client.close();
  });

  it("interrupts the host-configured runner in the session location", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const abort = vi.fn(() => Promise.resolve(response(true)));
    sdk.createOpencodeClient.mockReturnValue({
      session: { abort },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);

    await client.sessions.interrupt(openCodeSessionRef(server.key, info.id));

    expect(abort).toHaveBeenCalledWith({
      sessionID: info.id,
      directory: info.location.directory,
    });
    client.close();
  });

  it("reads the newest user turn's snapshot diff and normalizes its rows", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const messages = vi.fn(() =>
      Promise.resolve(
        response([
          { info: { id: "msg_user_1", role: "user" as const }, parts: [] },
          { info: { id: "msg_assistant_1", role: "assistant" as const }, parts: [] },
          { info: { id: "msg_user_2", role: "user" as const }, parts: [] },
          { info: { id: "msg_assistant_2", role: "assistant" as const }, parts: [] },
        ]),
      ),
    );
    const diff = vi.fn(() =>
      Promise.resolve(
        response([
          { file: "src/a.ts", patch: "@@", additions: 2, deletions: 1, status: "added" as const },
          { file: "src/b.ts", additions: 0, deletions: 3 },
          { additions: 9, deletions: 9 },
        ]),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      session: { messages, diff },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);

    const diffs = await client.sessions.lastTurnDiff(openCodeSessionRef(server.key, info.id));
    client.close();

    expect(diff).toHaveBeenCalledWith({
      sessionID: info.id,
      directory: info.location.directory,
      messageID: "msg_user_2",
    });
    expect(diffs).toEqual([
      { file: "src/a.ts", patch: "@@", additions: 2, deletions: 1, status: "added" },
      { file: "src/b.ts", additions: 0, deletions: 3, status: "modified" },
    ]);
  });

  it("skips the snapshot diff request when the session has no user message", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const messages = vi.fn(() => Promise.resolve(response([])));
    const diff = vi.fn(() => Promise.resolve(response([])));
    sdk.createOpencodeClient.mockReturnValue({
      session: { messages, diff },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);

    expect(await client.sessions.lastTurnDiff(openCodeSessionRef(server.key, info.id))).toEqual([]);
    expect(diff).not.toHaveBeenCalled();
    client.close();
  });

  it("reverts an edited message through the host runner and can restore it", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const get = vi.fn(() => Promise.resolve(response({ data: info })));
    const revert = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    const unrevert = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    sdk.createOpencodeClient.mockReturnValue({
      session: { revert, unrevert },
      v2: { session: { get } },
    } as unknown as OpencodeClient);
    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);
    const ref = openCodeSessionRef(server.key, info.id);

    await client.sessions.revert(ref, { messageID: "msg_user_2" });
    await client.sessions.unrevert(ref);

    expect(revert).toHaveBeenCalledWith({
      sessionID: info.id,
      directory: info.location.directory,
      messageID: "msg_user_2",
    });
    expect(unrevert).toHaveBeenCalledWith({
      sessionID: info.id,
      directory: info.location.directory,
    });
    client.close();
  });

  it("reads and settles stable-runner questions through the execution-owned queue", async () => {
    const info = session(1, "/Users/test/Documents", 1_000);
    const list = vi.fn(() =>
      Promise.resolve(response({ data: [info], cursor: { next: undefined } })),
    );
    const permissionList = vi.fn(() =>
      Promise.resolve(
        response({
          location: {
            directory: info.location.directory,
            project: { id: "project", directory: info.location.directory },
          },
          data: [
            { id: "per_match", sessionID: info.id, action: "read", resources: ["src"] },
            { id: "per_other", sessionID: "ses_other", action: "read", resources: ["src"] },
          ],
        }),
      ),
    );
    const questionList = vi.fn(() =>
      Promise.resolve(response([{ id: "que_match", sessionID: info.id, questions: [] }])),
    );
    const questionReply = vi.fn(() => Promise.resolve(response(true)));
    const questionReject = vi.fn(() => Promise.resolve(response(true)));
    sdk.createOpencodeClient.mockReturnValue({
      question: { list: questionList, reply: questionReply, reject: questionReject },
      v2: {
        session: { list },
        permission: { request: { list: permissionList } },
      },
    } as unknown as OpencodeClient);

    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server);
    await client.sessions.list();
    const ref = openCodeSessionRef(server.key, info.id);

    await expect(client.sessions.permissions(ref)).resolves.toEqual([
      expect.objectContaining({ id: "per_match" }),
    ]);
    await expect(client.sessions.questions(ref)).resolves.toEqual([
      expect.objectContaining({ id: "que_match" }),
    ]);
    await client.sessions.replyQuestion(ref, "que_match", { answers: [["Persist it"]] });
    await client.sessions.rejectQuestion(ref, "que_match");
    expect(permissionList).toHaveBeenCalledWith({
      location: { directory: info.location.directory },
    });
    expect(questionList).toHaveBeenCalledWith({
      directory: info.location.directory,
    });
    expect(questionReply).toHaveBeenCalledWith({
      requestID: "que_match",
      directory: info.location.directory,
      answers: [["Persist it"]],
    });
    expect(questionReject).toHaveBeenCalledWith({
      requestID: "que_match",
      directory: info.location.directory,
    });
    client.close();
  });

  it("opens only the complete server-wide event stream", async () => {
    const requested: OpenCodeEventSourceInput[] = [];
    const eventSource = vi.fn(async (input: OpenCodeEventSourceInput) => {
      requested.push(input);
      return (async function* eventStream(): AsyncGenerator<unknown> {
        // Port of anomalyco/opencode@v1.18.10's `event-v2-bridge.ts` → global
        // handler contract: stable live events and native V2 events share this
        // envelope, while each durable event also produces a duplicate `sync`.
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: {
            id: "evt_status",
            type: "session.status",
            properties: { sessionID: "ses_1", status: { type: "busy" } },
          },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: {
            id: "evt_delta",
            type: "message.part.delta",
            properties: {
              sessionID: "ses_1",
              messageID: "msg_1",
              partID: "prt_1",
              field: "text",
              delta: "hello",
            },
          },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: {
            id: "evt_agent",
            type: "session.next.agent.switched",
            properties: {
              sessionID: "ses_1",
              messageID: "msg_agent",
              timestamp: 12,
              agent: "honk-plan",
            },
          },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: {
            id: "evt_question",
            type: "question.asked",
            properties: { id: "question_1", sessionID: "ses_1", questions: [] },
          },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: { type: "sync", sessions: [] },
        };
        yield { payload: { type: "server.connected" } };
        yield { payload: { id: "evt_heartbeat", type: "server.heartbeat" } };
      })();
    });
    sdk.createOpencodeClient.mockReturnValue({ v2: {} } as unknown as OpencodeClient);

    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server, { password: "secret", eventSource });
    const events = await collect(client.events());
    client.close();

    expect(events).toEqual([
      {
        id: "evt_status",
        type: "session.status",
        data: { sessionID: "ses_1", status: { type: "busy" } },
      },
      {
        id: "evt_delta",
        type: "message.part.delta",
        data: {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta: "hello",
        },
      },
      {
        id: "evt_agent",
        type: "session.next.agent.switched",
        data: {
          sessionID: "ses_1",
          messageID: "msg_agent",
          timestamp: 12,
          agent: "honk-plan",
        },
      },
      {
        id: "evt_question",
        type: "question.asked",
        data: { id: "question_1", sessionID: "ses_1", questions: [] },
      },
      { type: "server.connected", data: {} },
      { id: "evt_heartbeat", type: "server.heartbeat", data: {} },
    ]);
    expect(requested.map((input) => input.url)).toEqual(["http://opencode.test/global/event"]);
    expect(requested.every((input) => input.headers.Authorization?.startsWith("Basic "))).toBe(
      true,
    );
  });

  it("subscribes through the generated global event API", async () => {
    const event = vi.fn(async () => ({
      stream: (async function* eventStream(): AsyncGenerator<unknown> {
        yield {
          directory: "/Users/workgyver/Developer/honk",
          workspace: "workspace-1",
          payload: {
            id: "evt_delta",
            type: "message.part.delta",
            properties: {
              sessionID: "ses_1",
              messageID: "msg_1",
              partID: "prt_1",
              field: "text",
              delta: "hello",
            },
          },
        };
      })(),
    }));
    sdk.createOpencodeClient.mockReturnValue({
      global: { event },
      v2: {},
    } as unknown as OpencodeClient);

    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const events = await collect(client.events());
    client.close();

    expect(events).toEqual([
      {
        id: "evt_delta",
        type: "message.part.delta",
        data: {
          sessionID: "ses_1",
          messageID: "msg_1",
          partID: "prt_1",
          field: "text",
          delta: "hello",
        },
      },
    ]);
    expect(event).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  });

  it("lists integrations through the V2 namespace", async () => {
    const integrationList = vi.fn(() =>
      Promise.resolve(
        response({
          location: { directory: "/repo" },
          data: [{ id: "openai", name: "OpenAI", methods: [], connections: [] }],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      v2: { integration: { list: integrationList } },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const listed = await client.providers.list();
    client.close();

    expect(listed).toEqual([{ id: "openai", name: "OpenAI", methods: [], connections: [] }]);
    expect(integrationList).toHaveBeenCalledOnce();
  });

  it("connects and removes credentials through the V2 integration namespace", async () => {
    const oauth = vi.fn(() =>
      Promise.resolve(
        response({
          location: { directory: "/repo" },
          data: {
            attemptID: "attempt_1",
            url: "https://auth.example.test",
            mode: "code" as const,
            instructions: "Paste the code",
            time: { created: 1, expires: 2 },
          },
        }),
      ),
    );
    const complete = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    const key = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    const remove = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    sdk.createOpencodeClient.mockReturnValue({
      v2: {
        integration: {
          connect: { oauth, key },
          attempt: { complete },
        },
        credential: { remove },
      },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    await client.providers.connectOauth("openai", "browser", { account: "personal" });
    await client.providers.completeOauth("attempt_1", "code");
    await client.providers.setApiKey("openai", "secret");
    await client.providers.removeCredential("cred_1");
    client.close();

    expect(oauth).toHaveBeenCalledWith({
      integrationID: "openai",
      methodID: "browser",
      inputs: { account: "personal" },
    });
    expect(complete).toHaveBeenCalledWith({ attemptID: "attempt_1", code: "code" });
    expect(key).toHaveBeenCalledWith({ integrationID: "openai", key: "secret" });
    expect(remove).toHaveBeenCalledWith({ credentialID: "cred_1" });
  });

  it("reads working-tree status and patches through the generated VCS namespace", async () => {
    const info = vi.fn(() => Promise.resolve(response({ branch: "codex/tools" })));
    const status = vi.fn(() =>
      Promise.resolve(
        response([{ file: "src/tool.ts", additions: 4, deletions: 1, status: "modified" }]),
      ),
    );
    const diff = vi.fn(() =>
      Promise.resolve(
        response([
          {
            file: "src/tool.ts",
            additions: 4,
            deletions: 1,
            status: "modified",
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
        ]),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      vcs: { get: info, status, diff },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    await expect(client.vcs.info({ directory: "/repo" })).resolves.toEqual({
      branch: "codex/tools",
    });
    await expect(client.vcs.status({ directory: "/repo" })).resolves.toHaveLength(1);
    await expect(client.vcs.diff({ directory: "/repo", mode: "git", context: 5 })).resolves.toEqual(
      [expect.objectContaining({ file: "src/tool.ts", patch: expect.stringContaining("+new") })],
    );
    client.close();

    expect(info).toHaveBeenCalledWith({ directory: "/repo" });
    expect(status).toHaveBeenCalledWith({ directory: "/repo" });
    expect(diff).toHaveBeenCalledWith({ directory: "/repo", mode: "git", context: 5 });
  });

  it("creates and removes project copies through the canonical generated namespace", async () => {
    const create = vi.fn(() => Promise.resolve(response({ directory: "/copies/task" })));
    const remove = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    sdk.createOpencodeClient.mockReturnValue({
      v2: { projectCopy: { create, remove } },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    await expect(
      client.projectCopies.create({
        projectID: "project-1",
        location: { directory: "/repo" },
        strategy: "git_worktree",
        directory: "/copies",
      }),
    ).resolves.toEqual({ directory: "/copies/task" });
    await client.projectCopies.remove({
      projectID: "project-1",
      location: { directory: "/repo" },
      directory: "/copies/task",
      force: false,
    });
    client.close();

    expect(create).toHaveBeenCalledWith({
      projectID: "project-1",
      location: { directory: "/repo" },
      strategy: "git_worktree",
      directory: "/copies",
    });
    expect(remove).toHaveBeenCalledWith({
      projectID: "project-1",
      location: { directory: "/repo" },
      directory: "/copies/task",
      force: false,
    });
  });

  it("keeps MCP lifecycle on the stable mcp namespace", async () => {
    const status = vi.fn(() =>
      Promise.resolve(
        response({
          linear: { status: "connected" as const },
          notion: { status: "needs_auth" as const },
          broken: { status: "failed" as const, error: "spawn ENOENT" },
        }),
      ),
    );
    const add = vi.fn(() =>
      Promise.resolve(response({ linear: { status: "connected" as const } })),
    );
    const connect = vi.fn(() => Promise.resolve(response(true)));
    const disconnect = vi.fn(() => Promise.resolve(response(true)));
    const authenticate = vi.fn(() => Promise.resolve(response({ status: "connected" as const })));
    const remove = vi.fn(() => Promise.resolve(response({ success: true as const })));
    sdk.createOpencodeClient.mockReturnValue({
      mcp: { status, add, connect, disconnect, auth: { authenticate, remove } },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    await expect(client.mcp.status({ directory: "/repo" })).resolves.toEqual({
      linear: { status: "connected" },
      notion: { status: "needs_auth" },
      broken: { status: "failed", error: "spawn ENOENT" },
    });
    await expect(client.mcp.connect("linear", { directory: "/repo" })).resolves.toBe(true);
    await expect(
      client.mcp.add(
        "linear",
        { type: "remote", url: "https://mcp.linear.app/sse" },
        { directory: "/repo" },
      ),
    ).resolves.toEqual({ linear: { status: "connected" } });
    await expect(client.mcp.disconnect("linear")).resolves.toBe(true);
    await expect(client.mcp.authenticate("notion", { directory: "/repo" })).resolves.toEqual({
      status: "connected",
    });
    await expect(client.mcp.removeAuth("notion")).resolves.toBeUndefined();
    client.close();

    expect(status).toHaveBeenCalledWith({ directory: "/repo" });
    expect(add).toHaveBeenCalledWith({
      name: "linear",
      config: { type: "remote", url: "https://mcp.linear.app/sse" },
      directory: "/repo",
    });
    expect(connect).toHaveBeenCalledWith({ name: "linear", directory: "/repo" });
    expect(disconnect).toHaveBeenCalledWith({ name: "linear" });
    expect(authenticate).toHaveBeenCalledWith({ name: "notion", directory: "/repo" });
    expect(remove).toHaveBeenCalledWith({ name: "notion" });
  });

  it("surfaces MCP authentication failures as OpenCodeRequestError", async () => {
    // The sidecar answers 400 McpUnsupportedOAuthError for a server without OAuth.
    const authenticate = vi.fn(() =>
      Promise.resolve({
        data: undefined,
        error: { error: "MCP server does not support OAuth" },
        request: new Request("http://opencode.test"),
        response: new Response(undefined, { status: 400 }),
      }),
    );
    sdk.createOpencodeClient.mockReturnValue({
      mcp: { auth: { authenticate } },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    const failure = await client.mcp.authenticate("linear").catch((error: unknown) => error);
    client.close();

    expect(failure).toBeInstanceOf(OpenCodeRequestError);
    expect(failure).toMatchObject({ operation: "mcp.auth.authenticate", status: 400 });
  });

  it("reads the merged config through the stable config namespace", async () => {
    const get = vi.fn(() =>
      Promise.resolve(
        response({
          instructions: ["AGENTS.md"],
          plugin: ["honk-host"],
          mcp: {
            linear: { type: "remote" as const, url: "https://mcp.linear.app/sse" },
            legacy: { enabled: false },
          },
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({ config: { get } } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    const result = await client.config.get({ directory: "/repo" });
    client.close();

    expect(result.instructions).toEqual(["AGENTS.md"]);
    expect(result.mcp?.legacy).toEqual({ enabled: false });
    expect(get).toHaveBeenCalledWith({ directory: "/repo" });
  });

  it("lists and removes saved permissions through the V2 permission namespace", async () => {
    const list = vi.fn(() =>
      Promise.resolve(
        response({
          data: [{ id: "perm_1", projectID: "project-1", action: "bash", resource: "git status" }],
        }),
      ),
    );
    const remove = vi.fn(() => Promise.resolve(response(undefined, { status: 204 })));
    sdk.createOpencodeClient.mockReturnValue({
      v2: { permission: { saved: { list, remove } } },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));

    await expect(client.savedPermissions.list()).resolves.toEqual([
      { id: "perm_1", projectID: "project-1", action: "bash", resource: "git status" },
    ]);
    await expect(client.savedPermissions.remove("perm_1")).resolves.toBeUndefined();
    client.close();

    expect(list).toHaveBeenCalledWith();
    expect(remove).toHaveBeenCalledWith({ id: "perm_1" });
  });
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}
