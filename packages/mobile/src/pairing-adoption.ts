import {
  type HonkConfirmedConnection,
  HonkPairingRequestError,
  type HonkProvisionalConnection,
  type OpenCodeConnection,
} from "@honk/opencode";

import { normalizeRemoteOrigin } from "./pairing";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

interface PairingBase {
  readonly deviceId: string | null;
  readonly origin: string;
  readonly serverId: string | null;
  readonly rebindOrigin: string | null;
  readonly requestId: string;
  readonly serverLabel: string;
  readonly defaultDirectory: string;
  readonly replacePassword: string | null;
  readonly replaceServerId: string | null;
  readonly restorePreviousAccess: boolean;
  readonly previousServerLabel: string | null;
  readonly previousDefaultDirectory: string | null;
  readonly previousActiveServerKey: string | null;
  readonly previousEnvironmentId: string | null;
  readonly previousDeviceId: string | null;
  readonly previousProofKeyThumbprint: string | null;
}

export interface PairingRequest extends PairingBase {
  readonly deviceId: null;
  readonly status: "requesting";
  readonly token: string;
  readonly deviceLabel: string;
}

export interface PairingAdoption extends PairingBase {
  readonly status: "provisional" | "confirming" | "removing";
  readonly password: string;
  readonly expiresAt: string;
}

export type PendingPairingAdoption = PairingRequest | PairingAdoption;

export interface PairingAdoptionOperations {
  readonly isCurrent: () => boolean;
  readonly verifyIdentity: (target: {
    readonly origin: string;
    readonly serverId: string;
  }) => Promise<boolean>;
  readonly exchange: (request: PairingRequest) => Promise<HonkProvisionalConnection>;
  readonly stage: (pending: PendingPairingAdoption) => Promise<void>;
  readonly persist: (adoption: PairingAdoption) => Promise<void>;
  readonly confirm: (adoption: PairingAdoption) => Promise<HonkConfirmedConnection>;
  // Forgets the same computer's previous address only after new access is confirmed and durable.
  readonly releaseRebind: (adoption: PairingAdoption) => Promise<void>;
  readonly activate: (adoption: PairingAdoption) => Promise<void>;
  readonly probe: (connection: OpenCodeConnection) => Promise<void>;
  readonly isAccessRejected: (error: unknown) => boolean;
  readonly cancel: (adoption: PairingAdoption) => Promise<void>;
  readonly rollback: (pending: PendingPairingAdoption) => Promise<void>;
  readonly complete: (pending: PendingPairingAdoption) => Promise<void>;
}

export class PairingPersistenceError extends Error {
  readonly codeReusable: boolean;

  constructor(cause: unknown, accessRemoved: boolean) {
    super(
      accessRemoved
        ? "Honk could not save this connection. The new access was removed. Scan a new code and try again."
        : "Honk could not save this connection before requesting access. Try again.",
      { cause },
    );
    this.name = "PairingPersistenceError";
    this.codeReusable = !accessRemoved;
  }
}

export class PairingIdentityError extends Error {
  constructor() {
    super(
      "Honk could not confirm this is the same computer, so it did not send your saved password.",
    );
    this.name = "PairingIdentityError";
  }
}

