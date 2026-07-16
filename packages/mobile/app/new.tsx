import * as React from "react";
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from "react-native";
import * as Crypto from "expo-crypto";
import { Redirect, Stack, router } from "expo-router";
import {
  OPEN_CODE_LOCAL_SESSION_TARGET,
  OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET,
  createOpenCodeTargetedSession,
  openCodeLocationRef,
  openCodeMessageID,
  openCodeSessionRef,
  openCodeWorkspaceSessionTarget,
  sameOpenCodeLocation,
  type OpenCodeAgentInfo,
  type OpenCodeLocationInfo,
  type OpenCodeLocationRef,
  type OpenCodeModelInfo,
  type OpenCodeSessionTarget,
} from "@honk/opencode";
import { Picker } from "@honk/ui";
import { TextField } from "@honk/ui/text-field";

import { useRemote, type RemoteSession } from "../src/remote-context";
import { ActionButton, BodyText, DetailText, Page, useHonkTheme } from "../src/ui";

const defaultModel = (models: readonly OpenCodeModelInfo[]): OpenCodeModelInfo | null =>
  models.find((model) => model.status === "active") ?? models[0] ?? null;

type LoadedProject = {
  readonly key: string;
  readonly location: OpenCodeLocationInfo | null;
  readonly branch: string | null;
};

function sourceKey(server: string | null, directory: string): string {
  return JSON.stringify([server, directory.trim()]);
}

function locationKey(location: OpenCodeLocationRef): string {
  return JSON.stringify([location.directory, location.workspaceID ?? null]);
}

function targetValue(target: OpenCodeSessionTarget): string {
  if (target.type !== "workspace") return target.type;
  return `workspace:${locationKey(target.location)}`;
}

function targetLabel(target: OpenCodeSessionTarget): string {
  if (target.type === "local") return "Local repository";
  if (target.type === "new-workspace") return "New workspace";
  return (
    target.location.directory
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? "Workspace"
  );
}

function projectWorkspaces(input: {
  readonly project: OpenCodeLocationInfo | null;
  readonly serverKey: string | null;
  readonly sessions: readonly RemoteSession[];
  readonly target: OpenCodeSessionTarget;
}): readonly OpenCodeLocationRef[] {
  if (input.project === null || input.serverKey === null) return [];
  const root = openCodeLocationRef({ directory: input.project.project.directory });
  const seen = new Set<string>();
  const result: OpenCodeLocationRef[] = [];
  const add = (location: OpenCodeLocationRef): void => {
    if (sameOpenCodeLocation(location, root)) return;
    const key = locationKey(location);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(openCodeLocationRef(location));
  };
  for (const session of input.sessions) {
    if (
      session.server.key !== input.serverKey ||
      session.info.projectID !== input.project.project.id
    ) {
      continue;
    }
    add(session.info.location);
  }
  if (input.target.type === "workspace") add(input.target.location);
  return result;
}

