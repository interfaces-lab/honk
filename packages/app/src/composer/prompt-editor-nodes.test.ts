import {
  $createNodeSelection,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  createEditor,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  $createCommandNode,
  $createContextNode,
  $createMentionNode,
  registerChipDeletion,
  ComposerCommandNode,
  ComposerContextNode,
  ComposerMentionNode,
  MentionChipIcon,
  removeChip,
  serializePrompt,
} from "./prompt-editor-nodes";

function createComposerEditor(update: () => void): LexicalEditor {
  const editor = createEditor({
    namespace: "composer-node-test",
    nodes: [ComposerMentionNode, ComposerCommandNode, ComposerContextNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(update, { discrete: true });
  return editor;
}

describe("composer Lexical nodes", () => {
  it("uses Pierre file identity for inline file chips", () => {
    const html = renderToStaticMarkup(
      createElement(MentionChipIcon, { kind: "file", path: "config/settings.json" }),
    );

    expect(html).toContain('data-icon-token="json"');
    expect(html).toContain('href="#file-tree-builtin-json"');
  });

  it("serializes mixed inline tokens without turning semantic sources into attachments", () => {
    const editor = createComposerEditor(() => {
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode("Review "),
          $createMentionNode({
            kind: "file",
            path: "packages/app/src/index.ts",
            label: "index.ts",
            mime: "text/typescript",
          }),
          $createTextNode(" in "),
          $createMentionNode({ kind: "folder", path: "packages/app/src", label: "src" }),
          $createTextNode(" with "),
          $createMentionNode({ kind: "browser", path: "browser", label: "Browser" }),
        ),
        $createParagraphNode().append(
          $createCommandNode({
            name: "componentize",
            description: "Extract a component",
            path: "/skills/componentize/SKILL.md",
          }),
        ),
      );
    });

    expect(serializePrompt(editor)).toEqual({
      text: "Review @packages/app/src/index.ts in @packages/app/src with @browser\n[componentize][/skills/componentize/SKILL.md]",
      mentions: [
        {
          kind: "file",
          path: "packages/app/src/index.ts",
          label: "index.ts",
          mime: "text/typescript",
          source: {
            text: "@packages/app/src/index.ts",
            start: 7,
            end: 33,
          },
        },
      ],
      contexts: [],
    });
  });

  it("records exact source ranges when literal mention text and duplicate paths surround nodes", () => {
    const editor = createComposerEditor(() => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode("literal @README.md")),
        $createParagraphNode().append(
          $createMentionNode({ path: "README.md", label: "README.md" }),
          $createTextNode(" then "),
          $createMentionNode({ path: "README.md", label: "README.md" }),
        ),
      );
    });

    expect(serializePrompt(editor)).toEqual({
      text: "literal @README.md\n@README.md then @README.md",
      mentions: [
        {
          path: "README.md",
          label: "README.md",
          source: { text: "@README.md", start: 19, end: 29 },
        },
        {
          path: "README.md",
          label: "README.md",
          source: { text: "@README.md", start: 35, end: 45 },
        },
      ],
      contexts: [],
    });
  });

  it("keeps chat and branch chips inline while collecting their resolved file parts", () => {
    const editor = createComposerEditor(() => {
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode("Compare "),
          $createContextNode({
            kind: "chat",
            sourceKey: "chat:local:session-1",
            label: "Earlier approach",
            path: "data:text/plain,chat",
            mime: "text/plain",
          }),
          $createTextNode(" against "),
          $createContextNode({
            kind: "branch",
            sourceKey: "branch:/repo",
            label: "Current branch diff",
            path: "data:text/plain,diff",
            mime: "text/plain",
          }),
        ),
      );
    });

    expect(serializePrompt(editor)).toEqual({
      text: "Compare @Earlier approach against @Current branch diff",
      mentions: [],
      contexts: [
        {
          kind: "chat",
          sourceKey: "chat:local:session-1",
          label: "Earlier approach",
          path: "data:text/plain,chat",
          mime: "text/plain",
        },
        {
          kind: "branch",
          sourceKey: "branch:/repo",
          label: "Current branch diff",
          path: "data:text/plain,diff",
          mime: "text/plain",
        },
      ],
    });
  });

  it("round-trips every token through Lexical JSON", () => {
    const editor = createComposerEditor(() => {
      $getRoot().append(
        $createParagraphNode().append(
          $createMentionNode({ path: "README.md", label: "README.md" }),
          $createTextNode(" "),
          $createCommandNode({ name: "review", description: null, path: null }),
          $createTextNode(" "),
          $createContextNode({
            kind: "chat",
            sourceKey: "chat:local:session-2",
            label: "Prior review",
            path: null,
            mime: "text/plain",
          }),
        ),
      );
    });
    const restored = createEditor({
      namespace: "composer-node-round-trip",
      nodes: [ComposerMentionNode, ComposerCommandNode, ComposerContextNode],
      onError: (error) => {
        throw error;
      },
    });
    restored.setEditorState(restored.parseEditorState(JSON.stringify(editor.getEditorState())));

    expect(serializePrompt(restored)).toEqual(serializePrompt(editor));
  });
});