export function decodePairingAdoption(raw: string | null): PendingPairingAdoption | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The unfinished connection record is invalid.");
  }
  const origin = Reflect.get(value, "origin");
  const requestId = Reflect.get(value, "requestId");
  const serverLabel = Reflect.get(value, "serverLabel");
  const defaultDirectory = Reflect.get(value, "defaultDirectory");
  const replacePassword = Reflect.get(value, "replacePassword");
  const replaceServerId = Reflect.get(value, "replaceServerId");
  const restorePreviousAccess = Reflect.get(value, "restorePreviousAccess");
  // Legacy adoption records have no durable identity fields and decode them as null.
  const serverId = Reflect.get(value, "serverId");
  const rebindOrigin = Reflect.get(value, "rebindOrigin");
  // Records written before rollback metadata existed default to the pre-metadata behavior:
  // a replacement restores the scanned label and folder with the replaced origin active.
  const previousServerLabel =
    Reflect.get(value, "previousServerLabel") ??
    (Reflect.has(value, "previousServerLabel") || replacePassword === null ? null : serverLabel);
  const previousDefaultDirectory =
    Reflect.get(value, "previousDefaultDirectory") ??
    (Reflect.has(value, "previousDefaultDirectory") || replacePassword === null
      ? null
      : defaultDirectory);
  const previousActiveServerKey =
    Reflect.get(value, "previousActiveServerKey") ??
    (Reflect.has(value, "previousActiveServerKey") || replacePassword === null ? null : origin);
  const previousEnvironmentId = decodePreviousManagedIdentifier(value, "previousEnvironmentId");
  const previousDeviceId = decodePreviousManagedIdentifier(value, "previousDeviceId");
  const previousProofKeyThumbprint = decodePreviousManagedIdentifier(
    value,
    "previousProofKeyThumbprint",
  );
  const deviceId = decodePreviousManagedIdentifier(value, "deviceId");
  const status = Reflect.get(value, "status");
  if (
    typeof origin !== "string" ||
    typeof requestId !== "string" ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    typeof serverLabel !== "string" ||
    serverLabel.trim().length === 0 ||
    typeof defaultDirectory !== "string" ||
    (replacePassword !== null &&
      (typeof replacePassword !== "string" || replacePassword.length === 0)) ||
    (previousServerLabel !== null && typeof previousServerLabel !== "string") ||
    (previousDefaultDirectory !== null && typeof previousDefaultDirectory !== "string") ||
    (previousActiveServerKey !== null && typeof previousActiveServerKey !== "string") ||
    (previousServerLabel === null) !== (previousDefaultDirectory === null) ||
    (previousServerLabel === null) !== (replacePassword === null) ||
    typeof restorePreviousAccess !== "boolean"
  ) {
    throw new Error("The unfinished connection record is incomplete.");
  }
  const common = {
    deviceId,
    origin: normalizeRemoteOrigin(origin),
    serverId: typeof serverId === "string" && serverId.length > 0 ? serverId : null,
    rebindOrigin:
      typeof rebindOrigin === "string" && rebindOrigin.length > 0
        ? normalizeRemoteOrigin(rebindOrigin)
        : null,
    requestId,
    serverLabel: serverLabel.trim(),
    defaultDirectory: defaultDirectory.trim(),
    replacePassword,
    replaceServerId:
      typeof replaceServerId === "string" && replaceServerId.length > 0 ? replaceServerId : null,
    restorePreviousAccess,
    previousServerLabel: previousServerLabel?.trim() ?? null,
    previousDefaultDirectory: previousDefaultDirectory?.trim() ?? null,
    previousActiveServerKey:
      previousActiveServerKey === null ? null : normalizeRemoteOrigin(previousActiveServerKey),
    previousEnvironmentId,
    previousDeviceId,
    previousProofKeyThumbprint,
  };
  if (status === "requesting") {
    const token = Reflect.get(value, "token");
    const deviceLabel = Reflect.get(value, "deviceLabel");
    if (
      typeof token !== "string" ||
      token.length === 0 ||
      typeof deviceLabel !== "string" ||
      deviceLabel.trim().length === 0 ||
      deviceId !== null ||
      restorePreviousAccess !== (replacePassword !== null)
    ) {
      throw new Error("The unfinished connection request is incomplete.");
    }
    return { ...common, deviceId: null, status, token, deviceLabel: deviceLabel.trim() };
  }
  if (status !== "provisional" && status !== "confirming" && status !== "removing") {
    throw new Error("The unfinished connection record uses an unsupported state.");
  }
  const password = Reflect.get(value, "password");
  const expiresAt = Reflect.get(value, "expiresAt");
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    typeof expiresAt !== "string" ||
    expiresAt.length === 0
  ) {
    throw new Error("The unfinished connection access is incomplete.");
  }
  if (
    (status === "provisional" && restorePreviousAccess !== (replacePassword !== null)) ||
    (status === "confirming" && restorePreviousAccess) ||
    (status === "removing" && restorePreviousAccess && replacePassword === null)
  ) {
    throw new Error("The unfinished connection access has inconsistent recovery details.");
  }
  return { ...common, status, password, expiresAt };
}

