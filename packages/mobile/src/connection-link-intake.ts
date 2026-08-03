import { parseOpenCodeConnection } from "@honk/opencode";

// A type literal (not an interface) so it keeps the implicit index signature expo-router's
// search-params constraint requires.
export type ConnectionRouteParams = {
  readonly origin?: string | string[];
  readonly pairing?: string | string[];
  readonly password?: string | string[];
  readonly token?: string | string[];
};

export interface IncomingConnectionLink {
  readonly deliveryID: number;
  readonly key: string;
  readonly value: string;
  readonly fallbackOrigin: string;
}

export interface ConnectionLinkIntake {
  readonly pending: IncomingConnectionLink | null;
  readonly receivedKeys: readonly string[];
  readonly nextDeliveryID: number;
}

export const EMPTY_CONNECTION_LINK_INTAKE: ConnectionLinkIntake = Object.freeze({
  pending: null,
  receivedKeys: Object.freeze([]),
  nextDeliveryID: 1,
});

export function initialConnectionForm(
  params: ConnectionRouteParams,
  activeServer: {
    readonly descriptor: { readonly origin: string };
    readonly defaultDirectory: string;
  } | null,
): {
  readonly origin: string;
  readonly connectionValue: string;
  readonly defaultDirectory: string;
} {
  // The selected computer may seed its origin for manual entry, but never its project
  // folder: a scanned computer's folder must start empty instead of copying the selection's.
  return {
    origin: singleRouteValue(params.origin) ?? activeServer?.descriptor.origin ?? "",
    connectionValue: singleRouteValue(params.password) ?? singleRouteValue(params.token) ?? "",
    defaultDirectory: "",
  };
}

export function connectionLinkFromRoute(
  pathname: string,
  params: ConnectionRouteParams,
): string | null {
  if (pathname !== "/connect" && pathname !== "/pair") return null;
  const pairing = singleRouteValue(params.pairing)?.trim();
  const token = pairing || singleRouteValue(params.token)?.trim() || "";
  if (token.length === 0) return null;
  const origin = singleRouteValue(params.origin)?.trim() ?? "";
  const query = new URLSearchParams(origin.length > 0 ? { origin } : undefined);
  const fragment = new URLSearchParams({ pairing: token });
  const queryString = query.toString();
  return `honk://connect${queryString.length === 0 ? "" : `?${queryString}`}#${fragment.toString()}`;
}

export function receiveConnectionLink(
  intake: ConnectionLinkIntake,
  value: string,
  fallbackOrigin = "",
  repeat = false,
): ConnectionLinkIntake {
  const input = value.trim();
  if (input.length === 0) return intake;
  try {
    const candidate = parseOpenCodeConnection(input, fallbackOrigin);
    if (candidate === null || candidate.credential.type !== "pairing") return intake;
    const key = `${candidate.origin}\n${candidate.credential.value}`;
    if (intake.receivedKeys.includes(key) && !repeat) return intake;
    return {
      pending: {
        deliveryID: intake.nextDeliveryID,
        key,
        value: input,
        fallbackOrigin,
      },
      receivedKeys: intake.receivedKeys.includes(key)
        ? intake.receivedKeys
        : Object.freeze([...intake.receivedKeys.slice(-31), key]),
      nextDeliveryID: intake.nextDeliveryID + 1,
    };
  } catch {
    return intake;
  }
}

export function claimConnectionLink(
  intake: ConnectionLinkIntake,
  deliveryID: number,
): ConnectionLinkIntake {
  if (intake.pending?.deliveryID !== deliveryID) return intake;
  return { ...intake, pending: null };
}

// Expo delivers repeated route parameters as arrays; an ambiguous repeated value is treated
// as absent rather than throwing during render.
function singleRouteValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
