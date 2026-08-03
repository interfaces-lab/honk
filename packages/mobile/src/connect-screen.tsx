import {
  HonkPairingRequestError,
  openCodeServerKey,
  previewHonkPairing,
  type HonkPairingPreview,
} from "@honk/opencode";
import { TextField } from "@honk/ui/text-field";
import { CameraView, useCameraPermissions } from "expo-camera";
import { randomUUID } from "expo-crypto";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams, usePathname } from "expo-router";
import * as React from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";

import {
  connectionLinkFromRoute,
  initialConnectionForm,
  type ConnectionRouteParams,
} from "./connection-link-intake";
import { useConnectionLinkIntake } from "./connection-link-provider";
import { normalizeRemoteOrigin, parseOpenCodeConnection } from "./pairing";
import { PairingPersistenceError } from "./pairing-adoption";
import { createConnectionAttemptFetch, runWithConnectionDeadline } from "./connection-request";
import { useRemote } from "./remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "./ui";

interface PendingPairing {
  readonly origin: string;
  readonly token: string;
  readonly preview: HonkPairingPreview;
  readonly source: PairingRetry["source"];
  readonly value: string;
  readonly fallbackOrigin: string;
}

interface PairingRetry {
  readonly value: string;
  readonly fallbackOrigin: string;
  readonly source: "link" | "manual" | "scan";
  readonly retryable: boolean;
}

const AUTOMATIC_DEVICE_LABEL =
  process.env.EXPO_OS === "ios"
    ? "Honk on iOS"
    : process.env.EXPO_OS === "android"
      ? "Honk on Android"
      : "Honk app";

async function loadPendingPairing(
  value: string,
  fallbackOrigin: string,
  source: PairingRetry["source"],
  controller: AbortController,
): Promise<PendingPairing> {
  const candidate = parseOpenCodeConnection(value, fallbackOrigin);
  if (candidate === null || candidate.credential.type !== "pairing") {
    throw new Error("Scan a Honk connection code or open a Honk connection link.");
  }
  const origin = normalizeRemoteOrigin(candidate.origin);
  return {
    origin,
    token: candidate.credential.value,
    preview: await runWithConnectionDeadline(controller, () =>
      previewHonkPairing(
        origin,
        candidate.credential.value,
        createConnectionAttemptFetch({ signal: controller.signal }),
      ),
    ),
    source,
    value,
    fallbackOrigin,
  };
}

function PairingScanner(props: {
  readonly permission: { readonly granted: boolean; readonly canAskAgain: boolean } | null;
  readonly busy: boolean;
  readonly pending: boolean;
  readonly scanLocked: boolean;
  readonly onRequestPermission: () => void;
  readonly onScan: (value: string) => void;
  readonly onScanAgain: () => void;
  readonly onManual: () => void;
}): React.ReactElement {
  const theme = useHonkTheme();
  return (
    <View style={{ gap: theme.metrics.space.sectionGap }}>
      <View style={{ gap: theme.metrics.space.contentGap }}>
        <BodyText
          accessibilityRole="header"
          style={{
            fontSize: theme.metrics.font.titleSize,
            fontWeight: theme.metrics.font.weightSemibold,
            lineHeight: theme.metrics.font.titleLeading,
            textAlign: "center",
          }}
        >
          Scan a Honk code
        </BodyText>
        <DetailText style={styles.centerText}>
          On your computer, choose Connect device, then point this camera at the QR code.
        </DetailText>
      </View>

      {props.permission === null ? (
        <View
          style={[
            styles.cameraSurface,
            styles.permission,
            {
              backgroundColor: theme.colors.layer01,
              borderRadius: theme.metrics.radius.panel,
              gap: theme.metrics.space.contentGap,
              padding: theme.metrics.space.panelPad,
            },
          ]}
        >
          <DetailText accessibilityLiveRegion="polite">Preparing camera…</DetailText>
        </View>
      ) : props.permission.granted ? (
        <View
          accessible
          accessibilityLabel="QR code scanner"
          style={[
            styles.cameraSurface,
            styles.cameraFrame,
            {
              borderColor: theme.colors.borderBase,
              borderRadius: theme.metrics.radius.panel,
            },
          ]}
        >
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={
              props.pending || props.scanLocked ? undefined : ({ data }) => props.onScan(data)
            }
          />
          <View
            pointerEvents="none"
            style={[
              styles.scanGuide,
              {
                borderColor: theme.colors.accent,
                borderRadius: theme.metrics.radius.panel,
              },
            ]}
          />
        </View>
      ) : (
        <View
          style={[
            styles.cameraSurface,
            styles.permission,
            {
              backgroundColor: theme.colors.layer01,
              borderRadius: theme.metrics.radius.panel,
              gap: theme.metrics.space.contentGap,
              padding: theme.metrics.space.panelPad,
            },
          ]}
        >
          <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
            Camera access is required
          </BodyText>
          <DetailText style={styles.centerText}>
            Honk only uses the camera to scan a connection code.
          </DetailText>
          <ActionButton
            label={props.permission?.canAskAgain === true ? "Allow camera" : "Open Settings"}
            onPress={() => {
              if (props.permission?.canAskAgain !== true) {
                void Linking.openSettings();
                return;
              }
              props.onRequestPermission();
            }}
          />
        </View>
      )}

      {props.busy ? (
        <DetailText accessibilityLiveRegion="polite" style={styles.centerText}>
          Checking code…
        </DetailText>
      ) : null}
      {props.scanLocked && !props.busy ? (
        <ActionButton label="Scan again" onPress={props.onScanAgain} />
      ) : null}
      <ActionButton label="Enter details manually" tone="neutral" onPress={props.onManual} />
    </View>
  );
}

