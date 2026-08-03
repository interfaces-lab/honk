export interface ServerStorageQueue {
  readonly run: <Result>(operation: () => Promise<Result>) => Promise<Result>;
}

export function createServerStorageQueue(): ServerStorageQueue {
  const state = { tail: Promise.resolve() };
  return {
    run: <Result>(operation: () => Promise<Result>): Promise<Result> => {
      const result = state.tail.then(operation);
      state.tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
