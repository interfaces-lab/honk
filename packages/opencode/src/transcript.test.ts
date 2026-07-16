import type {
  AssistantMessage,
  Part,
  SessionMessage,
  SessionV2Info,
  ToolPart,
} from "@opencode-ai/sdk/v2/client";
import { describe, expect, it } from "vitest";

import { projectOpenCodeTranscript, type OpenCodePersistedMessage } from "./transcript";

const session: SessionV2Info = {
  id: "ses_transcript",
  projectID: "project",
  cost: 0,
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  },
  time: { created: 100, updated: 200 },
  title: "Transcript",
  location: { directory: "/workspace" },
  agent: "build",
  model: { id: "gpt-5", providerID: "openai" },
};

function assistantMessage(completed?: number): AssistantMessage {
  return {
    id: "msg_assistant",
    sessionID: session.id,
    role: "assistant",
    time: { created: 100, ...(completed === undefined ? {} : { completed }) },
    parentID: "msg_user",
    modelID: "gpt-5",
    providerID: "openai",
    mode: "build",
    agent: "build",
    path: { cwd: "/workspace", root: "/workspace" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  };
}

function projectedAssistant(
  content: Extract<SessionMessage, { type: "assistant" }>["content"],
  completed?: number,
): Extract<SessionMessage, { type: "assistant" }> {
  return {
    id: "msg_assistant",
    type: "assistant",
    time: { created: 100, ...(completed === undefined ? {} : { completed }) },
    agent: "build",
    model: { id: "gpt-5", providerID: "openai" },
    content,
  };
}

function persisted(parts: readonly Part[], completed?: number): OpenCodePersistedMessage[] {
  return [{ info: assistantMessage(completed), parts }];
}

function toolPart(parts: readonly Part[]): ToolPart {
  const result = parts.find((part): part is ToolPart => part.type === "tool");
  if (result === undefined) throw new Error("Expected a tool part");
  return result;
}

describe("projectOpenCodeTranscript reconciliation", () => {
  it("promotes a persisted running tool to its richer projected completion", () => {
    const running: ToolPart = {
      id: "part_tool",
      sessionID: session.id,
      messageID: "msg_assistant",
      type: "tool",
      callID: "call_read",
      tool: "read",
      metadata: { transport: { persisted: true } },
      state: {
        status: "running",
        input: { path: "src/index.ts", persistedInput: true },
        title: "Reading",
        metadata: {
          persistedOnly: true,
        },
        time: { start: 110 },
      },
    };
    const transcript = projectOpenCodeTranscript(session, persisted([running]), [
      projectedAssistant(
        [
          {
            id: "part_tool",
            type: "tool",
            name: "read",
            state: {
              status: "completed",
              input: { path: "src/index.ts", projectedInput: true },
              structured: {
                projectedOnly: true,
              },
              content: [{ type: "text", text: "complete file output" }],
              attachments: [
                {
                  uri: "file:///workspace/src/index.ts",
                  mime: "text/typescript",
                  name: "index.ts",
                },
              ],
            },
            time: { created: 105, ran: 115, completed: 150 },
          },
        ],
        150,
      ),
    ]);

    const tool = toolPart(transcript.parts);
    expect(tool.state).toMatchObject({
      status: "completed",
      input: {
        path: "src/index.ts",
        persistedInput: true,
        projectedInput: true,
      },
      output: "complete file output",
      metadata: {
        persistedOnly: true,
        projectedOnly: true,
      },
      time: { start: 110, end: 150 },
      attachments: [
        expect.objectContaining({
          filename: "index.ts",
          url: "file:///workspace/src/index.ts",
        }),
      ],
    });
    expect(tool.metadata).toEqual({ transport: { persisted: true } });
    expect(transcript.messages).toEqual([
      expect.objectContaining({
        id: "msg_assistant",
        time: { created: 100, completed: 150 },
      }),
    ]);
    expect(transcript.parts.map((part) => part.id)).toEqual(["part_tool"]);
  });

  it("chooses the later terminal tool result when completion and error disagree", () => {
    const completed: ToolPart = {
      id: "part_tool",
      sessionID: session.id,
      messageID: "msg_assistant",
      type: "tool",
      callID: "call_shell",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "pwd" },
        output: "/workspace",
        title: "Ran command",
        metadata: {},
        time: { start: 110, end: 220 },
      },
    };
    const transcript = projectOpenCodeTranscript(session, persisted([completed], 220), [
      projectedAssistant(
        [
          {
            id: "part_tool",
            type: "tool",
            name: "bash",
            state: {
              status: "error",
              input: { command: "pwd" },
              structured: {},
              content: [],
              error: { type: "unknown", message: "stale error" },
            },
            time: { created: 105, ran: 110, completed: 200 },
          },
        ],
        200,
      ),
    ]);

    expect(toolPart(transcript.parts).state).toMatchObject({
      status: "completed",
      output: "/workspace",
      time: { end: 220 },
    });
  });

  it("keeps ended richer text and reasoning without changing their established order", () => {
    const transcript = projectOpenCodeTranscript(
      session,
      persisted([
        {
          id: "part_reasoning",
          sessionID: session.id,
          messageID: "msg_assistant",
          type: "reasoning",
          text: "Partial thought",
          metadata: { persistedProvider: { value: true } },
          time: { start: 110 },
        },
        {
          id: "part_text",
          sessionID: session.id,
          messageID: "msg_assistant",
          type: "text",
          text: "Short",
          metadata: { persisted: true },
          time: { start: 120 },
        },
      ]),
      [
        projectedAssistant(
          [
            {
              id: "part_reasoning",
              type: "reasoning",
              text: "A much fuller thought",
              providerMetadata: { projectedProvider: { value: true } },
              time: { created: 115, completed: 170 },
            },
            { id: "part_text", type: "text", text: "A complete response" },
          ],
          180,
        ),
      ],
    );

    expect(transcript.parts.map((part) => part.id)).toEqual(["part_reasoning", "part_text"]);
    expect(transcript.parts.find((part) => part.id === "part_reasoning")).toMatchObject({
      type: "reasoning",
      text: "A much fuller thought",
      metadata: {
        persistedProvider: { value: true },
        projectedProvider: { value: true },
      },
      time: { start: 110, end: 170 },
    });
    expect(transcript.parts.find((part) => part.id === "part_text")).toMatchObject({
      type: "text",
      text: "A complete response",
      metadata: { persisted: true },
      time: { start: 100, end: 180 },
    });
  });
});
