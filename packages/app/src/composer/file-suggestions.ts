import type { OpenCodeFileApi } from "@honk/opencode";

const FILE_SEARCH_TIMEOUT_MS = 2_000;

type FileSearchResult = Awaited<ReturnType<OpenCodeFileApi["find"]>>;
type FileSuggestionSearch = {
  readonly files: Pick<OpenCodeFileApi, "find">;
  readonly query: string;
  readonly directory?: string;
  readonly signal: AbortSignal;
  readonly timeoutMs?: number;
};

export async function findFileSuggestions(
  input: FileSuggestionSearch,
): Promise<FileSearchResult | null> {
  const first = await findFileSuggestionsOnce(input);
  if (first !== null || input.signal.aborted) return first;
  return findFileSuggestionsOnce(input);
}

async function findFileSuggestionsOnce(
  input: FileSuggestionSearch,
): Promise<FileSearchResult | null> {
  if (input.signal.aborted) return null;
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort(input.signal.reason);
  };
  input.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? FILE_SEARCH_TIMEOUT_MS);
  const result = await input.files
    .find(input.query, input.directory === undefined ? undefined : { directory: input.directory }, {
      signal: controller.signal,
    })
    .then<FileSearchResult, null>(
      (value) => value,
      () => null,
    );
  clearTimeout(timeout);
  input.signal.removeEventListener("abort", abort);
  if (input.signal.aborted) return null;
  return result;
}
