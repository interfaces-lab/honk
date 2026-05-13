import { describe, expect, it } from "vitest";

import { buildCodexAppServerEnv } from "./codex-app-server-env.ts";

describe("buildCodexAppServerEnv", () => {
  it("injects git config hardening for Codex child processes", () => {
    const env = buildCodexAppServerEnv({ baseEnv: { PATH: "/bin" } });

    expect(env.PATH).toBe("/bin");
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(env.GIT_CONFIG_COUNT).toBe("2");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.fsmonitor");
    expect(env.GIT_CONFIG_VALUE_0).toBe("false");
    expect(env.GIT_CONFIG_KEY_1).toBe("core.untrackedCache");
    expect(env.GIT_CONFIG_VALUE_1).toBe("false");
  });

  it("appends hardening after existing git config entries so it wins", () => {
    const env = buildCodexAppServerEnv({
      baseEnv: {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.fsmonitor",
        GIT_CONFIG_VALUE_0: "true",
      },
    });

    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.fsmonitor");
    expect(env.GIT_CONFIG_VALUE_0).toBe("true");
    expect(env.GIT_CONFIG_KEY_1).toBe("core.fsmonitor");
    expect(env.GIT_CONFIG_VALUE_1).toBe("false");
    expect(env.GIT_CONFIG_KEY_2).toBe("core.untrackedCache");
    expect(env.GIT_CONFIG_VALUE_2).toBe("false");
  });

  it("drops malformed inherited git config env and sets CODEX_HOME", () => {
    const env = buildCodexAppServerEnv({
      baseEnv: {
        CODEX_HOME: "/old",
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "core.fsmonitor",
        GIT_CONFIG_VALUE_0: "true",
        GIT_CONFIG_KEY_1: "missing-value",
      },
      codexHome: "/new",
    });

    expect(env.CODEX_HOME).toBe("/new");
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.fsmonitor");
    expect(env.GIT_CONFIG_VALUE_0).toBe("true");
    expect(env.GIT_CONFIG_KEY_1).toBe("core.fsmonitor");
    expect(env.GIT_CONFIG_VALUE_1).toBe("false");
    expect(env.GIT_CONFIG_KEY_2).toBe("core.untrackedCache");
    expect(env.GIT_CONFIG_VALUE_2).toBe("false");
    expect(env.GIT_CONFIG_KEY_3).toBeUndefined();
  });
});
