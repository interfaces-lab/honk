import {
  canonicalManagedEnvironmentSummary,
  type ManagedEnvironmentSummary,
} from "@honk/shared/managed-remote-access";
import { describe, expect, it } from "vitest";

import {
  additionalManagedEnvironmentRows,
  presentManagedEnvironmentRow,
} from "./managed-computer-presentation";
import {
  ManagedEnvironmentDiscoveryError,
  type ManagedEnvironmentDiscoveryRow,
  type ManagedEnvironmentDiscoveryState,
} from "./managed-environment-discovery";

const environment = testEnvironment("studio", "Studio");

function row(
  availability: ManagedEnvironmentDiscoveryRow["availability"],
): ManagedEnvironmentDiscoveryRow {
  if (availability === "error") {
    return {
      environment,
      availability,
      error: new ManagedEnvironmentDiscoveryError("Honk could not check this linked computer."),
    };
  }
  return { environment, availability, error: null };
}

describe("managed computer rows", () => {
  it.each([
    ["checking", "Checking…", "muted"],
    ["online", "Online", "success"],
    ["offline", "Offline", "muted"],
    ["unknown", "Status unavailable", "warning"],
    ["error", "Could not check", "error"],
  ] satisfies ReadonlyArray<
    readonly [
      ManagedEnvironmentDiscoveryRow["availability"],
      string,
      ReturnType<typeof presentManagedEnvironmentRow>["tone"],
    ]
  >)("presents %s availability without offering a connection", (availability, title, tone) => {
    expect(presentManagedEnvironmentRow(row(availability))).toMatchObject({ title, tone });
  });

  it("omits an account row already represented by a saved environment", () => {
    const state: ManagedEnvironmentDiscoveryState = {
      environments: new Map([[environment.environmentId, row("online")]]),
      refreshing: false,
      offline: false,
      error: null,
    };

    expect(additionalManagedEnvironmentRows(state, new Set())).toHaveLength(1);
    expect(additionalManagedEnvironmentRows(state, new Set([environment.environmentId]))).toEqual(
      [],
    );
  });

  it("keeps distinct linked computers in relay order", () => {
    const laptop = testEnvironment("laptop", "Laptop");
    const state: ManagedEnvironmentDiscoveryState = {
      environments: new Map([
        [environment.environmentId, row("online")],
        [laptop.environmentId, { ...row("offline"), environment: laptop }],
      ]),
      refreshing: false,
      offline: false,
      error: null,
    };

    expect(
      additionalManagedEnvironmentRows(state, new Set()).map(
        (candidate) => candidate.environment.label,
      ),
    ).toEqual(["Studio", "Laptop"]);
  });
});

function testEnvironment(environmentId: string, label: string): ManagedEnvironmentSummary {
  const decoded = canonicalManagedEnvironmentSummary(
    {
      environmentId,
      label,
      endpoint: {
        providerKind: "cloudflare_tunnel",
        httpBaseUrl: `https://${environmentId}.remote.honk.example/`,
        wsBaseUrl: `wss://${environmentId}.remote.honk.example/`,
      },
      status: "unknown",
    },
    "remote.honk.example",
  );
  if (decoded === null) throw new Error("The test environment is invalid.");
  return decoded;
}
