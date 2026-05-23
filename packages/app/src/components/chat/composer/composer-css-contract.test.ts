import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const composerDir = resolve(__dirname);
const stylesDir = resolve(composerDir, "../../../styles");
const conversationCss = readFileSync(resolve(stylesDir, "conversation.css"), "utf8");
const inputSource = readFileSync(resolve(composerDir, "input.tsx"), "utf8");
const contextUsageBarSource = readFileSync(
  resolve(composerDir, "composer-context-usage-bar.tsx"),
  "utf8",
);
const promptEditorSource = readFileSync(resolve(composerDir, "prompt-editor.tsx"), "utf8");
const queuedItemsPanelSource = readFileSync(resolve(composerDir, "queued-items-panel.tsx"), "utf8");
const slashMenuSource = readFileSync(resolve(composerDir, "slash-menu.tsx"), "utf8");

describe("Composer CSS contract", () => {
  it("stores composer geometry in conversation.css vars", () => {
    expect(conversationCss).toContain("--multi-composer-new-agent-editor-min-height: 56px");
    expect(conversationCss).toContain(
      "--multi-composer-new-agent-editor-max-height: min(75vh, 420px)",
    );
    expect(conversationCss).toContain("--multi-composer-editor-min-height: 36px");
    expect(conversationCss).toContain("--multi-composer-editor-max-height: 200px");
  });

  it("wires geometry through input.tsx cva instead of composer-height buckets", () => {
    expect(existsSync(resolve(stylesDir, "composer.css"))).toBe(false);
    expect(existsSync(resolve(composerDir, "composer-height.ts"))).toBe(false);
    expect(inputSource).toContain("composerEditorClass");
    expect(inputSource).toContain("var(--multi-composer-new-agent-editor-min-height)");
    expect(inputSource).toContain("data-layout={layout}");
    expect(inputSource).not.toMatch(/composer-height|HERO_COMPOSER_|!min-h-|!max-h-/);
  });

  it("uses a single thread shell driven by data-expanded (no rounded-full pill swap)", () => {
    expect(conversationCss).toContain('[data-multi-composer-shell="thread"]');
    expect(conversationCss).toContain('[data-multi-composer-shell="thread"][data-expanded=""]');
    expect(conversationCss).toMatch(
      /\[data-multi-composer-shell="thread"\]:not\(\[data-expanded=""\]\)\s+\[data-multi-composer-toolbar="bottom"\]\s*\{\s*display:\s*contents/,
    );
    expect(conversationCss).toContain("--multi-composer-radius-compact");
    expect(conversationCss).toContain("--multi-composer-radius-expanded");
    expect(conversationCss).toMatch(
      /\[data-multi-composer-surface\]\[data-variant="compact"\]:not\(\[data-expanded=""\]\)/,
    );
    expect(inputSource).toContain('"data-multi-composer-shell": "thread"');
    expect(inputSource).toContain('data-multi-composer-toolbar={isThreadShell ? "bottom"');
    expect(inputSource).not.toMatch(/isDockComposerSingleLine\s*\?\s*"rounded-full"/);
    expect(inputSource).not.toMatch(/composerVariant === "compact"\s*\?\s*"rounded-2xl"/);
  });

  it("removes the editor min-h-5/max-h-5 forced-height jump in compact pill mode", () => {
    expect(inputSource).toContain('"thread-pill": "min-h-0 max-h-none');
    expect(inputSource).not.toMatch(/"thread-pill":\s*"min-h-5\s+max-h-5/);
  });
});

describe("Composer queue contract", () => {
  it("queue presence alone does not force the composer into expanded mode", () => {
    const expansionMatch = inputSource.match(
      /const isDockComposerExpanded =[\s\S]*?isComposerEditorMultiline\);/,
    );
    expect(expansionMatch, "missing expanded-state derivation").not.toBeNull();
    const block = expansionMatch?.[0] ?? "";
    expect(block).toContain("isEditingQueuedComposerItem");
    expect(block).not.toContain("hasQueuedComposerItems");
  });

  it("renders the queue as a persistent Cursor-style panel instead of a footer badge", () => {
    expect(queuedItemsPanelSource).toContain("export const QueuedComposerItemsPanel");
    expect(queuedItemsPanelSource).toContain("export const QueuedComposerEditBanner");
    expect(queuedItemsPanelSource).not.toContain("export const QueuedComposerItemsBadge");
    expect(queuedItemsPanelSource).not.toContain("export const QueuedComposerItemsTray");
    expect(inputSource).toContain("QueuedComposerItemsPanel");
    expect(inputSource).toContain("QueuedComposerEditBanner");
    expect(inputSource).toContain("showQueuedComposerPanel");
    expect(inputSource).not.toContain("showQueuedComposerTray");
    expect(inputSource).not.toContain("showQueuedComposerBadge");
  });

  it("uses queue action strings", () => {
    expect(queuedItemsPanelSource).toContain('"Edit"');
    expect(queuedItemsPanelSource).toContain('"Send now"');
    expect(queuedItemsPanelSource).toContain('"Remove"');
    expect(queuedItemsPanelSource).toContain("Editing queued message");
    expect(queuedItemsPanelSource).toContain('"Queued"');
    expect(queuedItemsPanelSource).toContain('data-queue-action="edit"');
    expect(queuedItemsPanelSource).toContain('data-queue-row="true"');
    expect(queuedItemsPanelSource).toContain('"Expand queue"');
    expect(queuedItemsPanelSource).toContain('"Collapse queue"');
    expect(conversationCss).toContain("--multi-composer-queue-panel-list-max-height: 200px");
    expect(conversationCss).toContain("[data-queued-composer-panel]");
  });
});

describe("Composer send/stop contract", () => {
  it("tags send and stop buttons with data-multi-composer-action and data-multi-composer-state", () => {
    expect(inputSource).toContain('data-multi-composer-action="submit"');
    expect(inputSource).toContain('data-multi-composer-action="stop"');
    expect(inputSource).toContain("data-multi-composer-state={dataState}");
    expect(inputSource).toMatch(/dataState[^\n]*=[^;]*"running"/);
    expect(inputSource).toMatch(/dataState[^\n]*=[^;]*"busy"/);
  });

  it("centralizes send/stop sizing classes so the running and idle paths cannot drift", () => {
    expect(inputSource).toContain("COMPOSER_ACTION_SIZE_COMPACT");
    expect(inputSource).toContain("COMPOSER_ACTION_SIZE_EXPANDED");
    expect(inputSource).toContain("COMPOSER_TOOLBAR_CONTROL_SIZE");
    expect(conversationCss).toContain("--multi-composer-compact-send-size: 24px");
    expect(conversationCss).toContain("--multi-composer-expanded-send-size: 24px");
    expect(conversationCss).toContain("--multi-composer-toolbar-control-size: 24px");
    expect(inputSource).toContain("--multi-composer-compact-send-size");
    expect(inputSource).toContain("--multi-composer-expanded-send-size");
    expect(inputSource).toContain("--multi-composer-toolbar-control-size");
    expect(inputSource).toContain("COMPOSER_SUBMIT_BASE_CLASS");
    expect(inputSource).toContain("COMPOSER_STOP_BASE_CLASS");
    const primaryActionsSource = inputSource.slice(
      inputSource.indexOf("const PrimaryActionControls"),
      inputSource.indexOf("const ComposerFooter"),
    );
    expect(primaryActionsSource).not.toMatch(/"h-7 w-7"|"h-9 w-9 sm:h-8 sm:w-8"/);
  });
});

describe("Composer slash menu contract", () => {
  it("keeps slash commands separate from the @ files and folders menu", () => {
    expect(slashMenuSource).toContain("collectProviderSkillItems");
    expect(slashMenuSource).toContain("providerStatuses: ReadonlyArray<ServerProvider>");
    expect(slashMenuSource).toContain('triggerKind === "path"');
    expect(slashMenuSource).toContain(
      'const shouldSearchProjectEntries = composerTriggerKind === "path"',
    );
    expect(slashMenuSource).not.toContain("projectListDirectoryQueryOptions");
    expect(slashMenuSource).not.toContain("toPathCommandItems(projectEntries)]");
  });

  it("anchors the slash/mention menu at the caret via a 1x1 span inside the prompt editor", () => {
    expect(promptEditorSource).toContain('data-composer-menu-anchor=""');
    expect(promptEditorSource).toContain("usePromptEditorCaretAnchor");
    expect(promptEditorSource).toContain("editor.view.coordsAtPos");
    expect(inputSource).not.toContain('data-composer-menu-anchor=""');
    expect(inputSource).toContain("caretAnchorRef={composerMenuAnchorRef}");
    expect(inputSource).toContain("const composerCaretTriggerOffset = composerTrigger?.rangeEnd");
    expect(inputSource).toContain("caretTriggerExpandedOffset={composerCaretTriggerOffset}");
    expect(inputSource).toContain("composerMenuAnchorRef.current");
    expect(inputSource).toContain("new MutationObserver(scheduleComposerMenuAnchorUpdate)");
    expect(inputSource).toContain("anchorVersion={composerMenuAnchorVersion}");
    expect(promptEditorSource).toContain("const anchorY = coords.bottom");
    expect(slashMenuSource).toContain("key={anchorVersion}");
  });
});

describe("Composer surface contract", () => {
  it("tags the composer card for surface targeting", () => {
    expect(inputSource).toContain("data-multi-composer-surface");
  });

  it("applies composer blur via conversation.css in translucent mode", () => {
    expect(conversationCss).toContain("--multi-composer-blur: 10px");
    expect(conversationCss).toContain(
      'body[data-multi-glass-mode="true"] [data-multi-composer-surface]',
    );
    expect(conversationCss).toMatch(/blur\(var\(--multi-composer-blur/);
  });

  it("removes composer blur under reduce transparency", () => {
    expect(conversationCss).toContain(
      'body.multi-reduce-transparency[data-multi-glass-mode="true"] [data-multi-composer-surface]',
    );
    expect(conversationCss).toMatch(
      /body\.multi-reduce-transparency\[data-multi-glass-mode="true"\] \[data-multi-composer-surface\][\s\S]*backdrop-filter:\s*none/,
    );
  });

  it("does not hardcode composer shell blur in input.tsx", () => {
    expect(inputSource).not.toMatch(/backdrop-blur/);
  });

  it("renders context usage below the composer and hides it when not scrolled to bottom", () => {
    expect(conversationCss).toContain("--multi-composer-context-usage-bar-max-height: 24px");
    expect(conversationCss).toContain(
      ":not([data-scrolled-to-bottom]) [data-composer-context-usage-bar]",
    );
    expect(contextUsageBarSource).toContain("data-composer-context-usage-bar");
    expect(inputSource).toContain("ComposerContextUsageBar");
    expect(inputSource).not.toContain("ContextWindowMeter");
  });

  it("moves slash menu blur to conversation.css", () => {
    expect(slashMenuSource).not.toMatch(/backdrop-blur/);
    expect(conversationCss).toContain(
      'body[data-multi-glass-mode="true"] [data-composer-command-menu-root] [data-variant="surface"]',
    );
  });

  it("renders plan tray preview with inline markdown and CSS-driven tray radius", () => {
    expect(conversationCss).toContain(
      "--multi-composer-plan-tray-radius: var(--multi-composer-radius-expanded)",
    );
    expect(conversationCss).toContain(".plan-tray__markdown");
    expect(inputSource).toContain("ChatMarkdown");
    expect(inputSource).toContain("plan-tray__markdown");
    expect(inputSource).not.toContain("buildPlanTrayPreview");
    expect(inputSource).not.toContain("REVIEW PLAN");
  });
});
