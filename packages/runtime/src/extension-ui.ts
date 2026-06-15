import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import { readDefaultPiTheme } from "./pi-default-theme";

export type DesktopExtensionUiRequestKind =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "question"
  | "custom";

export interface DesktopExtensionUiQuestionOption {
  readonly id: string;
  readonly label: string;
}

export interface DesktopExtensionUiQuestion {
  readonly id: string;
  readonly text: string;
  readonly options: readonly DesktopExtensionUiQuestionOption[];
  readonly allowMultiple: boolean;
}

export interface DesktopExtensionUiRequest {
  readonly id: string;
  readonly kind: DesktopExtensionUiRequestKind;
  readonly title: string;
  readonly message?: string;
  readonly placeholder?: string;
  readonly options?: readonly string[];
  readonly questions?: readonly DesktopExtensionUiQuestion[];
  readonly timeout?: number;
  readonly createdAt: string;
}

export interface DesktopExtensionUiQuestionAnswer {
  readonly questionId: string;
  readonly selectedOptionIds: readonly string[];
  readonly freeformText?: string;
}

export interface DesktopExtensionUiQuestionResult {
  readonly answers: readonly DesktopExtensionUiQuestionAnswer[];
  readonly cancelled: boolean;
}

interface PendingRequest {
  readonly request: DesktopExtensionUiRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `extension-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function parseQuestionResult(value: unknown): DesktopExtensionUiQuestionResult {
  if (!value || typeof value !== "object") {
    return { answers: [], cancelled: true };
  }
  const record = value as Record<string, unknown>;
  const rawAnswers = Array.isArray(record.answers) ? record.answers : [];
  const answers = rawAnswers
    .map((entry): DesktopExtensionUiQuestionAnswer | null => {
      if (!entry || typeof entry !== "object") return null;
      const answerRecord = entry as Record<string, unknown>;
      if (typeof answerRecord.questionId !== "string") return null;
      const selectedOptionIds = Array.isArray(answerRecord.selectedOptionIds)
        ? answerRecord.selectedOptionIds.filter((item): item is string => typeof item === "string")
        : [];
      const freeformText =
        typeof answerRecord.freeformText === "string" && answerRecord.freeformText.trim().length > 0
          ? answerRecord.freeformText.trim()
          : undefined;
      if (selectedOptionIds.length === 0 && !freeformText) return null;
      return {
        questionId: answerRecord.questionId,
        selectedOptionIds,
        ...(freeformText ? { freeformText } : {}),
      };
    })
    .filter((answer): answer is DesktopExtensionUiQuestionAnswer => answer !== null);

  return {
    answers,
    cancelled: record.cancelled === true,
  };
}

export class DesktopExtensionUiController {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestLog: DesktopExtensionUiRequest[] = [];
  private readonly notifications: Array<{ message: string; type: "info" | "warning" | "error" }> =
    [];
  private readonly pendingRequestListeners = new Set<() => void>();
  private readonly status = new Map<string, string>();
  private editorText = "";
  private toolsExpanded = false;
  private disposedError: Error | null = null;

  private readonly handleCustom: ExtensionUIContext["custom"] = <T>() =>
    Promise.resolve(undefined as T);

  readonly context: ExtensionUIContext & {
    askQuestion: (
      title: string,
      questions: readonly DesktopExtensionUiQuestion[],
      opts?: ExtensionUIDialogOptions,
    ) => Promise<DesktopExtensionUiQuestionResult>;
  } = {
    askQuestion: (title, questions, opts) =>
      this.enqueueRequest(
        "question",
        { title, questions },
        opts,
        { answers: [], cancelled: true },
        parseQuestionResult,
      ),
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
      return readDefaultPiTheme();
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

  onPendingRequestsChanged(listener: () => void): () => void {
    this.pendingRequestListeners.add(listener);
    return () => {
      this.pendingRequestListeners.delete(listener);
    };
  }

  getStatus(key: string): string | undefined {
    return this.status.get(key);
  }

  resolveRequest(id: string, value: unknown): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }
    pending.resolve(value);
    return true;
  }

  rejectRequest(id: string, error: Error): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      return false;
    }
    pending.reject(error);
    return true;
  }

  dispose(error = new Error("Desktop extension UI session disposed.")): void {
    if (this.disposedError) {
      return;
    }
    this.disposedError = error;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pendingRequestListeners.clear();
  }

  private emitPendingRequestsChanged(): void {
    for (const listener of this.pendingRequestListeners) {
      listener();
    }
  }

  private enqueueRequest<TResult>(
    kind: DesktopExtensionUiRequestKind,
    input: {
      readonly title: string;
      readonly message?: string;
      readonly placeholder?: string;
      readonly options?: readonly string[];
      readonly questions?: readonly DesktopExtensionUiQuestion[];
    },
    opts: ExtensionUIDialogOptions | undefined,
    defaultValue: TResult,
    resolveResult: (value: unknown) => TResult,
  ): Promise<TResult> {
    if (opts?.signal?.aborted) {
      return Promise.resolve(defaultValue);
    }
    if (this.disposedError) {
      return Promise.resolve(defaultValue);
    }

    const request: DesktopExtensionUiRequest = {
      id: newRequestId(),
      kind,
      title: input.title,
      ...(input.message ? { message: input.message } : {}),
      ...(input.placeholder ? { placeholder: input.placeholder } : {}),
      ...(input.options ? { options: input.options } : {}),
      ...(input.questions ? { questions: input.questions } : {}),
      ...(opts?.timeout ? { timeout: opts.timeout } : {}),
      createdAt: new Date().toISOString(),
    };
    this.requestLog.push(request);

    return new Promise<TResult>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(request.id);
        this.emitPendingRequestsChanged();
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
        reject: (error) => {
          cleanup();
          reject(error);
        },
        cleanup,
      });
      this.emitPendingRequestsChanged();
    });
  }
}

export function createDesktopExtensionUi(): DesktopExtensionUiController {
  return new DesktopExtensionUiController();
}
