export interface OpenCodeEventSourceInput {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export type OpenCodeEventSourceFactory = (
  input: OpenCodeEventSourceInput,
) => Promise<AsyncIterable<unknown>>;
