import type { OpencodeClient, SessionV2Info } from "@opencode-ai/sdk/v2/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenCodeClient } from "./client";
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

  it("routes prompts through the host-configured runner with normalized IDs", async () => {
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
          },
          {
            uri: "data:image/png;base64,AAAA",
            name: "screenshot.png",
          },
        ],
      },
    });
    client.close();

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
        },
        {
          type: "file",
          mime: "image/png",
          filename: "screenshot.png",
          url: "data:image/png;base64,AAAA",
        },
      ],
    });
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

  it("reads session attention from the location-owned request queues", async () => {
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
      Promise.resolve(
        response({
          location: {
            directory: info.location.directory,
            project: { id: "project", directory: info.location.directory },
          },
          data: [{ id: "que_match", sessionID: info.id, questions: [] }],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      v2: {
        session: { list },
        permission: { request: { list: permissionList } },
        question: { request: { list: questionList } },
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
    expect(permissionList).toHaveBeenCalledWith({
      location: { directory: info.location.directory },
    });
    expect(questionList).toHaveBeenCalledWith({
      location: { directory: info.location.directory },
    });
    client.close();
  });

  it("normalizes global wire envelopes through the injected native event source", async () => {
    const requested: OpenCodeEventSourceInput[] = [];
    const eventSource = vi.fn(async (input: OpenCodeEventSourceInput) => {
      requested.push(input);
      return (async function* eventStream(): AsyncGenerator<unknown> {
        if (input.url.includes("/api/session/")) {
          yield { id: "evt_session", type: "session.next.prompted", data: {} };
          return;
        }
        yield {
          directory: "/Users/workgyver/Developer/honk",
          project: "project-1",
          payload: {
            id: "evt_status",
            type: "session.status",
            properties: { sessionID: "ses_1", status: { type: "busy" } },
          },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: { type: "sync", sessions: [] },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: { id: "evt_missing_type", properties: {} },
        };
        yield {
          directory: "/Users/workgyver/Developer/honk",
          payload: { id: "evt_bad_properties", type: "message.updated", properties: "invalid" },
        };
        yield {
          payload: {
            id: "evt_idle",
            type: "session.idle",
            properties: { sessionID: "ses_1" },
          },
        };
        yield { payload: { type: "server.connected" } };
        yield { payload: { id: "evt_heartbeat", type: "server.heartbeat" } };
      })();
    });
    sdk.createOpencodeClient.mockReturnValue({ v2: {} } as unknown as OpencodeClient);

    const server = createOpenCodeServer({ origin: "http://opencode.test" });
    const client = createOpenCodeClient(server, { password: "secret", eventSource });
    const globalEvents = await collect(client.events());
    const sessionEvents = await collect(
      client.sessions.events(openCodeSessionRef(server.key, "ses_1"), { after: "12" }),
    );
    client.close();

    expect(globalEvents).toEqual([
      {
        id: "evt_status",
        type: "session.status",
        data: { sessionID: "ses_1", status: { type: "busy" } },
      },
      { id: "evt_idle", type: "session.idle", data: { sessionID: "ses_1" } },
      { type: "server.connected", data: {} },
      { id: "evt_heartbeat", type: "server.heartbeat", data: {} },
    ]);
    expect(sessionEvents.map((event) => event.type)).toEqual(["session.next.prompted"]);
    expect(requested.map((input) => input.url)).toEqual([
      "http://opencode.test/global/event",
      "http://opencode.test/api/session/ses_1/event?after=12",
    ]);
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

  it("lists providers through the canonical generated namespace", async () => {
    const providerList = vi.fn(() =>
      Promise.resolve(
        response({
          all: [
            {
              id: "openai",
              name: "OpenAI",
            },
          ],
          default: {},
          connected: ["openai"],
        }),
      ),
    );
    sdk.createOpencodeClient.mockReturnValue({
      provider: { list: providerList },
    } as unknown as OpencodeClient);
    const client = createOpenCodeClient(createOpenCodeServer({ origin: "http://opencode.test" }));
    const listed = await client.providers.list();
    client.close();

    expect(listed.providers).toEqual([{ id: "openai", name: "OpenAI", connected: true }]);
    expect(providerList).toHaveBeenCalledOnce();
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
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}
