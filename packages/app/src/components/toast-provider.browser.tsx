import "../index.css";
import "../styles/tokens.css";

import { scopeThreadRef } from "@multi/client-runtime";
import { EnvironmentId, ThreadId } from "@multi/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider, toastManager } from "../app/toast";

const ACTIVE_ENVIRONMENT_ID = EnvironmentId.make("environment-toast-active");
const ACTIVE_THREAD_ID = ThreadId.make("thread-toast-active");

vi.mock("@tanstack/react-router", () => ({
  useParams: <TResult,>(options?: {
    select?: (
      params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
    ) => TResult;
  }) => {
    const params = {
      environmentId: ACTIVE_ENVIRONMENT_ID,
      threadId: ACTIVE_THREAD_ID,
    };
    return options?.select ? options.select(params) : params;
  },
}));

const toastIds: ReturnType<typeof toastManager.add>[] = [];

function addToast(input: Parameters<typeof toastManager.add>[0]) {
  const id = toastManager.add(input);
  toastIds.push(id);
  return id;
}

function readToastTitles(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="toast-title"]')).map(
    (element) => element.textContent ?? "",
  );
}

function findToastTitle(title: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="toast-title"]')).find(
      (element) => element.textContent === title,
    ) ?? null
  );
}

function findToastRootByTitle(title: string): HTMLElement | null {
  return findToastTitle(title)?.closest<HTMLElement>('[data-slot="toast-popup"]') ?? null;
}

function setClipboardWriter(writeText: (value: string) => Promise<void>): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(navigator, "clipboard", descriptor);
      return;
    }
    Reflect.deleteProperty(navigator, "clipboard");
  };
}