describe("chip deletion", () => {
  // Chips are always inserted as [chip][" rest"], so every case below starts from that shape.
  const keyEvent = (
    isComposing = false,
  ): { readonly event: KeyboardEvent; readonly prevented: () => boolean } => {
    let isPrevented = false;
    return {
      event: {
        isComposing,
        preventDefault: () => {
          isPrevented = true;
        },
      } as unknown as KeyboardEvent,
      prevented: () => isPrevented,
    };
  };

  // PlainText owns the editor-priority fallback in production. Registering the same operation here
  // makes range tests exercise our high-priority command listener and Lexical's default deletion.
  const deleteRangeAt = (
    build: () => void,
    caret: (editor: LexicalEditor) => void,
    isBackward = true,
  ): { readonly handled: boolean; readonly text: string } => {
    const editor = createComposerEditor(build);
    registerChipDeletion(editor);
    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || selection.isCollapsed()) return false;
        selection.removeText();
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
    caret(editor);
    const handled = editor.dispatchCommand(DELETE_CHARACTER_COMMAND, isBackward);
    editor.update(() => undefined, { discrete: true });
    return { handled, text: serializePrompt(editor).text };
  };

  const mentionParagraph = (trailing: string): void => {
    $getRoot().append(
      $createParagraphNode().append(
        $createTextNode("Review "),
        $createMentionNode({ path: "README.md", label: "README.md" }),
        $createTextNode(trailing),
      ),
    );
  };

  const selectTrailingStart = (editor: LexicalEditor): void => {
    editor.update(
      () => {
        const trailing = $getRoot().getLastDescendant();
        if ($isTextNode(trailing)) trailing.select(0, 0);
      },
      { discrete: true },
    );
  };

  it("takes the inserted separator with the chip so the prompt keeps one space", () => {
    expect(deleteRangeAt(() => mentionParagraph(" later today"), selectTrailingStart)).toEqual({
      handled: true,
      text: "Review later today",
    });
  });

  it("removes a separator-only trailing node with the chip", () => {
    expect(deleteRangeAt(() => mentionParagraph(" "), selectTrailingStart)).toEqual({
      handled: true,
      text: "Review ",
    });
  });

  it("deletes the chip ahead of the caret with its separator", () => {
    expect(
      deleteRangeAt(
        () => mentionParagraph(" later today"),
        (editor) => {
          editor.update(
            () => {
              const leading = $getRoot().getFirstDescendant();
              if ($isTextNode(leading)) leading.select(7, 7);
            },
            { discrete: true },
          );
        },
        false,
      ),
    ).toEqual({ handled: true, text: "Review later today" });
  });

  it("deletes a chip held by a node selection", () => {
    const editor = createComposerEditor(() => mentionParagraph(" later today"));
    registerChipDeletion(editor);
    editor.update(
      () => {
        const chip = $getRoot().getLastDescendant()?.getPreviousSibling();
        if (chip === null || chip === undefined) return;
        const selection = $createNodeSelection();
        selection.add(chip.getKey());
        $setSelection(selection);
      },
      { discrete: true },
    );
    const event = keyEvent();

    const handled = editor.dispatchCommand(KEY_BACKSPACE_COMMAND, event.event);
    editor.update(() => undefined, { discrete: true });

    expect({
      handled,
      prevented: event.prevented(),
      text: serializePrompt(editor).text,
    }).toEqual({
      handled: true,
      prevented: true,
      text: "Review later today",
    });
  });

  it("leaves RangeSelection key handling to Lexical's platform-aware command layer", () => {
    const editor = createComposerEditor(() => mentionParagraph(" later today"));
    registerChipDeletion(editor);
    selectTrailingStart(editor);
    const event = keyEvent();

    expect({
      handled: editor.dispatchCommand(KEY_BACKSPACE_COMMAND, event.event),
      prevented: event.prevented(),
      text: serializePrompt(editor).text,
    }).toEqual({
      handled: false,
      prevented: false,
      text: "Review @README.md later today",
    });
  });

  it("removes owned separators from chips inside a non-collapsed range", () => {
    expect(
      deleteRangeAt(
        () => {
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode("A"),
              $createMentionNode({ path: "README.md", label: "README.md" }),
              $createTextNode(" B"),
            ),
          );
        },
        (editor) => {
          editor.update(
            () => {
              const paragraph = $getRoot().getFirstChildOrThrow();
              const selection = $createRangeSelection();
              selection.anchor.set(paragraph.getKey(), 1, "element");
              selection.focus.set(paragraph.getKey(), 2, "element");
              $setSelection(selection);
            },
            { discrete: true },
          );
        },
      ),
    ).toEqual({ handled: true, text: "AB" });
  });

  it("keeps a later caret valid when click-style removal shortens the separator", () => {
    const editor = createComposerEditor(() => mentionParagraph(" later"));
    editor.update(
      () => {
        const trailing = $getRoot().getLastDescendant();
        if (!$isTextNode(trailing)) return;
        trailing.selectEnd();
      },
      { discrete: true },
    );
    const chipKey = editor
      .getEditorState()
      .read(() => $getRoot().getLastDescendant()?.getPreviousSibling()?.getKey());
    if (chipKey === undefined) throw new Error("Expected a chip before the trailing text");
    removeChip(editor, chipKey);
    editor.update(() => undefined, { discrete: true });

    expect({
      text: serializePrompt(editor).text,
      selection: editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return null;
        return {
          offset: selection.anchor.offset,
          text: selection.anchor.getNode().getTextContent(),
        };
      }),
    }).toEqual({
      text: "Review later",
      selection: { offset: 12, text: "Review later" },
    });
  });

  it("does not move the caret past a later chip when removing a separator-only node", () => {
    const editor = createComposerEditor(() => {
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode("A"),
          $createMentionNode({ path: "first.ts", label: "first.ts" }),
          $createTextNode(" "),
          $createMentionNode({ path: "second.ts", label: "second.ts" }),
          $createTextNode(" later"),
        ),
      );
    });
    editor.update(
      () => {
        const leading = $getRoot().getFirstDescendant();
        if ($isTextNode(leading)) leading.selectEnd();
      },
      { discrete: true },
    );
    const chipKey = editor
      .getEditorState()
      .read(() => $getRoot().getFirstDescendant()?.getNextSibling()?.getKey());
    if (chipKey === undefined) throw new Error("Expected a chip after the leading text");
    removeChip(editor, chipKey);
    editor.update(() => undefined, { discrete: true });

    expect({
      text: serializePrompt(editor).text,
      selection: editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return null;
        return {
          offset: selection.anchor.offset,
          text: selection.anchor.getNode().getTextContent(),
        };
      }),
    }).toEqual({
      text: "A@second.ts later",
      selection: { offset: 1, text: "A" },
    });
  });

  it("leaves ordinary text deletion to Lexical", () => {
    expect(
      deleteRangeAt(
        () => mentionParagraph(" later today"),
        (editor) => {
          editor.update(
            () => {
              const trailing = $getRoot().getLastDescendant();
              if ($isTextNode(trailing)) trailing.select(6, 6);
            },
            { discrete: true },
          );
        },
      ),
    ).toEqual({ handled: false, text: "Review @README.md later today" });
  });

  it("keeps a user-typed space that is not the chip separator", () => {
    expect(deleteRangeAt(() => mentionParagraph("later today"), selectTrailingStart)).toEqual({
      handled: true,
      text: "Review later today",
    });
  });

  it("leaves a composing node-selection keystroke to the IME", () => {
    const editor = createComposerEditor(() => mentionParagraph(" later today"));
    registerChipDeletion(editor);
    editor.update(
      () => {
        const chip = $getRoot().getLastDescendant()?.getPreviousSibling();
        if (chip === null || chip === undefined) return;
        const selection = $createNodeSelection();
        selection.add(chip.getKey());
        $setSelection(selection);
      },
      { discrete: true },
    );

    expect(editor.dispatchCommand(KEY_BACKSPACE_COMMAND, keyEvent(true).event)).toBe(false);
    expect(serializePrompt(editor).text).toBe("Review @README.md later today");
  });
});
