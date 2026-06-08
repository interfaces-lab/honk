import * as Sch from "effect/Schema";
import { useLocalStorage } from "./use-local-storage";

const STORAGE_KEY_PREFIX = "multi:git-viewed";

const ViewedPathsSchema = Sch.mutable(Sch.Array(Sch.String));

export function useGitViewed(gitRoot: string | null) {
  // When no git root, use a sentinel key that won't collide with real repos
  const key = gitRoot ? `${STORAGE_KEY_PREFIX}:${gitRoot}` : `${STORAGE_KEY_PREFIX}:_no_repo_`;

  const [viewed, setViewed] = useLocalStorage<string[], string[]>(key, [], ViewedPathsSchema);

  const isViewed = (path: string) => viewed.includes(path);

  const toggleViewed = (path: string) => {
    setViewed((prev) => {
      if (prev.includes(path)) return prev.filter((p) => p !== path);
      return [...prev, path];
    });
  };

  const markAllViewed = (paths: string[]) => {
    setViewed((prev) => {
      const set = new Set([...prev, ...paths]);
      return Array.from(set);
    });
  };

  const unmarkViewed = (paths: string[]) => {
    const pathsToClear = new Set(paths);
    setViewed((prev) => prev.filter((path) => !pathsToClear.has(path)));
  };

  const clearViewed = () => {
    setViewed([]);
  };

  return { viewed, isViewed, toggleViewed, markAllViewed, unmarkViewed, clearViewed };
}
