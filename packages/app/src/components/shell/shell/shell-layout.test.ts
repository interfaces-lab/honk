import { describe, expect, it } from "vitest";

import {
  CHAT_NARROW_THRESHOLD,
  computeResponsivePaneLayout,
  resolveShellPresentation,
  SHELL_BREAKPOINTS,
} from "./shell-layout";

const ALL_OPEN = { leftOpen: true, rightOpen: true, secondaryRailOpen: true };

describe("resolveShellPresentation", () => {
  it("keeps every open panel inline on wide shells", () => {
    expect(resolveShellPresentation({ shellWidth: 1400, ...ALL_OPEN })).toEqual({
      left: "inline-expanded",
      right: "inline-expanded",
      secondaryRail: "inline-expanded",
    });
  });

  it("treats an unmeasured shell (width 0) as wide", () => {
    expect(resolveShellPresentation({ shellWidth: 0, ...ALL_OPEN })).toEqual({
      left: "inline-expanded",
      right: "inline-expanded",
      secondaryRail: "inline-expanded",
    });
  });

  it("collapses closed panels at any width", () => {
    for (const shellWidth of [500, 850, 1400]) {
      expect(
        resolveShellPresentation({
          shellWidth,
          leftOpen: false,
          rightOpen: false,
          secondaryRailOpen: false,
        }),
      ).toEqual({ left: "collapsed", right: "collapsed", secondaryRail: "collapsed" });
    }
  });

  it("switches the secondary rail to overlay at its breakpoint", () => {
    expect(
      resolveShellPresentation({ shellWidth: SHELL_BREAKPOINTS.secondaryRailOverlay, ...ALL_OPEN }),
    ).toEqual({
      left: "inline-expanded",
      right: "inline-expanded",
      secondaryRail: "overlay-expanded",
    });
    expect(
      resolveShellPresentation({
        shellWidth: SHELL_BREAKPOINTS.secondaryRailOverlay + 1,
        ...ALL_OPEN,
      }).secondaryRail,
    ).toBe("inline-expanded");
  });

  it("never overlays the right workbench — it force-expands inline at any width", () => {
    for (const shellWidth of [320, 620, 900, 1600]) {
      expect(resolveShellPresentation({ shellWidth, ...ALL_OPEN }).right).toBe("inline-expanded");
    }
  });

  it("switches the left sidebar to overlay at its breakpoint", () => {
    expect(
      resolveShellPresentation({ shellWidth: SHELL_BREAKPOINTS.leftOverlay, ...ALL_OPEN }),
    ).toEqual({
      left: "overlay-expanded",
      right: "inline-expanded",
      secondaryRail: "overlay-expanded",
    });
    expect(
      resolveShellPresentation({ shellWidth: SHELL_BREAKPOINTS.leftOverlay + 1, ...ALL_OPEN }).left,
    ).toBe("inline-expanded");
  });

  it("never hides a panel whose intent is open", () => {
    for (const shellWidth of [1, 320, 500, 620, 621, 900, 901, 980, 981, 1600]) {
      const presentation = resolveShellPresentation({ shellWidth, ...ALL_OPEN });
      expect(presentation.left).not.toBe("collapsed");
      expect(presentation.right).not.toBe("collapsed");
      expect(presentation.secondaryRail).not.toBe("collapsed");
    }
  });
});

describe("computeResponsivePaneLayout", () => {
  it("computes narrow state from available center pane width", () => {
    expect(
      computeResponsivePaneLayout({
        dockedSidebarWidth: 260,
        editorPanelVisible: true,
        editorPanelWidth: 400,
        shellWidth: 1107,
      }),
    ).toEqual({
      centerPaneWidth: CHAT_NARROW_THRESHOLD - 1,
      isNarrow: true,
      narrowThreshold: CHAT_NARROW_THRESHOLD,
    });
  });

  it("does not treat the full window width as the chat width", () => {
    expect(
      computeResponsivePaneLayout({
        dockedSidebarWidth: 260,
        editorPanelVisible: true,
        editorPanelWidth: 400,
        shellWidth: 1108,
      }).isNarrow,
    ).toBe(false);
  });

  it("ignores an unavailable editor panel and treats unmeasured shells as wide", () => {
    expect(
      computeResponsivePaneLayout({
        dockedSidebarWidth: 260,
        editorPanelDisallowed: true,
        editorPanelVisible: true,
        editorPanelWidth: 400,
        shellWidth: 700,
      }),
    ).toMatchObject({ centerPaneWidth: 440, isNarrow: true });
    expect(
      computeResponsivePaneLayout({
        dockedSidebarWidth: 260,
        editorPanelVisible: true,
        editorPanelWidth: 400,
        shellWidth: 0,
      }).isNarrow,
    ).toBe(false);
  });
});