describe("ToastProvider", () => {
  afterEach(() => {
    for (const id of toastIds.splice(0)) {
      toastManager.close(id);
    }
    document.body.innerHTML = "";
  });

  it("renders global and active-thread toasts while hiding other-thread toasts", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ToastProvider>
        <div />
      </ToastProvider>,
      { container: host },
    );

    try {
      addToast({
        title: "Global toast",
        type: "info",
      });
      addToast({
        title: "Active thread toast",
        type: "success",
        data: {
          threadRef: scopeThreadRef(ACTIVE_ENVIRONMENT_ID, ACTIVE_THREAD_ID),
        },
      });
      addToast({
        title: "Other thread toast",
        type: "warning",
        data: {
          threadRef: scopeThreadRef(
            EnvironmentId.make("environment-toast-other"),
            ACTIVE_THREAD_ID,
          ),
        },
      });

      await vi.waitFor(() => {
        const titles = readToastTitles();
        expect(titles).toContain("Global toast");
        expect(titles).toContain("Active thread toast");
      });
      expect(readToastTitles()).not.toContain("Other thread toast");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps the front-most toast readable in a collapsed stack", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ToastProvider>
        <div />
      </ToastProvider>,
      { container: host },
    );

    try {
      addToast({
        title: "Older toast",
        description: "This toast sits behind the latest visible toast.",
        type: "info",
      });
      addToast({
        title: "Front toast",
        description: "This toast should stay readable while the stack is collapsed.",
        type: "success",
      });

      await vi.waitFor(() => {
        const frontRoot = findToastRootByTitle("Front toast");
        const olderRoot = findToastRootByTitle("Older toast");
        const frontTitle = findToastTitle("Front toast");
        const frontContent = frontRoot?.querySelector<HTMLElement>('[data-slot="toast-content"]');
        const olderContent = olderRoot?.querySelector<HTMLElement>('[data-slot="toast-content"]');

        expect(frontRoot, "expected front toast root").toBeTruthy();
        expect(olderRoot, "expected older toast root").toBeTruthy();
        expect(frontTitle, "expected front toast title").toBeTruthy();
        expect(frontContent, "expected front toast content").toBeTruthy();
        expect(olderContent, "expected older toast content").toBeTruthy();
        expect(frontContent!.hasAttribute("data-behind")).toBe(false);
        expect(olderContent!.hasAttribute("data-behind")).toBe(true);
        expect(getComputedStyle(frontContent!).opacity).toBe("1");

        const rootRect = frontRoot!.getBoundingClientRect();
        const titleRect = frontTitle!.getBoundingClientRect();
        expect(titleRect.left).toBeGreaterThanOrEqual(rootRect.left - 0.5);
        expect(titleRect.right).toBeLessThanOrEqual(rootRect.right + 0.5);
        expect(titleRect.top).toBeGreaterThanOrEqual(rootRect.top - 0.5);
        expect(titleRect.bottom).toBeLessThanOrEqual(rootRect.bottom + 0.5);
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps action toasts inside a fixed rounded block", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ToastProvider>
        <div />
      </ToastProvider>,
      { container: host },
    );

    try {
      addToast({
        title: 'Archived "Sidebar polish"',
        type: "success",
        actionProps: {
          children: "Undo",
          onClick: vi.fn(),
        },
      });

      await vi.waitFor(() => {
        const viewport = document.querySelector<HTMLElement>('[data-slot="toast-viewport"]');
        const root = document.querySelector<HTMLElement>('[data-slot="toast-popup"]');
        const action = document.querySelector<HTMLElement>('[data-slot="toast-action"]');

        expect(viewport, "expected global toast viewport").toBeTruthy();
        expect(root, "expected global toast root").toBeTruthy();
        expect(action, "expected action button").toBeTruthy();

        const viewportRect = viewport!.getBoundingClientRect();
        const rootRect = root!.getBoundingClientRect();
        const actionRect = action!.getBoundingClientRect();
        const rootStyle = getComputedStyle(root!);

        expect(viewportRect.width).toBeGreaterThan(0);
        expect(Math.abs(rootRect.width - viewportRect.width)).toBeLessThanOrEqual(1);
        expect(rootRect.width).toBeGreaterThan(actionRect.width);
        expect(actionRect.left).toBeGreaterThanOrEqual(rootRect.left - 0.5);
        expect(actionRect.right).toBeLessThanOrEqual(rootRect.right + 0.5);
        expect(actionRect.top).toBeGreaterThanOrEqual(rootRect.top - 0.5);
        expect(actionRect.bottom).toBeLessThanOrEqual(rootRect.bottom + 0.5);
        expect(rootStyle.overflow).toBe("hidden");
        expect(rootStyle.borderRadius).toBe("6px");
      });
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("copies error descriptions unless the callsite opts out", async () => {
    const writeText = vi.fn((_: string) => Promise.resolve());
    const restoreClipboard = setClipboardWriter(writeText);
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ToastProvider>
        <div />
      </ToastProvider>,
      { container: host },
    );

    try {
      addToast({
        title: "Structured command failed",
        description: "provider exited with code 1\nstderr: invalid flag",
        type: "error",
      });

      const copyButton = await vi.waitFor(() => {
        const button = document.querySelector<HTMLButtonElement>('button[title="Copy error"]');
        expect(button, "expected copy button for error details").toBeTruthy();
        return button!;
      });
      copyButton.click();

      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("provider exited with code 1\nstderr: invalid flag");
      });

      toastManager.close();
      toastIds.splice(0);
      await vi.waitFor(() => {
        expect(readToastTitles()).toHaveLength(0);
      });

      addToast({
        title: "Hidden copy action",
        description: "internal reconnect status",
        type: "error",
        data: {
          hideCopyButton: true,
        },
      });

      await vi.waitFor(() => {
        expect(readToastTitles()).toContain("Hidden copy action");
      });
      expect(document.querySelector<HTMLButtonElement>('button[title="Copy error"]')).toBeNull();
    } finally {
      restoreClipboard();
      await screen.unmount();
      host.remove();
    }
  });

  it("pauses visible-only auto-dismiss while the document is unfocused", async () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(
      <ToastProvider>
        <div />
      </ToastProvider>,
      { container: host },
    );

    try {
      addToast({
        title: "Paused visible toast",
        type: "success",
        data: {
          dismissAfterVisibleMs: 30,
        },
      });

      await vi.waitFor(() => {
        expect(readToastTitles()).toContain("Paused visible toast");
      });
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      expect(readToastTitles()).toContain("Paused visible toast");

      hasFocus.mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));

      await vi.waitFor(
        () => {
          expect(readToastTitles()).not.toContain("Paused visible toast");
        },
        { timeout: 2_000, interval: 16 },
      );
    } finally {
      hasFocus.mockRestore();
      await screen.unmount();
      host.remove();
    }
  });
});
