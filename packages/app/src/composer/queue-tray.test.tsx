import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: () => ({}),
  defineVars: <T,>(values: T) => values,
  keyframes: () => "",
  props: () => ({}),
}));

import { ComposerQueueTray } from "./queue-tray";

describe("composer queue tray", () => {
  it("renders queued messages as a roving listbox", () => {
    const html = renderToStaticMarkup(
      <ComposerQueueTray
        items={[
          { id: "first", text: "First follow-up", files: [] },
          { id: "second", text: "Second follow-up", files: [] },
        ]}
        editingId={null}
        showSendHint
        onEdit={vi.fn()}
        onSendNow={vi.fn()}
        onRemove={vi.fn()}
        onReorder={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    expect(html).toContain('role="listbox" aria-label="Queued messages" tabindex="-1"');
    expect(html).not.toContain("aria-activedescendant");
    expect(html).toContain(
      'role="option" aria-label="First follow-up" aria-selected="false" tabindex="-1"',
    );
    expect(html).toContain(
      'role="option" aria-label="Second follow-up" aria-selected="false" tabindex="-1"',
    );
  });

  it("renders the exact Start All action and loading copy", () => {
    const props = {
      items: [{ id: "first", text: "First follow-up", files: [] }],
      editingId: null,
      showSendHint: false,
      onEdit: vi.fn(),
      onSendNow: vi.fn(),
      onRemove: vi.fn(),
      onReorder: vi.fn(),
      onExit: vi.fn(),
    } as const;

    const ready = renderToStaticMarkup(<ComposerQueueTray {...props} onStartAll={vi.fn()} />);
    const loading = renderToStaticMarkup(
      <ComposerQueueTray {...props} isStartingAll onStartAll={vi.fn()} />,
    );

    expect(ready).toContain(">Start All</button>");
    expect(loading).toContain(">Starting</button>");
    expect(loading).not.toContain(">Start All</button>");
  });

  it("shows the blocked hint only when queued work and thread attention coincide", () => {
    const props = {
      editingId: null,
      showSendHint: true,
      onEdit: vi.fn(),
      onSendNow: vi.fn(),
      onRemove: vi.fn(),
      onReorder: vi.fn(),
      onExit: vi.fn(),
    } as const;
    const blocked = renderToStaticMarkup(
      <ComposerQueueTray
        {...props}
        items={[{ id: "first", text: "First follow-up", files: [] }]}
        needsAttention
      />,
    );
    const ordinary = renderToStaticMarkup(
      <ComposerQueueTray
        {...props}
        items={[{ id: "first", text: "First follow-up", files: [] }]}
      />,
    );
    const empty = renderToStaticMarkup(<ComposerQueueTray {...props} items={[]} needsAttention />);

    expect(blocked).toContain("Waiting for your response");
    expect(blocked).not.toContain("↩ to Send");
    expect(ordinary).not.toContain("Waiting for your response");
    expect(empty).not.toContain("Waiting for your response");
  });
});
