import { MessageId } from "@multi/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../../types";
import { HumanMessage } from "./human-message";

function renderHumanMessage(message: ChatMessage): string {
  return renderToStaticMarkup(
    createElement(HumanMessage, {
      message,
      editAvailable: false,
      isEditing: false,
      editDisabled: true,
      isServerThread: true,
      editComposer: null,
      onImageExpand: () => undefined,
      onBeginEditUserMessage: undefined,
    }),
  );
}

describe("HumanMessage rich text rendering", () => {
  it("renders TipTap docs from richText metadata", () => {
    const markup = renderHumanMessage({
      id: MessageId.make("message-tiptap-rich-text"),
      role: "user",
      text: "fallback",
      richText: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "rich", marks: [{ type: "bold" }] },
            ],
          },
        ],
      },
      createdAt: "2026-02-23T00:00:01.000Z",
      streaming: false,
    });

    expect(markup).toContain("data-rich-text-message");
    expect(markup).toContain("Hello ");
    expect(markup).toContain("<strong>rich</strong>");
  });

  it("renders Lexical roots from richText metadata", () => {
    const markup = renderHumanMessage({
      id: MessageId.make("message-lexical-rich-text"),
      role: "user",
      text: "fallback",
      richText: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [
                { type: "text", text: "Build " },
                { type: "text", text: "plan", format: 1 },
              ],
            },
          ],
        },
      },
      createdAt: "2026-02-23T00:00:01.000Z",
      streaming: false,
    });

    expect(markup).toContain("data-rich-text-message");
    expect(markup).toContain("Build ");
    expect(markup).toContain("<strong>plan</strong>");
  });

  it("renders Lexical composer atom nodes from richText metadata", () => {
    const markup = renderHumanMessage({
      id: MessageId.make("message-lexical-atom-rich-text"),
      role: "user",
      text: "fallback",
      richText: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [
                { type: "mentionNode", path: "packages/app/src/main.tsx", text: "@packages/app/src/main.tsx" },
                { type: "text", text: " " },
                { type: "commandNode", id: "cmd", name: "review", commandType: "prompt", text: "/review" },
                { type: "text", text: " " },
                { type: "skillNode", name: "ui", label: "UI", text: "$ui" },
              ],
            },
          ],
        },
      },
      createdAt: "2026-02-23T00:00:01.000Z",
      streaming: false,
    });

    expect(markup).toContain("@packages/app/src/main.tsx");
    expect(markup).toContain("/review");
    expect(markup).toContain("$ui");
  });

  it("does not render trailing empty Lexical paragraphs from composer state", () => {
    const markup = renderHumanMessage({
      id: MessageId.make("message-lexical-trailing-empty-rich-text"),
      role: "user",
      text: "Build plan",
      richText: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Build plan" }],
            },
            {
              type: "paragraph",
              children: [],
            },
          ],
        },
      },
      createdAt: "2026-02-23T00:00:01.000Z",
      streaming: false,
    });

    expect(markup).toContain("data-rich-text-message");
    expect(markup).toContain("Build plan");
    expect(markup).not.toContain("<br/>");
  });

  it("does not render boundary empty TipTap paragraphs from composer state", () => {
    const markup = renderHumanMessage({
      id: MessageId.make("message-tiptap-boundary-empty-rich-text"),
      role: "user",
      text: "Ship it",
      richText: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Ship it" }],
          },
          {
            type: "paragraph",
            content: [],
          },
        ],
      },
      createdAt: "2026-02-23T00:00:01.000Z",
      streaming: false,
    });

    expect(markup).toContain("data-rich-text-message");
    expect(markup).toContain("Ship it");
    expect(markup).not.toContain("<br/>");
  });

  it("falls back to plain text for unknown richText shapes", () => {
    const markup = renderHumanMessage({
      id: MessageId.make("message-unknown-rich-text"),
      role: "user",
      text: "plain fallback",
      richText: { unsupported: true },
      createdAt: "2026-02-23T00:00:01.000Z",
      streaming: false,
    });

    expect(markup).not.toContain("data-rich-text-message");
    expect(markup).toContain("plain fallback");
  });
});
