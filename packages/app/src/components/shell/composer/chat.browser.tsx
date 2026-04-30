// @ts-nocheck
import "../../../styles/tailwind.css";
import "../../../styles/app.css";
import "../../../styles/multi-tokens.css";

import type { HarnessDescriptor } from "~/lib/ui-session-types";
import type { ChatDraftFile } from "./types";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    server: {
      listSkills: vi.fn(async () => []),
    },
    projects: {
      listEntries: vi.fn(async () => ({ entries: [], truncated: false })),
      readFile: vi.fn(async () => ({
        relativePath: "README.md",
        contents: "",
        sizeBytes: 0,
        truncated: false,
        syntax: { languageId: "markdown" },
      })),
      searchEntries: vi.fn(async () => ({ entries: [] })),
    },
    git: {
      onStatus: vi.fn(() => () => undefined),
    },
  },
  navigate: vi.fn(),
  openSettings: vi.fn(),
  send: vi.fn(async () => ({ clear: true })),
  runtime: {
    items: [
      {
        key: "codex/gpt-5.4",
        provider: "codex",
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
        supportsFastMode: true,
        supportsXhigh: true,
      },
    ],
    fastMode: false,
    fastSupported: true,
    loading: false,
    status: "ready" as const,
    thinkingLevel: "high" as const,
  },
}));

vi.mock("~/native-api", () => ({
  readNativeApi: () => mocks.api,
}));

vi.mock("~/lib/native-runtime-api", () => ({
  ensureNativeEnvironmentApi: () => mocks.api,
  readNativeEnvironmentApi: () => mocks.api,
  readNativeRuntimeApi: () => mocks.api,
}));

vi.mock("~/hooks/use-runtime-models", () => ({
  useRuntimeModels: () => mocks.runtime,
}));

vi.mock("~/hooks/use-shell-cwd", () => ({
  useShellState: () => ({ cwd: "/tmp/project" }),
}));

vi.mock("~/lib/thread-session-store", () => ({
  useThreadSessionStore: (pick: (state: object) => unknown) =>
    pick({
      snaps: {
        "thread-fast": {
          thinkingLevel: "high",
        },
      },
      work: {},
    }),
}));

vi.mock("~/store", () => ({
  selectProjectsAcrossEnvironments: () => [
    {
      id: "project-1",
      environmentId: "env-1",
      name: "Project",
      cwd: "/tmp/project",
      repositoryIdentity: null,
      defaultModelSelection: null,
      scripts: [],
    },
  ],
  selectBootstrapCompleteForActiveEnvironment: () => true,
  selectEnvironmentState: (state: { environmentStateById: Record<string, unknown> }, id: string) =>
    state.environmentStateById[id],
  selectProjectByRef: () => null,
  selectProjectsForEnvironment: () => [],
  selectSidebarThreadsForProjectRef: () => [],
  selectSidebarThreadsForProjectRefs: () => [],
  selectSidebarThreadsAcrossEnvironments: () => [],
  selectSidebarThreadSummaryByRef: () => null,
  selectThreadByRef: () => null,
  selectThreadExistsByRef: () => false,
  selectThreadIdsByProjectRef: () => [],
  selectThreadShellsAcrossEnvironments: () => [],
  selectThreadsAcrossEnvironments: () => [],
  selectThreadsForEnvironment: () => [],
  useStore: (pick: (state: object) => unknown) =>
    pick({
      activeEnvironmentId: "env-1",
      environmentStateById: {
        "env-1": {
          projectIds: ["project-1"],
          projectById: {
            "project-1": {
              id: "project-1",
              environmentId: "env-1",
              name: "Project",
              cwd: "/tmp/project",
              repositoryIdentity: null,
              defaultModelSelection: null,
              scripts: [],
            },
          },
          threadIds: ["thread-fast"],
          threadIdsByProjectId: { "project-1": ["thread-fast"] },
          threadShellById: {
            "thread-fast": {
              id: "thread-fast",
              projectId: "project-1",
              environmentId: "env-1",
              title: "Thread",
              branch: null,
            },
          },
          threadSessionById: {},
          threadTurnStateById: {},
          messageIdsByThreadId: {},
          messageByThreadId: {},
          activityIdsByThreadId: {},
          activityByThreadId: {},
          proposedPlanIdsByThreadId: {},
          proposedPlanByThreadId: {},
          turnDiffIdsByThreadId: {},
          turnDiffSummaryByThreadId: {},
          sidebarThreadSummaryById: {},
          bootstrapComplete: true,
        },
      },
      threads: [{ id: "thread-fast", branch: null }],
    }),
}));

