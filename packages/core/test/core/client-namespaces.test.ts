// spec/core.md section 6: "A contract test checks that every RPC appears in
// exactly one public namespace." The client object repeats no payload, result, or
// error definitions, so TypeScript already guards their shapes. What it cannot
// guard is reachability: an RPC added to a group but never bound to a method
// ships as dead wire surface, and one bound twice gives clients two names for
// one command.

import { createModels } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";

import type { HonkClient } from "../../src/honk-core";
import { createHonkCore, Rpcs } from "../../src/honk-core";
import { createExecutionEnv } from "../../src/testing";

const startCore = async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const faux = fauxProvider();
  const collection = createModels();
  collection.setProvider(faux.provider);
  return createHonkCore({
    dataDirectory: await mkdtemp(join(tmpdir(), "honk-client-data-")),
    createModels: () => collection,
    createExecutionEnv,
  });
};

// The namespaces a client exposes, minus `close`, which is client lifecycle
// rather than a command.
const namespacesOf = (sdk: HonkClient) => {
  const entries = Object.entries(sdk).filter(([, value]) => typeof value === "object");
  return new Map(
    entries.map(([name, group]) => [
      name,
      Object.entries(group as Record<string, unknown>)
        .filter(([, method]) => typeof method === "function")
        .map(([method]) => method),
    ]),
  );
};

describe("the public client namespaces", () => {
  it("reaches every RPC in the catalog exactly once", async () => {
    const core = await startCore();
    const sdk = core.client();

    // RPC tags are `namespace.command`; the client groups by that prefix.
    const byNamespace = new Map<string, string[]>();
    for (const tag of Rpcs.requests.keys()) {
      const namespace = tag.slice(0, tag.indexOf("."));
      byNamespace.set(namespace, [...(byNamespace.get(namespace) ?? []), tag]);
    }

    const namespaces = namespacesOf(sdk);

    // No namespace in the catalog is missing from the client.
    expect([...namespaces.keys()].sort()).toEqual([...byNamespace.keys()].sort());

    // Every command in a namespace has exactly one method, so none is
    // unreachable and none is bound twice under a second name.
    for (const [namespace, tags] of byNamespace) {
      expect(namespaces.get(namespace)).toHaveLength(tags.length);
    }

    // And nothing extra: the client invents no command the wire does not carry.
    const methodCount = [...namespaces.values()].flat().length;
    expect(methodCount).toBe(Rpcs.requests.size);

    await core.close();
  });

  it("carries the namespaces spec/core.md section 6 requires to always exist", async () => {
    const core = await startCore();
    const sdk = core.client();

    // "sdk.session, sdk.models, sdk.files, sdk.git, and sdk.mcp always exist."
    // TODO(core-migration §6): mcp is still missing, so this asserts what is
    // true today and names what is not. Add it here when it lands rather than
    // discovering the gap from a client.
    expect(Object.keys(sdk)).toEqual(
      expect.arrayContaining(["workspace", "session", "files", "git", "models"]),
    );
    expect(Object.keys(sdk)).not.toContain("mcp");

    await core.close();
  });
});
