import "../../../index.css";
import "../../../styles/tokens.css";
import "../../../styles/app.css";

import { IconConsole, IconFileText } from "central-icons";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RightWorkbenchDefinition } from "./app";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import { ShellSidebarFooter } from "~/components/shell/sidebar/footer";
import { ShellSidebarHeader } from "~/components/shell/sidebar/header";
import { AppShell } from "./app";

vi.mock("@tanstack/react-router", () => ({
  getRouteApi: () => ({
    useSearch: () => ({}),
  }),
  Link: (props: {
    children: ReactNode;
    className?: string;
    "aria-label"?: string;
    to: string;
  }) => (
    <a href={props.to} className={props.className} aria-label={props["aria-label"]}>
      {props.children}
    </a>
  ),
  useNavigate: () => () => undefined,
}));

vi.mock("~/hooks/use-settings", () => ({
  useSettings: <T,>(selector: (settings: Record<string, unknown>) => T): T =>
    selector({
      agentWindowChatMaxWidth: 760,
      agentWindowFontSmoothingAntialiased: true,
    }),
}));

vi.mock("~/components/shell/shared/update-pill", () => ({
  UpdatePill: () => null,
}));

const rightWorkbench: RightWorkbenchDefinition = {
  tabs: [{ id: "files", label: "Files", icon: IconFileText }],
  panels: {
    files: <section>Project files panel</section>,
  },
};

const rightWorkbenchWithTerminal: RightWorkbenchDefinition = {
  tabs: [
    { id: "files", label: "Files", icon: IconFileText },
    { id: "terminal", label: "Terminal", icon: IconConsole },
  ],
  panels: {
    files: <section>Project files panel</section>,
    terminal: <section data-terminal-panel="mounted">Terminal panel side effect</section>,
  },
};

function rectWidth(selector: string): number {
  return document.querySelector<HTMLElement>(selector)?.getBoundingClientRect().width ?? 0;
}

function elementRect(element: Element | null): DOMRect | null {
  return element?.getBoundingClientRect() ?? null;
}