export async function beginPairingAdoption(
  input: {
    readonly origin: string;
    readonly serverId: string | null;
    readonly rebindOrigin: string | null;
    readonly token: string;
    readonly requestId: string;
    readonly serverLabel: string;
    readonly deviceLabel: string;
    readonly defaultDirectory: string;
    readonly replacePassword: string | null;
    readonly replaceServerId: string | null;
    readonly previousServerLabel: string | null;
    readonly previousDefaultDirectory: string | null;
    readonly previousActiveServerKey: string | null;
    readonly previousEnvironmentId: string | null;
    readonly previousDeviceId: string | null;
    readonly previousProofKeyThumbprint: string | null;
  },
  operations: PairingAdoptionOperations,
): Promise<void> {
  const request: PairingRequest = {
    deviceId: null,
    origin: normalizeRemoteOrigin(input.origin),
    serverId: input.serverId,
    rebindOrigin: input.rebindOrigin === null ? null : normalizeRemoteOrigin(input.rebindOrigin),
    token: input.token,
    requestId: input.requestId,
    serverLabel: input.serverLabel.trim(),
    deviceLabel: input.deviceLabel.trim(),
    defaultDirectory: input.defaultDirectory.trim(),
    replacePassword: input.replacePassword,
    replaceServerId: input.replaceServerId,
    restorePreviousAccess: input.replacePassword !== null,
    previousServerLabel: input.previousServerLabel?.trim() ?? null,
    previousDefaultDirectory: input.previousDefaultDirectory?.trim() ?? null,
    previousActiveServerKey:
      input.previousActiveServerKey === null
        ? null
        : normalizeRemoteOrigin(input.previousActiveServerKey),
    previousEnvironmentId: canonicalPreviousManagedIdentifier(
      input.previousEnvironmentId,
      "previousEnvironmentId",
    ),
    previousDeviceId: canonicalPreviousManagedIdentifier(
      input.previousDeviceId,
      "previousDeviceId",
    ),
    previousProofKeyThumbprint: canonicalPreviousManagedIdentifier(
      input.previousProofKeyThumbprint,
      "previousProofKeyThumbprint",
    ),
    status: "requesting",
  };
  try {
    await operations.stage(request);
  } catch (cause) {
    if (!operations.isCurrent()) return;
    throw new PairingPersistenceError(cause, false);
  }
  if (!operations.isCurrent()) return;
  await resumePairingAdoption(request, operations);
}