vi.mock("~/components/shell/settings/context", () => ({
  useShellSettings: () => ({ openSettings: mocks.openSettings }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: () => undefined,
}));

import { ChatComposer } from "./chat";

const descriptor: HarnessDescriptor = {
  kind: "codex",
  label: "Codex",
  available: true,
  enabled: true,
  capabilities: {
    modelPicker: true,
    thinkingLevels: true,
    commands: true,
    interactive: true,
    fileAttachments: true,
  },
};

function Harness(props: { supported: boolean; files?: ChatDraftFile[] }) {
  const [draft, setDraft] = useState("");
  const [fast, setFast] = useState(false);
  return (
    <ChatComposer
      sessionId="thread-fast"
      draft={draft}
      files={props.files}
      onDraft={setDraft}
      busy={false}
      model={{
        provider: "codex",
        id: "gpt-5.4",
        name: "GPT-5.4",
        reasoning: true,
      }}
      modelLoading={false}
      variant="dock"
      onAbort={() => {}}
      onModel={() => {}}
      onThinkingLevel={() => {}}
      fastActive={fast}
      fastSupported={props.supported}
      onFastMode={setFast}
      onFastToggle={() => setFast((cur) => !cur)}
      onPlanMode={() => {}}
      onPlanToggle={() => {}}
      onSend={mocks.send}
      harness="codex"
      harnessDescriptor={descriptor}
    />
  );
}

async function mount(opts: { supported?: boolean; files?: ChatDraftFile[] } = {}) {
  const supported = opts.supported ?? true;
  mocks.runtime.items = [
    {
      key: "codex/gpt-5.4",
      provider: "codex",
      id: "gpt-5.4",
      name: "GPT-5.4",
      reasoning: true,
      supportsFastMode: supported,
      supportsXhigh: true,
    },
  ];
  mocks.runtime.fastSupported = supported;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<Harness supported={supported} files={opts.files} />);
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

function seg(text: string) {
  for (const node of document.querySelectorAll<HTMLSpanElement>(".multi-composer-mirror span")) {
    if (node.textContent === text) return node;
  }
  return undefined;
}

function check(node: HTMLSpanElement) {
  const style = getComputedStyle(node);
  const cut =
    style.getPropertyValue("box-decoration-break") ||
    style.getPropertyValue("-webkit-box-decoration-break");
  expect(parseFloat(style.paddingLeft)).toBeGreaterThan(0);
  expect(parseFloat(style.paddingRight)).toBeGreaterThan(0);
  expect(parseFloat(style.borderRadius)).toBeGreaterThan(0);
  expect(cut).toBe("clone");
  expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
}

describe("ChatComposer fast mode", () => {
  beforeEach(() => {
    mocks.api.server.listSkills.mockImplementation(async () => []);
    mocks.api.server.listSkills.mockClear();
    mocks.api.projects.searchEntries.mockClear();
    mocks.api.projects.searchEntries.mockImplementation(async () => ({ entries: [] }));
    mocks.navigate.mockClear();
    mocks.openSettings.mockClear();
    mocks.send.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows /fast, toggles it from the slash menu, and updates the pill state", async () => {
    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/fa");

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("/fast");
      expect(text).toContain("Turn on fast mode");
    });

    await page.getByRole("option").click();

    await vi.waitFor(() => {
      expect((document.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "").toBe(
        "",
      );
      expect(document.body.textContent ?? "").toContain("Fast");
    });

    await page.getByRole("textbox").fill("/fa");

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Turn off fast mode");
    });

    await page.getByLabelText("Turn off fast mode").click();

    await page.getByRole("textbox").fill("/fa");

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Turn on fast mode");
    });
  });

  it("toggles fast mode from a raw /fast submit without sending a message", async () => {
    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/fast");
    document
      .querySelector("textarea")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );

    await vi.waitFor(() => {
      expect(mocks.send).not.toHaveBeenCalled();
      expect((document.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "").toBe(
        "",
      );
      expect(document.body.textContent ?? "").toContain("Fast");
    });
  });

  it("Enter commits the top slash command without arrow navigation", async () => {
    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/fa");

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("/fast");
      expect(document.body.textContent ?? "").toContain("Turn on fast mode");
    });

    document
      .querySelector("textarea")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );

    await vi.waitFor(() => {
      expect(mocks.send).not.toHaveBeenCalled();
      expect((document.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "").toBe(
        "",
      );
      expect(document.body.textContent ?? "").toContain("Fast");
    });
  });

  it("does not offer /fast when the selected model does not support it", async () => {
    await using _ = await mount({ supported: false });

    await page.getByRole("textbox").fill("/fa");

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("/fast");
      expect(document.body.textContent ?? "").not.toContain("Turn on fast mode");
    });
  });
});