async function mount(options: {
  hostWidth: number;
  left?: ReactNode;
  right: RightWorkbenchDefinition | null;
  rightOpen?: boolean;
}) {
  shellPanelsActions.setLeftOpen(true);
  shellPanelsActions.setActiveTab("files");
  shellPanelsActions.setRightOpen(options.rightOpen ?? false);
  shellPanelsActions.setMuted(false);
  shellPanelsActions.setLeftWidth(180);
  shellPanelsActions.setRightWidth(400);

  const host = document.createElement("div");
  host.style.width = `${options.hostWidth}px`;
  host.style.height = "932px";
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <AppShell
      cwd="/tmp/project"
      left={options.left ?? <button type="button">Restored sidebar row</button>}
      center={<main>Thread route content</main>}
      right={options.right}
    />,
  );
  await Promise.resolve();
  const cleanup = async () => {
    root.unmount();
    host.remove();
  };
  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("AppShell sidebar", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    shellPanelsActions.setLeftOpen(true);
    shellPanelsActions.setRightOpen(false);
    shellPanelsActions.setMuted(false);
  });

  it("collapses and restores the sidebar at a narrow expanded width without changing the route", async () => {
    await using _ = await mount({ hostWidth: 720, right: null });
    const initialHref = window.location.href;
    const sidebar = () =>
      document.querySelector<HTMLElement>("[data-agent-window-sidebar]");
    const sidebarContent = () => sidebar()?.firstElementChild;

    await vi.waitFor(() => {
      expect(document.body.textContent, "initial render: expected sidebar content").toContain(
        "Restored sidebar row",
      );
      expect(sidebar()?.dataset.state, "initial render: expected sidebar expanded state").toBe(
        "expanded",
      );
      expect(
        sidebar()?.getAttribute("aria-hidden"),
        "initial render: expected sidebar to be exposed",
      ).toBeNull();
      expect(
        sidebarContent()?.getAttribute("aria-hidden"),
        "initial render: expected sidebar content to be exposed",
      ).toBe("false");
      expect(
        rectWidth("[data-agent-window-sidebar]"),
        "initial render: expected sidebar width",
      ).toBeGreaterThan(0);
    });

    await page.getByRole("button", { name: "Collapse chats" }).click();
    expect(window.location.href, "collapse chats: expected route to stay unchanged").toBe(
      initialHref,
    );
    await vi.waitFor(() => {
      expect(sidebar()?.dataset.state, "collapse chats: expected sidebar collapsed state").toBe(
        "collapsed",
      );
      expect(
        sidebar()?.getAttribute("aria-hidden"),
        "collapse chats: expected sidebar to be hidden",
      ).toBe("true");
      expect(
        sidebarContent()?.getAttribute("aria-hidden"),
        "collapse chats: expected sidebar content to be hidden",
      ).toBe("true");
      expect(
        rectWidth("[data-agent-window-sidebar]"),
        "collapse chats: expected sidebar width to collapse",
      ).toBeLessThanOrEqual(1);
    });

    await page.getByRole("button", { name: "Expand chats" }).click();
    expect(window.location.href, "expand chats: expected route to stay unchanged").toBe(
      initialHref,
    );
    await vi.waitFor(() => {
      expect(sidebar()?.dataset.state, "expand chats: expected sidebar expanded state").toBe(
        "expanded",
      );
      expect(
        sidebar()?.getAttribute("aria-hidden"),
        "expand chats: expected sidebar to be exposed",
      ).toBeNull();
      expect(
        sidebarContent()?.getAttribute("aria-hidden"),
        "expand chats: expected sidebar content to be exposed",
      ).toBe("false");
      expect(
        rectWidth("[data-agent-window-sidebar]"),
        "expand chats: expected sidebar width to restore",
      ).toBeGreaterThan(0);
    });
  });

  it("opens the project panel below auto-collapse thresholds without hiding the toggle", async () => {
    await using _ = await mount({ hostWidth: 430, right: rightWorkbench, rightOpen: false });
    const shell = () => document.querySelector<HTMLElement>("[data-agent-window]");
    const rightToggle = () =>
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Hide project panel"], button[aria-label^="Show project panel"]',
      );

    await vi.waitFor(() => {
      expect(
        shell()?.dataset.shellRightIntent,
        "narrow shell before toggle: expected right panel collapsed intent",
      ).toBe("collapsed");
      expect(
        rectWidth("[data-agent-window]"),
        "narrow shell before toggle: expected compact shell width",
      ).toBeLessThan(620);
      expect(
        rectWidth("[data-agent-window-sidebar]"),
        "narrow shell before toggle: expected left sidebar auto-collapsed width",
      ).toBeLessThanOrEqual(1);
      expect(
        rectWidth("[data-agent-window-workbench]"),
        "narrow shell before toggle: expected right workbench collapsed width",
      ).toBeLessThanOrEqual(1);
    });

    await page.getByRole("button", { name: /Show project panel/ }).click();

    await vi.waitFor(() => {
      expect(
        shell()?.dataset.shellRightIntent,
        "narrow shell after toggle: expected right panel expanded intent",
      ).toBe("expanded");
      expect(
        rectWidth("[data-agent-window]"),
        "narrow shell after toggle: expected compact shell width",
      ).toBeLessThan(620);
      expect(
        rectWidth("[data-agent-window-sidebar]"),
        "narrow shell after toggle: expected left sidebar to remain auto-collapsed",
      ).toBeLessThanOrEqual(1);
      expect(
        rectWidth("[data-agent-window-workbench]"),
        "narrow shell after toggle: expected right workbench forced open",
      ).toBeGreaterThan(0);
      expect(document.body.textContent, "narrow shell after toggle: expected files panel").toContain(
        "Project files panel",
      );

      const shellRect = elementRect(shell());
      const toggleRect = elementRect(rightToggle());
      if (!shellRect || !toggleRect) {
        throw new Error("Expected shell and project panel toggle to be mounted.");
      }
      expect(
        toggleRect.left,
        "narrow shell after toggle: project toggle left edge outside shell",
      ).toBeGreaterThanOrEqual(shellRect.left);
      expect(
        toggleRect.right,
        "narrow shell after toggle: project toggle right edge outside shell",
      ).toBeLessThanOrEqual(shellRect.right);
    });
  });

  it("keeps sidebar header and footer controls inside the rail", async () => {
    await using _ = await mount({
      hostWidth: 720,
      right: null,
      left: (
        <div className="flex h-full min-h-0 flex-col">
          <ShellSidebarHeader onNewChat={vi.fn()} onAddProject={vi.fn()} />
          <div className="min-h-0 flex-1" />
          <ShellSidebarFooter />
        </div>
      ),
    });

    await vi.waitFor(() => {
      const sidebar = document.querySelector<HTMLElement>("[data-agent-window-sidebar]");
      const sidebarRect = elementRect(sidebar);
      const controls = [
        {
          label: "new agent",
          element: document.querySelector<HTMLElement>('[data-testid="new-thread-button"]'),
        },
        {
          label: "open project",
          element: document.querySelector<HTMLElement>(
            '[data-testid="sidebar-add-project-trigger"]',
          ),
        },
        {
          label: "settings",
          element: document.querySelector<HTMLElement>('a[aria-label="Open settings"]'),
        },
      ];
      if (!sidebarRect) {
        throw new Error("Expected sidebar rail to render.");
      }

      for (const control of controls) {
        if (!control.element) {
          throw new Error(`Expected ${control.label} sidebar control to render.`);
        }
        const controlRect = elementRect(control.element);
        if (!controlRect) {
          throw new Error(`Expected ${control.label} sidebar control to have layout bounds.`);
        }
        expect(controlRect.left, `${control.label}: left edge outside sidebar`).toBeGreaterThanOrEqual(
          sidebarRect.left,
        );
        expect(controlRect.right, `${control.label}: right edge outside sidebar`).toBeLessThanOrEqual(
          sidebarRect.right,
        );
      }
    });
  });

  it("does not mount terminal panel content until the terminal tab is active", async () => {
    await using _ = await mount({
      hostWidth: 960,
      right: rightWorkbenchWithTerminal,
      rightOpen: true,
    });

    await vi.waitFor(() => {
      expect(document.body.textContent, "initial files tab: expected files panel content").toContain(
        "Project files panel",
      );
      expect(
        document.querySelector("[data-terminal-panel]"),
        "initial files tab: expected terminal panel to stay unmounted",
      ).toBeNull();
    });

    await page.getByRole("tab", { name: "Terminal" }).click();

    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-terminal-panel]"),
        "terminal tab: expected terminal panel to mount",
      ).not.toBeNull();
      expect(document.body.textContent, "terminal tab: expected terminal panel content").toContain(
        "Terminal panel side effect",
      );
    });
  });
});
