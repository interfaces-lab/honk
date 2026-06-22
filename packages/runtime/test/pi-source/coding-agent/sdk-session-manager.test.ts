import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testModels = ModelRegistry.inMemory(AuthStorage.inMemory());

function requireAnthropicModel(): Model<string> {
  const model = testModels.find("anthropic", "claude-sonnet-4-5");
  if (!model) throw new Error("Expected anthropic model claude-sonnet-4-5");
  return model as Model<string>;
}

describe("createAgentSession session manager defaults", () => {
  let tempDir: string;
  let cwd: string;
  let agentDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `pi-sdk-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cwd = join(tempDir, "project");
    agentDir = join(tempDir, "agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses agentDir for the default persisted session path", async () => {
    const model = requireAnthropicModel();

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model,
    });

    const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const expectedSessionDir = join(agentDir, "sessions", safePath);
    const sessionDir = session.sessionManager.getSessionDir();
    const sessionFile = session.sessionManager.getSessionFile();

    expect(sessionDir).toBe(expectedSessionDir);
    expect(sessionFile?.startsWith(`${expectedSessionDir}/`)).toBe(true);

    session.dispose();
  });

  it("keeps an explicit sessionManager override", async () => {
    const model = requireAnthropicModel();

    const sessionManager = SessionManager.inMemory(cwd);
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model,
      sessionManager,
    });

    expect(session.sessionManager).toBe(sessionManager);
    expect(session.sessionManager.isPersisted()).toBe(false);

    session.dispose();
  });

  it("derives cwd from an explicit sessionManager when cwd is omitted", async () => {
    const model = requireAnthropicModel();

    const sessionCwd = join(tempDir, "session-project");
    mkdirSync(sessionCwd, { recursive: true });
    const sessionManager = SessionManager.inMemory(sessionCwd);
    const { session } = await createAgentSession({
      agentDir,
      model,
      sessionManager,
    });

    expect(session.sessionManager).toBe(sessionManager);
    expect(session.systemPrompt).toContain(`Current working directory: ${sessionCwd}`);

    const bashTool = session.agent.state.tools.find((tool) => tool.name === "bash");
    expect(bashTool).toBeTruthy();
    const result = await bashTool!.execute("test", { command: "pwd" });
    const output = result.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("");

    expect(realpathSync(output.trim())).toBe(realpathSync(sessionCwd));

    session.dispose();
  });
});
