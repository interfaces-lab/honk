import { queryOptions } from "@tanstack/react-query";
import { isDesktopRuntimeApiAvailable, readHonkRuntimeApi } from "./honk-runtime-api";

export type { RuntimeSkillSummary } from "@honk/contracts";

export const runtimeSkillsQueryKeys = {
  all: ["runtime-skills"] as const,
  list: (cwd: string | null) => ["runtime-skills", "list", cwd] as const,
};

const DEFAULT_RUNTIME_SKILLS_STALE_TIME = 15_000;

export function runtimeSkillsQueryOptions(input: { cwd: string | null; enabled: boolean }) {
  return queryOptions({
    queryKey: runtimeSkillsQueryKeys.list(input.cwd),
    queryFn: async () => {
      // Pure-web builds expose no runtime bridge; readHonkRuntimeApi() throws there, so the
      // availability check must run first (the enabled gate below covers the normal path).
      if (!input.cwd || !isDesktopRuntimeApiAvailable()) {
        throw new Error("Runtime skills are unavailable.");
      }
      return readHonkRuntimeApi().listSkills({ cwd: input.cwd });
    },
    enabled: input.enabled && input.cwd !== null && isDesktopRuntimeApiAvailable(),
    staleTime: DEFAULT_RUNTIME_SKILLS_STALE_TIME,
  });
}
