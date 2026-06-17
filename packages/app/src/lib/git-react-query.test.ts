import { EnvironmentId } from "@honk/contracts";
import { describe, expect, it } from "vitest";

import { gitBranchSearchInfiniteQueryOptions } from "./git-react-query";

describe("gitBranchSearchInfiniteQueryOptions", () => {
  it("does not poll branch lists in the background", () => {
    const options = gitBranchSearchInfiniteQueryOptions({
      environmentId: EnvironmentId.make("environment:git-branch-query"),
      cwd: "/repo",
      query: "",
    });

    expect(options.refetchInterval).toBeUndefined();
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.refetchOnReconnect).toBe(true);
  });
});