export default function NewTaskRoute(): React.ReactElement {
  const theme = useHonkTheme();
  const remote = useRemote();
  const client = remote.client;
  const serverKey = remote.activeServerKey;
  const configuredDirectory = remote.activeServer?.defaultDirectory ?? "";
  const [prompt, setPrompt] = React.useState("");
  const [cwd, setCwd] = React.useState(configuredDirectory);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [models, setModels] = React.useState<readonly OpenCodeModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = React.useState(true);
  const [agents, setAgents] = React.useState<readonly OpenCodeAgentInfo[]>([]);
  const [agent, setAgent] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<OpenCodeModelInfo | null>(null);
  const [variant, setVariant] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<OpenCodeSessionTarget>(OPEN_CODE_LOCAL_SESSION_TARGET);
  const [loadedProject, setLoadedProject] = React.useState<LoadedProject | null>(null);

  React.useEffect(() => {
    let active = true;
    if (client === null) return;
    const requested = configuredDirectory.trim();
    void (async () => {
      const directory = requested === "" ? (await client.resolveLocation()).directory : requested;
      const [modelsResult, agentsResult] = await Promise.all([
        client.models.list({ directory }),
        client.agents.list({ directory }),
      ]);
      return { directory, nextAgents: agentsResult.data, nextModels: modelsResult.data };
    })()
      .then(({ directory, nextAgents, nextModels }) => {
        if (!active) return;
        const enabledModels = nextModels.filter((candidate) => candidate.enabled);
        const selected = defaultModel(enabledModels);
        const primaryAgents = nextAgents.filter(
          (candidate) => candidate.mode !== "subagent" && !candidate.hidden,
        );
        setModels(enabledModels);
        setModelsLoading(false);
        setAgents(primaryAgents);
        setAgent(
          primaryAgents.find((candidate) => candidate.id === "build")?.id ??
            primaryAgents[0]?.id ??
            null,
        );
        setModel(selected);
        setVariant(selected?.variants[0]?.id ?? null);
        if (requested === "") setCwd(directory);
      })
      .catch((cause: unknown) => {
        if (active) {
          setModelsLoading(false);
          setError(cause instanceof Error ? cause.message : "Models could not be loaded.");
        }
      });
    return () => {
      active = false;
    };
  }, [client, configuredDirectory]);

  const currentSourceKey = sourceKey(serverKey, cwd);
  React.useEffect(() => {
    const directory = cwd.trim();
    if (client === null || directory === "") return;
    let active = true;
    const timeout = setTimeout(() => {
      void Promise.all([
        client.resolveLocation({ directory }),
        client.vcs.info({ directory }).catch(() => ({ branch: undefined })),
      ])
        .then(([location, vcs]) => {
          if (active) {
            setLoadedProject({
              key: currentSourceKey,
              location,
              branch: vcs.branch ?? null,
            });
          }
        })
        .catch(() => {
          if (active) {
            setLoadedProject({ key: currentSourceKey, location: null, branch: null });
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [client, currentSourceKey, cwd]);

  const chooseModel = (nextModel: OpenCodeModelInfo): void => {
    setModel(nextModel);
    setVariant(nextModel.variants[0]?.id ?? null);
  };

  const project = loadedProject?.key === currentSourceKey ? loadedProject.location : null;
  const workspaceEnabled = project !== null && project.project.id !== "global";
  const effectiveTarget = workspaceEnabled ? target : OPEN_CODE_LOCAL_SESSION_TARGET;
  const workspaces = projectWorkspaces({
    project,
    serverKey,
    sessions: remote.sessions,
    target: effectiveTarget,
  });

  if (client === null || serverKey === null) return <Redirect href="/connect" />;

  const create = async (): Promise<void> => {
    const normalizedCwd = cwd.trim();
    const normalizedPrompt = prompt.trim();
    if (normalizedCwd === "") {
      setError("Choose the project folder for this session.");
      return;
    }
    if (normalizedPrompt === "") {
      setError("Write the first message for this session.");
      return;
    }
    if (model === null) {
      setError("No models are available on this server.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await remote.setDefaultDirectory(serverKey, normalizedCwd);
      const session = await createOpenCodeTargetedSession(client, {
        source: openCodeLocationRef({ directory: normalizedCwd }),
        target: effectiveTarget,
        ...(agent !== null ? { agent } : {}),
        model: {
          id: model.id,
          providerID: model.providerID,
          ...(variant !== null ? { variant } : {}),
        },
      });
      const ref = openCodeSessionRef(serverKey, session.id);
      await client.sessions.prompt(ref, {
        id: openCodeMessageID(Crypto.randomUUID()),
        prompt: { text: normalizedPrompt },
        delivery: "queue",
      });
      await remote.refreshSessions(serverKey);
      router.replace({
        pathname: "/(tabs)/home/server/[serverKey]/session/[sessionId]",
        params: { serverKey: ref.server, sessionId: ref.sessionID },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The session could not be created.");
    }
    setPending(false);
  };

  return (
    <Page>
      <Stack.Screen options={{ title: "New session" }} />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              gap: theme.metrics.space.rowGap,
              padding: theme.metrics.space.screenGutter,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TextField
            autoCapitalize="sentences"
            autoFocus
            label="First message"
            minRows={3}
            multiline
            onChangeText={setPrompt}
            placeholder="What do you want to work on?"
            value={prompt}
          />
          <TextField
            autoCapitalize="none"
            autoCorrect={false}
            label="Project folder"
            onChangeText={(value) => {
              setCwd(value);
              setTarget(OPEN_CODE_LOCAL_SESSION_TARGET);
            }}
            placeholder="/Users/you/Developer/project"
            value={cwd}
          />

          {workspaceEnabled ? (
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>
                Run session in
              </BodyText>
              <Picker.Root
                value={targetValue(effectiveTarget)}
                onValueChange={(value) => {
                  if (value === "local") {
                    setTarget(OPEN_CODE_LOCAL_SESSION_TARGET);
                    return;
                  }
                  if (value === "new-workspace") {
                    setTarget(OPEN_CODE_NEW_WORKSPACE_SESSION_TARGET);
                    return;
                  }
                  const workspace = workspaces.find(
                    (candidate) => targetValue(openCodeWorkspaceSessionTarget(candidate)) === value,
                  );
                  if (workspace !== undefined) {
                    setTarget(openCodeWorkspaceSessionTarget(workspace));
                  }
                }}
              >
                <Picker.Trigger accessibilityLabel="Run session in">
                  <DetailText>{targetLabel(effectiveTarget)}</DetailText>
                </Picker.Trigger>
                <Picker.Popup label="Run session in">
                  <Picker.Group>
                    <Picker.GroupLabel>Run session in</Picker.GroupLabel>
                    <Picker.Option
                      value="local"
                      label="Local repository"
                      description={project.project.directory}
                    />
                    <Picker.Option
                      value="new-workspace"
                      label="New workspace"
                      description={`Create a git worktree on ${remote.activeServer?.descriptor.label ?? "this server"}.`}
                    />
                  </Picker.Group>
                  {workspaces.length === 0 ? null : (
                    <Picker.Group>
                      <Picker.GroupLabel>Workspaces</Picker.GroupLabel>
                      {workspaces.map((workspace) => (
                        <Picker.Option
                          key={locationKey(workspace)}
                          value={targetValue(openCodeWorkspaceSessionTarget(workspace))}
                          label={targetLabel(openCodeWorkspaceSessionTarget(workspace))}
                          description={workspace.directory}
                        />
                      ))}
                    </Picker.Group>
                  )}
                </Picker.Popup>
              </Picker.Root>
              {loadedProject?.key === currentSourceKey && loadedProject.branch !== null ? (
                <DetailText>{loadedProject.branch}</DetailText>
              ) : null}
            </View>
          ) : null}

          {agents.length === 0 ? null : (
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Agent</BodyText>
              <Picker.Root value={agent ?? ""} onValueChange={setAgent}>
                <Picker.Trigger accessibilityLabel="Agent">
                  <DetailText>{agent ?? "Choose agent"}</DetailText>
                </Picker.Trigger>
                <Picker.Popup label="Agent">
                  {agents.map((candidate) => (
                    <Picker.Option key={candidate.id} value={candidate.id} label={candidate.id} />
                  ))}
                </Picker.Popup>
              </Picker.Root>
            </View>
          )}

          <View style={{ gap: theme.metrics.space.contentGap }}>
            <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Model</BodyText>
            {modelsLoading ? <DetailText>Loading models…</DetailText> : null}
            {!modelsLoading && models.length === 0 ? (
              <DetailText>No models are available on this server.</DetailText>
            ) : null}
            {models.length === 0 ? null : (
              <Picker.Root
                value={model === null ? "" : `${model.providerID}/${model.id}`}
                onValueChange={(value) => {
                  const selected = models.find(
                    (candidate) => `${candidate.providerID}/${candidate.id}` === value,
                  );
                  if (selected !== undefined) chooseModel(selected);
                }}
              >
                <Picker.Trigger accessibilityLabel="Model">
                  <DetailText>{model?.name ?? "Choose model"}</DetailText>
                </Picker.Trigger>
                <Picker.Popup label="Model">
                  {models.map((candidate) => (
                    <Picker.Option
                      key={`${candidate.providerID}/${candidate.id}`}
                      value={`${candidate.providerID}/${candidate.id}`}
                      label={candidate.name}
                      description={candidate.family ?? candidate.id}
                      metadata={candidate.providerID}
                    />
                  ))}
                </Picker.Popup>
              </Picker.Root>
            )}
          </View>

          {model === null || model.variants.length === 0 ? null : (
            <View style={{ gap: theme.metrics.space.contentGap }}>
              <BodyText style={{ fontWeight: theme.metrics.font.weightSemibold }}>Variant</BodyText>
              <Picker.Root value={variant ?? ""} onValueChange={setVariant}>
                <Picker.Trigger accessibilityLabel="Variant">
                  <DetailText>{variant ?? "Choose variant"}</DetailText>
                </Picker.Trigger>
                <Picker.Popup label="Variant">
                  {model.variants.map((candidate) => (
                    <Picker.Option key={candidate.id} value={candidate.id} label={candidate.id} />
                  ))}
                </Picker.Popup>
              </Picker.Root>
            </View>
          )}

          {error === null ? null : (
            <DetailText accessibilityLiveRegion="polite" style={{ color: theme.colors.errFg }}>
              {error}
            </DetailText>
          )}
          <View style={styles.action}>
            <ActionButton
              disabled={model === null || prompt.trim() === ""}
              label="Start session"
              onPress={() => void create()}
              pending={pending}
            />
          </View>
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
    flexGrow: 1,
  },
  action: {
    alignItems: "flex-end",
  },
});
