import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";

export type DesktopExtensionUiRequestKind = "select" | "confirm" | "input" | "editor" | "custom";

export interface DesktopExtensionUiRequest {
  readonly id: string;
  readonly kind: DesktopExtensionUiRequestKind;
  readonly title: string;
  readonly message?: string;
  readonly placeholder?: string;
  readonly options?: readonly string[];
  readonly timeout?: number;
  readonly createdAt: string;
}

interface PendingRequest {
  readonly request: DesktopExtensionUiRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `extension-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class DesktopExtensionUiController {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestLog: DesktopExtensionUiRequest[] = [];
  private readonly notifications: Array<{ message: string; type: "info" | "warning" | "error" }> = [];
  private readonly status = new Map<string, string>();
  private editorText = "";
  private toolsExpanded = false;

  private readonly handleCustom = <T>(
    _factory: Parameters<ExtensionUIContext["custom"]>[0],
    _opts?: Parameters<ExtensionUIContext["custom"]>[1],
  ): Promise<T> =>
    this.enqueueRequest<T>(
      "custom",
      { title: "Custom extension UI" },
      undefined,
      undefined as T,
      (value) => value as T,
    );

  readonly context: ExtensionUIContext = {
    select: (title, options, opts) =>
      this.enqueueRequest("select", { title, options }, opts, undefined, (value) =>
        typeof value === "string" ? value : undefined,
      ),
    confirm: (title, message, opts) =>
      this.enqueueRequest("confirm", { title, message }, opts, false, (value) => value === true),
    input: (title, placeholder, opts) =>
      this.enqueueRequest(
        "input",
        { title, ...(placeholder ? { placeholder } : {}) },
        opts,
        undefined,
        (value) => (typeof value === "string" ? value : undefined),
      ),
    notify: (message, type = "info") => {
      this.notifications.push({ message, type });
    },
    onTerminalInput: () => () => {},
    setStatus: (key, text) => {
      if (text === undefined) {
        this.status.delete(key);
      } else {
        this.status.set(key, text);
      }
    },
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: this.handleCustom,
    pasteToEditor: (text) => {
      this.editorText += text;
    },
    setEditorText: (text) => {
      this.editorText = text;
    },
    getEditorText: () => this.editorText,
    editor: (title, prefill) =>
      this.enqueueRequest(
        "editor",
        { title, ...(prefill ? { placeholder: prefill } : {}) },
        undefined,
        undefined,
        (value) => (typeof value === "string" ? value : undefined),
      ),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return undefined as never;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: "Desktop runtime does not expose Pi TUI themes." }),
    getToolsExpanded: () => this.toolsExpanded,
    setToolsExpanded: (expanded) => {
      this.toolsExpanded = expanded;
    },
  };

  get requests(): readonly DesktopExtensionUiRequest[] {
    return this.requestLog;
  }

  get pendingRequests(): readonly DesktopExtensionUiRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  get notificationLog(): readonly { message: string; type: "info" | "warning" | "error" }[] {
    return this.notifications;
  }

  getStatus(key: string): string | undefined {
    return this.status.get(key);
  }

  resolveRequest(id: string, value: unknown): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }
    pending.cleanup();
    pending.resolve(value);
    return true;
  }

  rejectRequest(id: string, error: Error): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }
    pending.cleanup();
    pending.reject(error);
    return true;
  }

  private enqueueRequest<TResult>(
    kind: DesktopExtensionUiRequestKind,
    input: {
      readonly title: string;
      readonly message?: string;
      readonly placeholder?: string;
      readonly options?: readonly string[];
    },
    opts: ExtensionUIDialogOptions | undefined,
    defaultValue: TResult,
    resolveResult: (value: unknown) => TResult,
  ): Promise<TResult> {
    if (opts?.signal?.aborted) {
      return Promise.resolve(defaultValue);
    }

    const request: DesktopExtensionUiRequest = {
      id: newRequestId(),
      kind,
      title: input.title,
      ...(input.message ? { message: input.message } : {}),
      ...(input.placeholder ? { placeholder: input.placeholder } : {}),
      ...(input.options ? { options: input.options } : {}),
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
      createdAt: new Date().toISOString(),
    };
    this.requestLog.push(request);

    return new Promise<TResult>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(request.id);
      };
      const onAbort = () => {
        cleanup();
        resolve(defaultValue);
      };

      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      if (opts?.timeout) {
        timeoutId = setTimeout(() => {
          cleanup();
          resolve(defaultValue);
        }, opts.timeout);
      }

      this.pending.set(request.id, {
        request,
        resolve: (value) => {
          cleanup();
          resolve(resolveResult(value));
        },
        reject,
        cleanup,
      });
    });
  }
}

export function createDesktopExtensionUi(): DesktopExtensionUiController {
  return new DesktopExtensionUiController();
}
