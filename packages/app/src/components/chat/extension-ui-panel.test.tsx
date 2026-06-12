import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EventId,
  RuntimeSessionId,
  ThreadId,
  type DesktopExtensionUiRequest,
} from "@honk/contracts";
import {
  ComposerPendingExtensionUiRequestPanel,
  pendingExtensionUiRequestResponseActions,
} from "./composer/pending/extension-ui-request-panel";

function request(
  kind: DesktopExtensionUiRequest["kind"],
  input: Partial<DesktopExtensionUiRequest> = {},
): DesktopExtensionUiRequest {
  return {
    id: EventId.make(`request:${kind}`),
    threadId: ThreadId.make("thread:extension-ui"),
    runtimeSessionId: RuntimeSessionId.make("runtime:extension-ui"),
    kind,
    title: `${kind} title`,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...input,
  };
}

function renderPanel(panelRequest: DesktopExtensionUiRequest | null): string {
  return renderToStaticMarkup(
    <ComposerPendingExtensionUiRequestPanel
      request={panelRequest}
      pendingCount={2}
      isResponding={false}
      onRespond={() => undefined}
    />,
  );
}

describe("ComposerPendingExtensionUiRequestPanel", () => {
  it("renders no panel without a pending Pi extension UI request", () => {
    expect(renderPanel(null)).toBe("");
  });

  it("renders select requests and returns option values by request id", () => {
    const selectRequest = request("select", {
      title: "Choose branch",
      message: "Pick the branch to inspect.",
      options: ["sqlite", "main"],
    });

    const html = renderPanel(selectRequest);
    expect(html).toContain("Select an option");
    expect(html).toContain("Choose branch");
    expect(html).toContain("Pick the branch to inspect.");
    expect(html).toContain("sqlite");
    expect(html).toContain("main");
    expect(pendingExtensionUiRequestResponseActions(selectRequest, "")).toEqual([
      { label: "sqlite", value: "sqlite" },
      { label: "main", value: "main" },
    ]);
  });

  it("renders confirm requests and maps actions to boolean responses", () => {
    const confirmRequest = request("confirm", {
      title: "Run project agent?",
      message: "Project-local agents are repo-controlled.",
    });

    const html = renderPanel(confirmRequest);
    expect(html).toContain("Run project agent?");
    expect(html).toContain("Confirm");
    expect(html).toContain("Cancel");
    expect(pendingExtensionUiRequestResponseActions(confirmRequest, "")).toEqual([
      { label: "Confirm", value: true },
      { label: "Cancel", value: false },
    ]);
  });

  it.each(["input", "editor", "custom"] as const)(
    "renders %s requests and maps send to the current draft",
    (kind) => {
      const inputRequest = request(kind, {
        title: `${kind} prompt`,
        placeholder: "Type your answer",
      });

      const html = renderPanel(inputRequest);
      expect(html).toContain(`${kind} prompt`);
      expect(html).toContain("Type your answer");
      expect(html).toContain("Send");
      expect(pendingExtensionUiRequestResponseActions(inputRequest, "the answer")).toEqual([
        { label: "Send", value: "the answer" },
      ]);
    },
  );
});
