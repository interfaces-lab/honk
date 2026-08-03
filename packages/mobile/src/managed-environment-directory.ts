import {
  canonicalManagedEnvironmentSummary,
  type ManagedEnvironmentId,
  type ManagedEnvironmentSummary,
} from "@honk/shared/managed-remote-access";

export interface ManagedEnvironmentDirectory {
  readonly list: () => Promise<readonly ManagedEnvironmentSummary[]>;
  readonly resolve: (
    environmentId: ManagedEnvironmentId | string,
  ) => Promise<ManagedEnvironmentSummary | null>;
}

export class ManagedEnvironmentDirectoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ManagedEnvironmentDirectoryError";
  }
}

export function createManagedEnvironmentDirectory(input: {
  readonly relayZone: string;
  readonly load: () => Promise<unknown>;
}): ManagedEnvironmentDirectory {
  const list = async (): Promise<readonly ManagedEnvironmentSummary[]> => {
    const payload = await input.load().then(
      (value) => value,
      (cause: unknown) => {
        throw new ManagedEnvironmentDirectoryError("Honk could not load your linked computers.", {
          cause,
        });
      },
    );
    return decodeManagedEnvironmentDirectory(payload, input.relayZone);
  };

  return {
    list,
    resolve: async (environmentId) =>
      (await list()).find((environment) => environment.environmentId === environmentId) ?? null,
  };
}

export function decodeManagedEnvironmentDirectory(
  payload: unknown,
  relayZone: string,
): readonly ManagedEnvironmentSummary[] {
  if (!Array.isArray(payload)) {
    throw new ManagedEnvironmentDirectoryError(
      "The linked-computer service returned an invalid response.",
    );
  }
  const environments = payload.map((value) => canonicalManagedEnvironmentSummary(value, relayZone));
  if (environments.some((environment) => environment === null)) {
    throw new ManagedEnvironmentDirectoryError(
      "The linked-computer service returned an invalid endpoint.",
    );
  }
  const decoded = environments.filter(
    (environment): environment is ManagedEnvironmentSummary => environment !== null,
  );
  if (new Set(decoded.map((environment) => environment.environmentId)).size !== decoded.length) {
    throw new ManagedEnvironmentDirectoryError(
      "The linked-computer service returned a duplicate environment.",
    );
  }
  return Object.freeze(decoded);
}