describe("ChatComposer mirror tokens", () => {
  beforeEach(() => {
    mocks.api.server.listSkills.mockClear();
    mocks.api.server.listSkills.mockImplementation(async () => []);
    mocks.api.projects.searchEntries.mockClear();
    mocks.api.projects.searchEntries.mockImplementation(async () => ({ entries: [] }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders idle skill tokens as tinted text and keeps mentions as chips", async () => {
    mocks.api.server.listSkills.mockResolvedValue([
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        body: "Use the Tailwind skill.",
        description: "Tailwind CSS guidance.",
      },
    ]);

    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/ta");
    await page.getByRole("option", { name: /tailwind/i }).click();
    await page.getByRole("textbox").fill('/tailwind @"foo bar"');

    await vi.waitFor(() => {
      expect(seg("/tailwind")).toBeTruthy();
      expect(seg('@"foo bar"')).toBeTruthy();
    });

    const skill = seg("/tailwind")!;
    const style = getComputedStyle(skill);
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(style.paddingLeft)).toBe(0);

    check(seg('@"foo bar"')!);
  });

  it("renders pending slash text as plain unstyled text", async () => {
    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/tai");

    await vi.waitFor(() => {
      expect(seg("/tai")).toBeTruthy();
    });

    const node = seg("/tai")!;
    const style = getComputedStyle(node);
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(parseFloat(style.paddingLeft)).toBe(0);
    expect(parseFloat(style.paddingRight)).toBe(0);
  });

  it("Enter with slash menu open inserts the top skill as a token", async () => {
    mocks.api.server.listSkills.mockResolvedValue([
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        body: "Use the Tailwind skill.",
        description: "Tailwind CSS guidance.",
      },
    ]);

    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/tailwind");

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("tailwind");
    });

    document
      .querySelector("textarea")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );

    await vi.waitFor(() => {
      expect(mocks.send).not.toHaveBeenCalled();
      const node = document.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(node?.value ?? "").toContain("/tailwind");
    });
  });

  it("expands a selected skill on send", async () => {
    mocks.api.server.listSkills.mockResolvedValue([
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        body: "Use the Tailwind skill.",
        description: "Tailwind CSS guidance.",
      },
    ]);

    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/ta");
    await page.getByRole("option", { name: /tailwind/i }).click();
    document
      .querySelector("textarea")
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );

    await vi.waitFor(() => {
      expect(mocks.send).toHaveBeenCalledWith({
        text: "Use the Tailwind skill. ",
        attachments: [],
      });
    });
  });

  it("deletes a selected skill token as a block", async () => {
    mocks.api.server.listSkills.mockResolvedValue([
      {
        id: "/Users/workgyver/.agents/skills/tailwind",
        name: "tailwind",
        body: "Use the Tailwind skill.",
        description: "Tailwind CSS guidance.",
      },
    ]);

    await using _ = await mount({ supported: true });

    await page.getByRole("textbox").fill("/ta");
    await page.getByRole("option", { name: /tailwind/i }).click();

    const node = document.querySelector("textarea") as HTMLTextAreaElement;
    node.focus();
    node.setSelectionRange(2, 2);
    node.dispatchEvent(new Event("select", { bubbles: true }));

    await vi.waitFor(() => {
      expect(node.selectionStart).toBe(0);
      expect(node.selectionEnd).toBe(9);
    });

    node.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Backspace" }),
    );

    await vi.waitFor(() => {
      expect(node.value).toBe("");
    });
  });

  it("executes slash actions without clearing attached files", async () => {
    await using _ = await mount({
      supported: true,
      files: [
        {
          id: "file:readme",
          type: "path",
          name: "README.md",
          path: "/tmp/project/README.md",
          kind: "file",
          size: 42,
          mimeType: "text/markdown",
        },
      ],
    });

    await page.getByRole("textbox").fill("/fa");
    await page.getByRole("option").click();

    await vi.waitFor(() => {
      expect((document.querySelector("textarea") as HTMLTextAreaElement | null)?.value ?? "").toBe(
        "",
      );
      expect(document.body.textContent ?? "").toContain("README.md");
      expect(document.body.textContent ?? "").toContain("Fast");
    });
  });
});
