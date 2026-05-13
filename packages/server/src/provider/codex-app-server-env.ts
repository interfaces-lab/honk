const CODEX_APP_SERVER_GIT_CONFIG_ENTRIES = [
  ["core.fsmonitor", "false"],
  ["core.untrackedCache", "false"],
] as const;

const GIT_CONFIG_ENV_KEY_PATTERN = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/;

type GitConfigEnvEntry = readonly [key: string, value: string];

function readExistingGitConfigEnvEntries(env: NodeJS.ProcessEnv): GitConfigEnvEntry[] {
  const count = Number.parseInt(env.GIT_CONFIG_COUNT ?? "", 10);
  if (!Number.isSafeInteger(count) || count < 0) {
    return [];
  }

  const entries: GitConfigEnvEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = env[`GIT_CONFIG_KEY_${index}`];
    const value = env[`GIT_CONFIG_VALUE_${index}`];
    if (!key || value === undefined) {
      continue;
    }
    entries.push([key, value]);
  }
  return entries;
}

function clearGitConfigEnvEntries(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (GIT_CONFIG_ENV_KEY_PATTERN.test(key)) {
      delete env[key];
    }
  }
}

export function buildCodexAppServerEnv(input?: {
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly codexHome?: string;
}): NodeJS.ProcessEnv {
  const baseEnv = input?.baseEnv ?? process.env;
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const gitConfigEntries = [
    ...readExistingGitConfigEnvEntries(baseEnv),
    ...CODEX_APP_SERVER_GIT_CONFIG_ENTRIES,
  ];

  clearGitConfigEnvEntries(env);
  env.GIT_CONFIG_COUNT = String(gitConfigEntries.length);
  gitConfigEntries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });

  env.GIT_OPTIONAL_LOCKS = "0";
  if (input?.codexHome) {
    env.CODEX_HOME = input.codexHome;
  }

  return env;
}