export async function resumePairingAdoption(
  pending: PendingPairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<void> {
  if (pending.status === "removing") {
    await cancelAndRemove(pending, operations);
    return;
  }
  if (pending.status === "requesting") {
    if (!(await replacementIdentityVerified(pending, operations))) {
      if (!operations.isCurrent()) return;
      throw new PairingIdentityError();
    }
    if (!operations.isCurrent()) return;
    const provisional = await operations.exchange(pending).catch(async (error: unknown) => {
      if (!operations.isCurrent()) return null;
      if (!isTerminalRequestError(error)) throw error;
      await clearRequest(pending, operations);
      if (!operations.isCurrent()) return null;
      throw error;
    });
    if (provisional === null || !operations.isCurrent()) return;
    await persistAndConfirm(provisionalAdoption(pending, provisional), operations);
    return;
  }
  if (pending.status === "provisional") {
    await persistAndConfirm(pending, operations);
    return;
  }
  try {
    await operations.persist(pending);
  } catch (cause) {
    if (!operations.isCurrent()) return;
    await removeAfterStorageFailure(pending, cause, operations);
    return;
  }
  if (!operations.isCurrent()) return;
  await confirmAndActivate(pending, false, operations);
}

export async function removePairingAdoption(
  pending: PendingPairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<void> {
  if (pending.status === "requesting") {
    // Removal must never dead-end on an unprovable computer: the exchange would carry the saved
    // password, so the request is dropped locally instead, and its unconfirmed access expires.
    if (!(await replacementIdentityVerified(pending, operations))) {
      if (!operations.isCurrent()) return;
      await clearRequest(pending, operations);
      return;
    }
    if (!operations.isCurrent()) return;
    const provisional = await operations.exchange(pending).catch(async (error: unknown) => {
      if (!operations.isCurrent()) return null;
      if (!isTerminalRequestError(error)) throw error;
      await clearRequest(pending, operations);
      if (!operations.isCurrent()) return null;
      if (error.kind === "existing-access-invalid") throw error;
      return null;
    });
    if (provisional === null || !operations.isCurrent()) return;
    await stageAndRemove(provisionalAdoption(pending, provisional), operations);
    return;
  }
  await stageAndRemove(pending, operations);
}

// The keyed proof is the gate on every path that would transmit the saved password. A record
// without a saved identity has nothing to prove and keeps working, which is what legacy records do.
async function replacementIdentityVerified(
  pending: PairingRequest | PairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<boolean> {
  if (pending.replacePassword === null || pending.replaceServerId === null) return true;
  return operations
    .verifyIdentity({ origin: pending.origin, serverId: pending.replaceServerId })
    .catch(() => false);
}

function isTerminalRequestError(error: unknown): error is HonkPairingRequestError {
  return (
    error instanceof HonkPairingRequestError &&
    (error.kind === "invalid" || error.kind === "existing-access-invalid")
  );
}

function decodePreviousManagedIdentifier(record: object, field: string): string | null {
  return canonicalPreviousManagedIdentifier(Reflect.get(record, field), field);
}

function canonicalPreviousManagedIdentifier(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  throw new Error(`The unfinished connection record has an invalid ${field}.`);
}

async function clearRequest(
  request: PairingRequest,
  operations: PairingAdoptionOperations,
): Promise<void> {
  await operations.rollback(request);
  if (!operations.isCurrent()) return;
  await operations.complete(request);
}

function provisionalAdoption(
  request: PairingRequest,
  provisional: HonkProvisionalConnection,
): PairingAdoption {
  return {
    deviceId: provisional.deviceId,
    origin: provisional.origin,
    serverId: request.serverId,
    rebindOrigin: request.rebindOrigin,
    password: provisional.password,
    requestId: provisional.requestId,
    expiresAt: provisional.expiresAt,
    serverLabel: request.serverLabel,
    defaultDirectory: request.defaultDirectory,
    replacePassword: request.replacePassword,
    replaceServerId: request.replaceServerId,
    restorePreviousAccess: request.restorePreviousAccess,
    previousServerLabel: request.previousServerLabel,
    previousDefaultDirectory: request.previousDefaultDirectory,
    previousActiveServerKey: request.previousActiveServerKey,
    previousEnvironmentId: request.previousEnvironmentId,
    previousDeviceId: request.previousDeviceId,
    previousProofKeyThumbprint: request.previousProofKeyThumbprint,
    status: "provisional",
  };
}

async function persistAndConfirm(
  adoption: PairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<void> {
  const confirming: PairingAdoption = {
    ...adoption,
    status: "confirming",
    restorePreviousAccess: false,
  };
  try {
    await operations.stage(adoption);
    if (!operations.isCurrent()) return;
    await operations.persist(adoption);
    if (!operations.isCurrent()) return;
    await operations.stage(confirming);
  } catch (cause) {
    if (!operations.isCurrent()) return;
    await removeAfterStorageFailure(adoption, cause, operations);
    return;
  }
  if (!operations.isCurrent()) return;
  await confirmAndActivate(confirming, adoption.restorePreviousAccess, operations);
}

async function confirmAndActivate(
  adoption: PairingAdoption,
  restorePreviousAccessOnInvalid: boolean,
  operations: PairingAdoptionOperations,
): Promise<void> {
  try {
    await operations.confirm(adoption);
  } catch (error) {
    if (!operations.isCurrent()) return;
    if (!(error instanceof HonkPairingRequestError) || error.kind !== "invalid") throw error;
    await recoverLostConfirmation(adoption, restorePreviousAccessOnInvalid, error, operations);
    return;
  }
  if (!operations.isCurrent()) return;
  await operations.releaseRebind(adoption);
  if (!operations.isCurrent()) return;
  try {
    await operations.activate(adoption);
  } catch (error) {
    // A stale flow's activation failure belongs to the newer attempt, not this caller.
    if (!operations.isCurrent()) return;
    throw error;
  }
  if (!operations.isCurrent()) return;
  await operations.complete(adoption);
}

// A host restart can forget the completed request while retaining the final device. The
// provisional password is also the final password, so a successful health check is
// authoritative and completes recovery without revoking valid access.
async function recoverLostConfirmation(
  adoption: PairingAdoption,
  restorePreviousAccessOnInvalid: boolean,
  invalidError: HonkPairingRequestError,
  operations: PairingAdoptionOperations,
): Promise<void> {
  try {
    await operations.activate(adoption);
  } catch (activationError) {
    if (!operations.isCurrent()) return;
    if (!operations.isAccessRejected(activationError)) throw activationError;
    await cancelAndRemove(
      { ...adoption, restorePreviousAccess: restorePreviousAccessOnInvalid },
      operations,
    );
    if (!operations.isCurrent()) return;
    throw invalidError;
  }
  if (!operations.isCurrent()) return;
  await operations.releaseRebind(adoption);
  if (!operations.isCurrent()) return;
  await operations.complete(adoption);
}

async function removeAfterStorageFailure(
  adoption: PairingAdoption,
  cause: unknown,
  operations: PairingAdoptionOperations,
): Promise<void> {
  try {
    // Cancellation comes first: a failing storage layer must not prevent provisional access
    // from being withdrawn while its credential is still available in memory.
    await operations.cancel(adoption);
    if (!operations.isCurrent()) return;
    await operations.rollback(adoption);
    if (!operations.isCurrent()) return;
    await operations.complete(adoption);
  } catch (rollbackCause) {
    if (!operations.isCurrent()) return;
    throw new AggregateError(
      [cause, rollbackCause],
      "The connection could not be saved, and the provisional access could not be removed.",
    );
  }
  if (!operations.isCurrent()) return;
  throw new PairingPersistenceError(cause, true);
}

async function stageAndRemove(
  adoption: PairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<void> {
  const removal: PairingAdoption = { ...adoption, status: "removing" };
  await operations.stage(removal);
  if (!operations.isCurrent()) return;
  await cancelAndRemove(removal, operations);
}

async function cancelAndRemove(
  adoption: PairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<void> {
  await operations.cancel(adoption);
  if (!operations.isCurrent()) return;
  const resolved = await resolvePreviousAccess(adoption, operations);
  if (!operations.isCurrent()) return;
  await operations.rollback(resolved);
  if (!operations.isCurrent()) return;
  await operations.complete(resolved);
}

async function resolvePreviousAccess(
  adoption: PairingAdoption,
  operations: PairingAdoptionOperations,
): Promise<PairingAdoption> {
  if (adoption.replacePassword === null || adoption.restorePreviousAccess) return adoption;
  // The probe would offer the saved password, so an unprovable computer is never probed. Keeping
  // the saved connection is the honest outcome of not knowing: deleting it would punish a computer
  // that is merely unreachable, and a password the host really did replace surfaces as
  // "unauthorized" on the next connect, which the person can fix.
  if (!(await replacementIdentityVerified(adoption, operations))) {
    if (!operations.isCurrent()) return adoption;
    return { ...adoption, restorePreviousAccess: true };
  }
  if (!operations.isCurrent()) return adoption;
  try {
    await operations.probe({ origin: adoption.origin, password: adoption.replacePassword });
  } catch (error) {
    if (!operations.isCurrent()) return adoption;
    if (operations.isAccessRejected(error)) return adoption;
    throw error;
  }
  if (!operations.isCurrent()) return adoption;
  return { ...adoption, restorePreviousAccess: true };
}