export function ConnectScreen(): React.ReactElement {
  const theme = useHonkTheme();
  const pathname = usePathname();
  const params = useLocalSearchParams<ConnectionRouteParams>();
  const connectionLinks = useConnectionLinkIntake();
  const routeConnectionLink = connectionLinkFromRoute(pathname, params);
  const remote = useRemote();
  const [permission, requestPermission] = useCameraPermissions();
  const [mode, setMode] = React.useState<"scan" | "manual">("scan");
  const [form, setForm] = React.useState(() => initialConnectionForm(params, remote.activeServer));
  const [pairing, setPairing] = React.useState<PendingPairing | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [openingLink, setOpeningLink] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [replacementBlocked, setReplacementBlocked] = React.useState(false);
  const [retryPairing, setRetryPairing] = React.useState<PairingRetry | null>(null);
  const [cameraEntryEnabled, setCameraEntryEnabled] = React.useState(false);
  const previewGeneration = React.useRef(0);
  const previewController = React.useRef<AbortController | null>(null);
  const formOrigin = React.useRef(form.origin);
  formOrigin.current = form.origin;
  const scanLocked = React.useRef(false);
  const cameraRequestStarted = React.useRef(false);
  const pairingRequestId = React.useRef<string | null>(null);
  const screenAction = React.useRef(0);
  const scannerEntryInitialized = React.useRef(false);
  const claimedConnectionLink = React.useRef<number | null>(null);

  const preparePairing = React.useCallback(
    (value: string, fallbackOrigin: string, source: PairingRetry["source"]): Promise<boolean> => {
      previewController.current?.abort(new Error("This connection preview was superseded."));
      const controller = new AbortController();
      previewController.current = controller;
      const generation = ++previewGeneration.current;
      setBusy(true);
      setOpeningLink(source === "link");
      setLocalError(null);
      setReplacementBlocked(false);
      setRetryPairing(null);
      return loadPendingPairing(value, fallbackOrigin, source, controller)
        .then((next) => {
          if (generation !== previewGeneration.current) return false;
          setPairing(next);
          scanLocked.current = true;
          return true;
        })
        .catch((cause: unknown) => {
          if (generation !== previewGeneration.current) return false;
          setLocalError(
            cause instanceof Error ? cause.message : "The connection code could not be checked.",
          );
          setRetryPairing({
            value,
            fallbackOrigin,
            source,
            retryable: cause instanceof HonkPairingRequestError && cause.kind === "retryable",
          });
          return false;
        })
        .finally(() => {
          if (previewController.current === controller) previewController.current = null;
          if (generation === previewGeneration.current) {
            setBusy(false);
            setOpeningLink(false);
          }
        });
    },
    [],
  );

  React.useEffect(() => {
    if (routeConnectionLink === null) return;
    setCameraEntryEnabled(false);
    connectionLinks.receive(routeConnectionLink, formOrigin.current);
  }, [connectionLinks.receive, routeConnectionLink]);

  React.useEffect(() => {
    const incoming = connectionLinks.pending;
    if (
      incoming === null ||
      remote.status === "restoring" ||
      remote.pendingPairing !== null ||
      claimedConnectionLink.current === incoming.deliveryID
    ) {
      return;
    }
    claimedConnectionLink.current = incoming.deliveryID;
    connectionLinks.claim(incoming.deliveryID);
    setCameraEntryEnabled(false);
    void preparePairing(incoming.value, incoming.fallbackOrigin, "link");
  }, [
    connectionLinks.claim,
    connectionLinks.pending,
    preparePairing,
    remote.pendingPairing,
    remote.status,
  ]);

  React.useEffect(() => {
    return () => {
      previewGeneration.current += 1;
      previewController.current?.abort(new Error("Honk stopped checking this connection code."));
    };
  }, []);

  React.useEffect(() => {
    if (
      scannerEntryInitialized.current ||
      !connectionLinks.ready ||
      connectionLinks.pending !== null ||
      remote.status === "restoring" ||
      remote.pendingPairing !== null ||
      openingLink ||
      pairing !== null ||
      retryPairing?.source === "link"
    ) {
      return;
    }
    scannerEntryInitialized.current = true;
    setCameraEntryEnabled(true);
  }, [
    connectionLinks.pending,
    connectionLinks.ready,
    openingLink,
    pairing,
    remote.pendingPairing,
    remote.status,
    retryPairing?.source,
  ]);

  React.useEffect(() => {
    if (remote.pendingPairing !== null) {
      pairingRequestId.current = remote.pendingPairing.requestId;
      return;
    }
    const outcome = remote.pairingOutcome;
    if (outcome === null || pairingRequestId.current !== outcome.requestId) return;
    pairingRequestId.current = null;
    remote.acknowledgePairingOutcome(outcome.requestId);
    if (outcome.result === "connected") {
      router.replace("/");
      return;
    }
    if (outcome.result !== "removed") return;
    scanLocked.current = false;
    setPairing(null);
    setRetryPairing(null);
    setMode("scan");
    setCameraEntryEnabled(true);
  }, [remote.acknowledgePairingOutcome, remote.pairingOutcome, remote.pendingPairing]);

  React.useEffect(() => {
    if (
      !cameraEntryEnabled ||
      !connectionLinks.ready ||
      connectionLinks.pending !== null ||
      mode !== "scan" ||
      pairing !== null ||
      busy ||
      permission === null ||
      permission.granted ||
      !permission.canAskAgain ||
      cameraRequestStarted.current
    ) {
      return;
    }
    cameraRequestStarted.current = true;
    void requestPermission();
  }, [
    busy,
    cameraEntryEnabled,
    connectionLinks.pending,
    connectionLinks.ready,
    mode,
    pairing,
    permission,
    requestPermission,
  ]);

  // The durable pending request wins over a local preview: Finish acts on the staged
  // request, so the confirmation must never describe a different scan of the same computer.
  const confirmation =
    remote.pendingPairing ??
    (pairing === null
      ? null
      : {
          origin: pairing.origin,
          rebindOrigin:
            pairing.preview.serverId === null
              ? null
              : (remote.servers.find(
                  (server) =>
                    server.serverId === pairing.preview.serverId &&
                    server.descriptor.key !== openCodeServerKey(pairing.origin),
                )?.descriptor.origin ?? null),
          computerName: pairing.preview.name,
        });
  const existing =
    confirmation === null
      ? null
      : (remote.servers.find((server) => server.descriptor.origin === confirmation.origin) ?? null);
  const finishingPairing =
    confirmation !== null &&
    remote.pendingPairing?.origin === confirmation.origin &&
    remote.pendingPairing.status !== "removing";
  const requestingPairing =
    confirmation !== null &&
    remote.pendingPairing?.origin === confirmation.origin &&
    remote.pendingPairing.status === "requesting";
  const removingPairing =
    confirmation !== null &&
    remote.pendingPairing?.origin === confirmation.origin &&
    remote.pendingPairing.status === "removing";
  const rebindConfirmationOrigin = confirmation?.rebindOrigin ?? null;
  const savedAccessUnavailable = existing?.status === "unauthorized";
  const requiresSavedAccessRemoval = replacementBlocked || savedAccessUnavailable;

  const connectPairing = (replace: boolean): Promise<void> => {
    if (!finishingPairing && pairing === null) return Promise.resolve();
    const attempt = ++screenAction.current;
    setBusy(true);
    setLocalError(null);
    const requestId = remote.pendingPairing?.requestId ?? randomUUID();
    pairingRequestId.current = requestId;
    const action = finishingPairing
      ? remote.retryPendingPairing()
      : pairing === null
        ? Promise.reject(new Error("Scan a connection code before continuing."))
        : remote.pair({
            origin: pairing.origin,
            serverId: pairing.preview.serverId,
            token: pairing.token,
            requestId,
            serverLabel: pairing.preview.name,
            deviceLabel: AUTOMATIC_DEVICE_LABEL,
            defaultDirectory: form.defaultDirectory,
            replace,
          });
    return action
      .catch((cause: unknown) => {
        if (screenAction.current !== attempt) return;
        setLocalError(
          cause instanceof Error ? cause.message : "This connection could not be finished.",
        );
        if (cause instanceof HonkPairingRequestError && cause.kind === "existing-access-invalid") {
          setReplacementBlocked(true);
          return;
        }
        if (
          pairing !== null &&
          ((cause instanceof HonkPairingRequestError && cause.kind === "invalid") ||
            cause instanceof PairingPersistenceError)
        ) {
          setRetryPairing({
            value: pairing.value,
            fallbackOrigin: pairing.fallbackOrigin,
            source: pairing.source,
            retryable: cause instanceof PairingPersistenceError ? cause.codeReusable : false,
          });
          setPairing(null);
          if (pairing.source === "link") setCameraEntryEnabled(false);
          if (pairing.source === "scan") setCameraEntryEnabled(true);
        }
      })
      .finally(() => {
        if (screenAction.current === attempt) setBusy(false);
      });
  };

  const submitManual = (): Promise<void> => {
    const attempt = ++screenAction.current;
    setBusy(true);
    setLocalError(null);
    return Promise.resolve()
      .then(() => {
        const candidate = parseOpenCodeConnection(form.connectionValue, form.origin);
        if (candidate === null) {
          throw new Error("Enter a computer password or connection link.");
        }
        if (candidate.credential.type === "pairing") {
          return preparePairing(form.connectionValue, form.origin, "manual").then(() => undefined);
        }
        return remote
          .connect({
            origin: normalizeRemoteOrigin(candidate.origin),
            password: candidate.credential.value,
            defaultDirectory: form.defaultDirectory,
          })
          .then(() => router.replace("/"));
      })
      .catch((cause: unknown) => {
        if (screenAction.current !== attempt) return;
        setLocalError(cause instanceof Error ? cause.message : "The connection failed.");
      })
      .finally(() => {
        if (screenAction.current === attempt) setBusy(false);
      });
  };

  const pending =
    busy ||
    !connectionLinks.ready ||
    connectionLinks.pending !== null ||
    remote.status === "connecting" ||
    remote.status === "restoring";
  const checkingConnectionLink = connectionLinks.pending !== null && remote.status === "restoring";

  return (
    <Page>
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              gap: theme.metrics.space.sectionGap,
              padding: theme.metrics.space.screenGutter,
            },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
        >
          {confirmation !== null ? (
            <View style={[styles.confirmation, { gap: theme.metrics.space.sectionGap }]}>
              <View style={{ gap: theme.metrics.space.contentGap }}>
                <BodyText
                  accessibilityRole="header"
                  style={{
                    fontSize: theme.metrics.font.titleSize,
                    fontWeight: theme.metrics.font.weightSemibold,
                    lineHeight: theme.metrics.font.titleLeading,
                    textAlign: "center",
                  }}
                >
                  {removingPairing
                    ? `Finish removing access to ${confirmation.computerName}`
                    : finishingPairing
                      ? `Finish connecting to ${confirmation.computerName}`
                      : requiresSavedAccessRemoval
                        ? `Saved access to ${confirmation.computerName} no longer works`
                        : existing === null
                          ? `Connect to ${confirmation.computerName}?`
                          : `Already connected to ${confirmation.computerName}`}
                </BodyText>
                <DetailText style={styles.centerText} selectable>
                  {confirmation.origin}
                </DetailText>
                {rebindConfirmationOrigin !== null && !removingPairing ? (
                  <DetailText style={styles.centerText}>
                    {`This looks like the computer you already saved at ${rebindConfirmationOrigin}, so connecting here will replace that saved address.`}
                  </DetailText>
                ) : null}
                <DetailText style={styles.centerText}>
                  {removingPairing
                    ? "Honk saved this step. Finish removing this connection before scanning a new code."
                    : requestingPairing
                      ? "Honk saved this connection request. Finish connecting, or start over to cancel it."
                      : finishingPairing
                        ? "The new access is saved on this device. Finish connecting, or start over to remove it and use a new code."
                        : replacementBlocked
                          ? "Remove the saved connection on this device, then use this code to connect again. The code has not been used."
                          : savedAccessUnavailable
                            ? "First remove this device under Connections on the computer. Then remove the saved connection here and use this code again."
                            : existing === null
                              ? "Honk will save access on this device. You can remove it from the computer later."
                              : "Open the saved connection, or replace its access with this code."}
                </DetailText>
              </View>
              {removingPairing ? (
                <ActionButton
                  label="Finish removing access"
                  pending={pending}
                  onPress={() => {
                    const attempt = ++screenAction.current;
                    pairingRequestId.current = remote.pendingPairing?.requestId ?? null;
                    setBusy(true);
                    setLocalError(null);
                    void remote
                      .retryPendingPairing()
                      .catch((cause: unknown) => {
                        if (screenAction.current !== attempt) return;
                        setLocalError(
                          cause instanceof Error
                            ? cause.message
                            : "The connection could not be removed.",
                        );
                      })
                      .finally(() => {
                        if (screenAction.current === attempt) setBusy(false);
                      });
                  }}
                />
              ) : requiresSavedAccessRemoval && existing !== null ? (
                <ActionButton
                  label="Remove saved connection"
                  pending={pending}
                  onPress={() => {
                    setBusy(true);
                    void remote
                      .disconnect(existing.descriptor.key)
                      .then(() => {
                        setReplacementBlocked(false);
                        setLocalError(null);
                      })
                      .catch((cause: unknown) => {
                        setLocalError(
                          cause instanceof Error
                            ? cause.message
                            : "The saved connection could not be removed.",
                        );
                      })
                      .finally(() => setBusy(false));
                  }}
                />
              ) : finishingPairing ? (
                <>
                  <ActionButton
                    label="Finish connecting"
                    pending={pending}
                    onPress={() => void connectPairing(existing !== null)}
                  />
                  <ActionButton
                    label="Start over"
                    tone="neutral"
                    disabled={pending}
                    onPress={() => {
                      const attempt = ++screenAction.current;
                      pairingRequestId.current = remote.pendingPairing?.requestId ?? null;
                      setBusy(true);
                      setLocalError(null);
                      void remote
                        .cancelPendingPairing()
                        .catch((cause: unknown) => {
                          if (screenAction.current !== attempt) return;
                          setLocalError(
                            cause instanceof Error
                              ? cause.message
                              : "The unfinished access could not be removed.",
                          );
                        })
                        .finally(() => {
                          if (screenAction.current === attempt) setBusy(false);
                        });
                    }}
                  />
                </>
              ) : existing === null ? (
                <ActionButton
                  label="Connect"
                  pending={pending}
                  onPress={() => void connectPairing(false)}
                />
              ) : (
                <>
                  <ActionButton
                    label="Open existing connection"
                    onPress={() => {
                      remote.selectServer(existing.descriptor.key);
                      router.replace("/");
                    }}
                  />
                  <ActionButton
                    label="Replace access"
                    tone="neutral"
                    pending={pending}
                    onPress={() => void connectPairing(true)}
                  />
                </>
              )}
              {!finishingPairing && !removingPairing ? (
                <ActionButton
                  label="Cancel"
                  tone="neutral"
                  onPress={() => {
                    scanLocked.current = false;
                    setPairing(null);
                    setLocalError(null);
                    setReplacementBlocked(false);
                    setRetryPairing(null);
                    setCameraEntryEnabled(true);
                  }}
                />
              ) : null}
            </View>
          ) : !connectionLinks.ready ? (
            <View style={{ gap: theme.metrics.space.sectionGap }}>
              <View style={{ gap: theme.metrics.space.contentGap }}>
                <BodyText
                  accessibilityRole="header"
                  style={{
                    fontSize: theme.metrics.font.titleSize,
                    fontWeight: theme.metrics.font.weightSemibold,
                    lineHeight: theme.metrics.font.titleLeading,
                    textAlign: "center",
                  }}
                >
                  Getting Honk ready
                </BodyText>
                <DetailText style={styles.centerText}>
                  Honk is checking how you opened this screen.
                </DetailText>
              </View>
              <View
                style={[
                  styles.cameraSurface,
                  styles.permission,
                  {
                    backgroundColor: theme.colors.layer01,
                    borderRadius: theme.metrics.radius.panel,
                    padding: theme.metrics.space.panelPad,
                  },
                ]}
              >
                <DetailText accessibilityLiveRegion="polite">Preparing…</DetailText>
              </View>
            </View>
          ) : openingLink ||
            checkingConnectionLink ||
            (retryPairing?.source === "link" && !cameraEntryEnabled) ? (
            <View style={{ gap: theme.metrics.space.sectionGap }}>
              <View style={{ gap: theme.metrics.space.contentGap }}>
                <BodyText
                  accessibilityRole="header"
                  style={{
                    fontSize: theme.metrics.font.titleSize,
                    fontWeight: theme.metrics.font.weightSemibold,
                    lineHeight: theme.metrics.font.titleLeading,
                    textAlign: "center",
                  }}
                >
                  {openingLink || checkingConnectionLink
                    ? "Checking this computer"
                    : "Couldn’t open this connection link"}
                </BodyText>
                <DetailText style={styles.centerText}>
                  {openingLink || checkingConnectionLink
                    ? "Honk is checking the computer name and address before you choose."
                    : "Try the link again, or scan a new code from the computer."}
                </DetailText>
              </View>
              <View
                style={[
                  styles.cameraSurface,
                  styles.permission,
                  {
                    backgroundColor: theme.colors.layer01,
                    borderRadius: theme.metrics.radius.panel,
                    gap: theme.metrics.space.contentGap,
                    padding: theme.metrics.space.panelPad,
                  },
                ]}
              >
                <DetailText
                  accessibilityLiveRegion="polite"
                  selectable={!openingLink && !checkingConnectionLink}
                  style={[
                    styles.centerText,
                    openingLink || checkingConnectionLink ? null : { color: theme.colors.errFg },
                  ]}
                >
                  {openingLink || checkingConnectionLink ? "Checking connection…" : localError}
                </DetailText>
              </View>
              {!openingLink && !checkingConnectionLink && retryPairing !== null ? (
                <ActionButton
                  label={retryPairing.retryable ? "Try link again" : "Scan a new code"}
                  onPress={() => {
                    if (retryPairing.retryable) {
                      void preparePairing(retryPairing.value, retryPairing.fallbackOrigin, "link");
                      return;
                    }
                    scanLocked.current = false;
                    setMode("scan");
                    setRetryPairing(null);
                    setLocalError(null);
                    setCameraEntryEnabled(true);
                  }}
                />
              ) : null}
              {!openingLink && !checkingConnectionLink ? (
                <ActionButton
                  label="Enter details manually"
                  tone="neutral"
                  onPress={() => {
                    setMode("manual");
                    setRetryPairing(null);
                    setLocalError(null);
                    setCameraEntryEnabled(false);
                  }}
                />
              ) : null}
            </View>
          ) : mode === "scan" ? (
            <PairingScanner
              permission={permission}
              busy={busy}
              pending={pending}
              scanLocked={scanLocked.current}
              onRequestPermission={() => void requestPermission()}
              onScan={(value) => {
                if (scanLocked.current) return;
                scanLocked.current = true;
                void preparePairing(value, "", "scan");
              }}
              onScanAgain={() => {
                scanLocked.current = false;
                setLocalError(null);
                setRetryPairing(null);
              }}
              onManual={() => {
                setMode("manual");
                setLocalError(null);
                setRetryPairing(null);
              }}
            />
          ) : (
            <View style={{ gap: theme.metrics.space.sectionGap }}>
              <View style={{ gap: theme.metrics.space.contentGap }}>
                <BodyText
                  accessibilityRole="header"
                  style={{
                    fontSize: theme.metrics.font.titleSize,
                    fontWeight: theme.metrics.font.weightSemibold,
                    lineHeight: theme.metrics.font.titleLeading,
                  }}
                >
                  Enter connection details
                </BodyText>
                <DetailText>
                  Use this fallback when you cannot scan or open a connection link.
                </DetailText>
              </View>
              <View style={{ gap: theme.metrics.space.rowGap }}>
                <TextField
                  autoCapitalize="none"
                  autoComplete="url"
                  autoCorrect={false}
                  inputMode="url"
                  label="Computer address"
                  onChangeText={(origin) => setForm((current) => ({ ...current, origin }))}
                  placeholder="https://honk.example.com"
                  value={form.origin}
                />
                <TextField
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  label="Connection link or computer password"
                  onChangeText={(connectionValue) =>
                    setForm((current) => ({ ...current, connectionValue }))
                  }
                  placeholder="Paste a connection link or password"
                  secureTextEntry
                  value={form.connectionValue}
                />
                <TextField
                  autoCapitalize="none"
                  autoCorrect={false}
                  label="Default project folder (optional)"
                  onChangeText={(defaultDirectory) =>
                    setForm((current) => ({ ...current, defaultDirectory }))
                  }
                  placeholder="/Users/you/Developer/project"
                  value={form.defaultDirectory}
                />
                <ActionButton
                  label="Connect"
                  onPress={() => void submitManual()}
                  pending={pending}
                />
                <ActionButton
                  label="Scan QR code"
                  tone="neutral"
                  onPress={() => {
                    scanLocked.current = false;
                    setMode("scan");
                    setLocalError(null);
                    setRetryPairing(null);
                    setCameraEntryEnabled(true);
                  }}
                />
              </View>
            </View>
          )}

          {(retryPairing?.source !== "link" || cameraEntryEnabled) &&
          (localError ?? remote.error) ? (
            <DetailText
              accessibilityLiveRegion="polite"
              selectable
              style={{ color: theme.colors.errFg }}
            >
              {localError ?? remote.error}
            </DetailText>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  content: {
    alignSelf: "center",
    flexGrow: 1,
    justifyContent: "center",
    maxWidth: 520,
    width: "100%",
  },
  cameraSurface: {
    alignSelf: "center",
    aspectRatio: 1,
    maxWidth: 440,
    width: "100%",
  },
  cameraFrame: {
    borderWidth: 1,
    overflow: "hidden",
  },
  camera: {
    flex: 1,
  },
  permission: {
    alignItems: "center",
    justifyContent: "center",
  },
  scanGuide: {
    borderWidth: 3,
    bottom: "18%",
    left: "18%",
    position: "absolute",
    right: "18%",
    top: "18%",
  },
  confirmation: {
    alignItems: "stretch",
  },
  centerText: {
    textAlign: "center",
  },
});
