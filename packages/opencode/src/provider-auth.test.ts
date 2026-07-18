import { describe, expect, it, vi } from "vitest";

import {
  MANAGED_ANTHROPIC_METHOD_LABEL,
  MANAGED_ANTHROPIC_PLUGIN_SPEC,
  createManagedAnthropicImport,
  type ManagedAnthropicDependencies,
  type OpenCodeProviderInventory,
} from "./provider-auth";

function inventory(connected: boolean): OpenCodeProviderInventory {
  return {
    providers: [
      { id: "openai", name: "OpenAI", connected: false },
      { id: "anthropic", name: "Anthropic", connected },
    ],
  };
}

const managedMethod = () => ({
  index: 2,
  type: "oauth" as const,
  label: MANAGED_ANTHROPIC_METHOD_LABEL,
  prompts: [],
});

describe("managed Anthropic import", () => {
  it("pins the plugin and exact managed method contract", () => {
    expect(MANAGED_ANTHROPIC_PLUGIN_SPEC).toBe("opencode-anthropic-login-via-cli@1.6.1");
    expect(MANAGED_ANTHROPIC_METHOD_LABEL).toBe("Claude Code (auto)");
  });

  it("deduplicates concurrent imports and trusts only refreshed inventory", async () => {
    const api = {
      list: vi.fn().mockResolvedValueOnce(inventory(false)).mockResolvedValueOnce(inventory(true)),
      authMethods: vi.fn().mockResolvedValue([managedMethod()]),
      authorizeOauth: vi
        .fn()
        .mockResolvedValue({ url: "http://localhost/callback", method: "auto", instructions: "" }),
      completeOauth: vi.fn().mockResolvedValue(undefined),
    } satisfies ManagedAnthropicDependencies;
    const ensure = createManagedAnthropicImport(api);
    const first = ensure();
    const second = ensure();
    expect(first).toBe(second);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "connected", inventory: inventory(true) },
      { kind: "connected", inventory: inventory(true) },
    ]);
    expect(api.authorizeOauth).toHaveBeenCalledOnce();
    expect(api.completeOauth).toHaveBeenCalledOnce();
  });

  it("requires auto handoff and attempts only once per disconnected episode", async () => {
    const api = {
      list: vi.fn().mockResolvedValue(inventory(false)),
      authMethods: vi.fn().mockResolvedValue([managedMethod()]),
      authorizeOauth: vi
        .fn()
        .mockResolvedValue({ url: "https://example.test", method: "code", instructions: "Paste" }),
      completeOauth: vi.fn().mockResolvedValue(undefined),
    } satisfies ManagedAnthropicDependencies;
    const ensure = createManagedAnthropicImport(api);
    await expect(ensure()).resolves.toMatchObject({ kind: "failed" });
    await expect(ensure()).resolves.toMatchObject({ kind: "failed" });
    expect(api.authorizeOauth).toHaveBeenCalledOnce();
    expect(api.completeOauth).not.toHaveBeenCalled();
  });

  it("re-attempts a settled episode when forced", async () => {
    const api = {
      list: vi
        .fn()
        .mockResolvedValueOnce(inventory(false))
        .mockResolvedValueOnce(inventory(false))
        .mockResolvedValueOnce(inventory(false))
        .mockResolvedValue(inventory(true)),
      authMethods: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([managedMethod()]),
      authorizeOauth: vi
        .fn()
        .mockResolvedValue({ url: "http://localhost/callback", method: "auto", instructions: "" }),
      completeOauth: vi.fn().mockResolvedValue(undefined),
    } satisfies ManagedAnthropicDependencies;
    const ensure = createManagedAnthropicImport(api);
    await expect(ensure()).resolves.toMatchObject({ kind: "unavailable" });
    await expect(ensure()).resolves.toMatchObject({ kind: "unavailable" });
    expect(api.authMethods).toHaveBeenCalledOnce();
    await expect(ensure({ force: true })).resolves.toMatchObject({ kind: "connected" });
    expect(api.authMethods).toHaveBeenCalledTimes(2);
    expect(api.authorizeOauth).toHaveBeenCalledOnce();
  });

  it("starts a new episode after a connected-to-disconnected transition", async () => {
    const api = {
      list: vi
        .fn()
        .mockResolvedValueOnce(inventory(true))
        .mockResolvedValueOnce(inventory(false))
        .mockResolvedValueOnce(inventory(true)),
      authMethods: vi.fn().mockResolvedValue([managedMethod()]),
      authorizeOauth: vi
        .fn()
        .mockResolvedValue({ url: "http://localhost/callback", method: "auto", instructions: "" }),
      completeOauth: vi.fn().mockResolvedValue(undefined),
    } satisfies ManagedAnthropicDependencies;
    const ensure = createManagedAnthropicImport(api);
    await expect(ensure()).resolves.toMatchObject({ kind: "connected" });
    await expect(ensure()).resolves.toMatchObject({ kind: "connected" });
    expect(api.authorizeOauth).toHaveBeenCalledOnce();
  });
});
