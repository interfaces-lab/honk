import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const interactionWiring = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("./prompt-menu-interaction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prompt-menu-interaction")>();
  return {
    ...actual,
    promptMenuItemInteractionProps: (
      ...args: Parameters<typeof actual.promptMenuItemInteractionProps>
    ) => {
      interactionWiring.record(...args);
      return {
        ...actual.promptMenuItemInteractionProps(...args),
        "data-prompt-menu-interaction": "wired",
      };
    },
  };
});

vi.mock("@honk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@honk/ui")>();
  return {
    ...actual,
    Popover: {
      ...actual.Popover,
      Root: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
      Popup: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
    },
  };
});

import {
  PromptMenu,
  PromptMenuItemIcon,
  type PromptMenuItem,
  PromptMenuPathPreview,
} from "./prompt-menu";
import { promptMenuItemInteractionProps } from "./prompt-menu-interaction";

const file: PromptMenuItem = {
  key: "file:config/settings.json",
  title: "settings.json",
  detail: "config/settings.json",
  kind: "file",
  path: "config/settings.json",
};

describe("composer prompt menu", () => {
  it("renders Pierre file identity in a file suggestion row", () => {
    const html = renderToStaticMarkup(<PromptMenuItemIcon item={file} />);

    expect(html).toContain('data-icon-token="json"');
    expect(html).toContain("file-type-icon__styles.iconOrange");
  });

  it("gives every switchable mode row its own glyph", () => {
    const markup = (["plan", "debug", "ask"] as const).map((mode) =>
      renderToStaticMarkup(
        <PromptMenuItemIcon
          item={{ key: `mode:${mode}`, title: mode, detail: null, kind: "mode", mode }}
        />,
      ),
    );

    expect(new Set(markup).size).toBe(3);
  });

  it("renders the same Pierre file identity in the path preview", () => {
    const html = renderToStaticMarkup(<PromptMenuPathPreview item={file} />);

    expect(html).toContain("config");
    expect(html).toContain("settings.json");
    expect(html).toContain('data-icon-token="json"');
    expect(html).toContain("file-type-icon__styles.iconOrange");
  });

  it("wires the press-preserving interaction contract into each rendered option", () => {
    interactionWiring.record.mockClear();
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(
      <PromptMenu
        anchor={{ getBoundingClientRect: () => ({}) as DOMRect }}
        items={[file]}
        selectedIndex={0}
        placement="above"
        emptyLabel="No suggestions"
        isLoading={false}
        listboxId="composer-suggestions"
        onSelect={onSelect}
        onHighlight={vi.fn()}
        isKeyboardNavigation={false}
      />,
    );

    expect(html).toContain('data-prompt-menu-interaction="wired"');
    expect(interactionWiring.record).toHaveBeenCalledWith(
      file,
      onSelect,
      true,
      expect.objectContaining({ current: null }),
    );
  });

  it("preserves the Lexical range through press and selects once on click", () => {
    const preventDefault = vi.fn();
    const onSelect = vi.fn();
    const pointerDownItemKey = { current: null };
    const interaction = promptMenuItemInteractionProps(file, onSelect, true, pointerDownItemKey);

    interaction.onPointerDownCapture({ preventDefault } as never);
    interaction.onMouseDown({ preventDefault } as never);
    // A highlight/item update can rerender the menu between press phases. The shared ref preserves
    // pointer origin across the new handler object.
    promptMenuItemInteractionProps(file, onSelect, true, pointerDownItemKey).onMouseUp({
      button: 0,
    } as never);

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();

    interaction.onClick();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it("selects on mouseup only when a press started elsewhere over the highlighted row", () => {
    const onSelect = vi.fn();

    promptMenuItemInteractionProps(file, onSelect, false, { current: null }).onMouseUp({
      button: 0,
    } as never);
    promptMenuItemInteractionProps(file, onSelect, true, { current: null }).onMouseUp({
      button: 1,
    } as never);
    expect(onSelect).not.toHaveBeenCalled();

    promptMenuItemInteractionProps(file, onSelect, true, { current: null }).onMouseUp({
      button: 0,
    } as never);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(file);
  });
});
