export interface ManagedAccountSession {
  readonly accountId: string;
  readonly readAccessToken: () => Promise<string | null>;
}

export interface ManagedAccountSessionInput {
  readonly accountId: string;
  readonly readAccessToken: () => Promise<string | null>;
}

export interface ManagedAccountSessionStore {
  readonly getSnapshot: () => ManagedAccountSession | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly activate: (input: ManagedAccountSessionInput) => void;
  readonly deactivate: () => void;
}

export class ManagedAccountSessionInvalidError extends Error {
  constructor() {
    super("Managed account session requires a canonical non-empty account identifier.");
    this.name = "ManagedAccountSessionInvalidError";
  }
}

interface ActiveManagedAccountSession {
  readonly session: ManagedAccountSession;
  readonly readAccessToken: ManagedAccountSessionInput["readAccessToken"];
  readonly updateReadAccessToken: (
    readAccessToken: ManagedAccountSessionInput["readAccessToken"],
  ) => ActiveManagedAccountSession;
}

/**
 * Bridges an external account provider into managed remote access without owning that provider.
 *
 * Access tokens remain behind the injected callback. The store neither reads them eagerly nor
 * persists them, and replacing an account invalidates the observable snapshot synchronously.
 */
export function createManagedAccountSessionStore(): ManagedAccountSessionStore {
  let active: ActiveManagedAccountSession | null = null;
  const listeners = new Set<() => void>();

  const publish = (): void => {
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => active?.session ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate: (input) => {
      if (input.accountId.length === 0 || input.accountId.trim() !== input.accountId) {
        throw new ManagedAccountSessionInvalidError();
      }
      if (
        active?.session.accountId === input.accountId &&
        active.readAccessToken === input.readAccessToken
      ) {
        return;
      }
      active =
        active?.session.accountId === input.accountId
          ? active.updateReadAccessToken(input.readAccessToken)
          : createActiveManagedAccountSession(input);
      publish();
    },
    deactivate: () => {
      if (active === null) return;
      active = null;
      publish();
    },
  };
}

function createActiveManagedAccountSession(
  input: ManagedAccountSessionInput,
): ActiveManagedAccountSession {
  const control = {
    readAccessToken: input.readAccessToken,
  };
  const createActive = (): ActiveManagedAccountSession => ({
    session: Object.freeze({
      accountId: input.accountId,
      readAccessToken: () => control.readAccessToken(),
    }),
    readAccessToken: control.readAccessToken,
    updateReadAccessToken: (readAccessToken) => {
      control.readAccessToken = readAccessToken;
      return createActive();
    },
  });
  return createActive();
}
