import { watch, type FSWatcher } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Option, Schema } from "effect";
import { TrimmedNonEmptyString } from "@honk/shared/base-schemas";
import {
  KeybindingsConfigError,
  KeybindingRule,
  type KeybindingShortcut,
  type KeybindingWhenNode,
  MAX_KEYBINDINGS_COUNT,
  MAX_WHEN_EXPRESSION_DEPTH,
  THREAD_JUMP_KEYBINDING_COMMANDS,
  type ResolvedKeybindingRule,
  type ResolvedKeybindingsConfig,
} from "@honk/shared/keybindings";
import { ModelSelection } from "@honk/shared/model";
import { fromLenientJson } from "@honk/shared/schema-json";
import type { ServerConfigIssue } from "@honk/shared/server-config";
import {
  applyServerSettingsPatch,
  DEFAULT_SERVER_SETTINGS,
  ServerSettingsError,
  ThreadEnvMode,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@honk/shared/server-settings";

const SETTINGS_WATCH_DEBOUNCE_MS = 100;
const KEYBINDINGS_WATCH_DEBOUNCE_MS = 100;
const KEYBINDINGS_WHEN_MAX_LENGTH = 256;

type SettingsListener = (settings: ServerSettings) => void;
type KeybindingsListener = (state: KeybindingsConfigState) => void;
type JsonRecord = Record<string, unknown>;

type WhenToken =
	| { readonly type: "identifier"; readonly value: string }
	| { readonly type: "not" }
	| { readonly type: "and" }
	| { readonly type: "or" }
	| { readonly type: "lparen" }
	| { readonly type: "rparen" };

export interface AuxSettingsPaths {
	readonly settingsPath: string;
	readonly keybindingsConfigPath: string;
}

export interface KeybindingsConfigState {
	readonly keybindings: ResolvedKeybindingsConfig;
	readonly issues: readonly ServerConfigIssue[];
}

export interface AuxSettingsSnapshot extends KeybindingsConfigState {
	readonly settings: ServerSettings;
	readonly settingsPath: string;
	readonly keybindingsConfigPath: string;
}

export const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
	{ key: "mod+shift+y", command: "threadTree.toggle", when: "!terminalFocus" },
	{ key: "mod+k", command: "commandPalette.toggle", when: "!terminalFocus" },
	{ key: "shift+tab", command: "composer.cycleInteractionMode", when: "!terminalFocus" },
	{ key: "enter", command: "composer.send", when: "composerFocus" },
	{ key: "mod+.", command: "composer.interrupt", when: "composerFocus" },
	{ key: "mod+n", command: "chat.new", when: "!terminalFocus" },
	{ key: "mod+shift+o", command: "chat.new", when: "!terminalFocus" },
	{ key: "mod+shift+n", command: "chat.newLocal", when: "!terminalFocus" },
	{ key: "escape", command: "route.back", when: "!terminalFocus" },
	{ key: "escape", command: "threadSelection.clear", when: "threadSelectionActive" },
	{ key: "mod+o", command: "editor.openFavorite" },
	{ key: "mod+s", command: "editor.saveFile", when: "editorFocus" },
	{ key: "mod+l", command: "editor.addSelectionToChat", when: "editorFocus && !terminalFocus" },
	{ key: "mod+shift+m", command: "editorPanel.toggleFullscreen", when: "!terminalFocus" },
	{ key: "mod+l", command: "browser.focusLocationBar", when: "browserActive && !terminalFocus" },
	{ key: "mod+j", command: "terminal.toggle" },
	{ key: "mod+d", command: "terminal.split", when: "terminalFocus" },
	{ key: "mod+n", command: "terminal.new", when: "terminalFocus" },
	{ key: "mod+w", command: "terminal.close", when: "terminalFocus" },
	{ key: "mod+shift+[", command: "thread.previous" },
	{ key: "mod+shift+]", command: "thread.next" },
	...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
		key: `mod+${index + 1}`,
		command,
	})),
];

const DEFAULT_RESOLVED_KEYBINDINGS = compileResolvedKeybindingsConfig(DEFAULT_KEYBINDINGS);

export function resolveAuxSettingsPaths(userDataDir: string): AuxSettingsPaths {
	return {
		settingsPath: path.join(userDataDir, "settings.json"),
		keybindingsConfigPath: path.join(userDataDir, "keybindings.json"),
	};
}

const decodeLenientJsonValue = Schema.decodeUnknownSync(fromLenientJson(Schema.Unknown));

export function parseLenientJson(raw: string): unknown {
	return decodeLenientJsonValue(raw);
}

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeUnknownRecord = Schema.decodeUnknownOption(UnknownRecord);
const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);
const decodeString = Schema.decodeUnknownOption(Schema.String);
const decodeThreadEnvMode = Schema.decodeUnknownOption(ThreadEnvMode);
const decodeUnknownArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown));
const decodeModelInstanceId = Schema.decodeUnknownOption(ModelSelection.fields.instanceId);
const decodeModelName = Schema.decodeUnknownOption(ModelSelection.fields.model);

// The shared ModelSelection schema rejects the whole selection when any option is
// malformed and trims option string values (rejecting empties). The persisted file is
// user-editable, and the original reader skipped bad option entries while keeping raw
// (untrimmed, possibly empty) string values, so options are decoded per element with a
// lenient local schema.
const LenientModelOptionSelection = Schema.Struct({
	id: TrimmedNonEmptyString,
	value: Schema.Union([Schema.String, Schema.Boolean]),
});
const decodeLenientModelOptionSelection = Schema.decodeUnknownOption(LenientModelOptionSelection);

const EMPTY_UNKNOWN_RECORD: { readonly [key: string]: unknown } = {};

function readModelSelection(value: unknown): ServerSettings["textGenerationModelSelection"] {
	const fallback = DEFAULT_SERVER_SETTINGS.textGenerationModelSelection;
	const record = decodeUnknownRecord(value);
	if (Option.isNone(record)) {
		return fallback;
	}
	const instanceId = decodeModelInstanceId(record.value.instanceId);
	const model = decodeModelName(record.value.model);
	if (Option.isNone(instanceId) || Option.isNone(model)) {
		return fallback;
	}
	const options: Array<{ id: string; value: string | boolean }> = [];
	const rawOptions = decodeUnknownArray(record.value.options);
	if (Option.isSome(rawOptions)) {
		for (const option of rawOptions.value) {
			const decoded = decodeLenientModelOptionSelection(option);
			if (Option.isSome(decoded)) {
				options.push(decoded.value);
			}
		}
	}
	return {
		instanceId: instanceId.value,
		model: model.value,
		...(options.length > 0 ? { options } : {}),
	};
}

// Per-field leniency is preserved: the shared ServerSettings schema fills defaults for
// missing keys but rejects the whole object on a single wrong-typed key, whereas each
// field here falls back to its own default independently. String fields keep raw
// (untrimmed) values to match the original reader.
function normalizeServerSettings(value: unknown): ServerSettings {
	const record = decodeUnknownRecord(value);
	if (Option.isNone(record)) {
		return DEFAULT_SERVER_SETTINGS;
	}
	const settings = record.value;
	const observability = Option.getOrElse(
		decodeUnknownRecord(settings.observability),
		() => EMPTY_UNKNOWN_RECORD,
	);
	return {
		enableAssistantStreaming: Option.getOrElse(
			decodeBoolean(settings.enableAssistantStreaming),
			() => DEFAULT_SERVER_SETTINGS.enableAssistantStreaming,
		),
		defaultThreadEnvMode: Option.getOrElse(
			decodeThreadEnvMode(settings.defaultThreadEnvMode),
			() => DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode,
		),
		addProjectBaseDirectory: Option.getOrElse(
			decodeString(settings.addProjectBaseDirectory),
			() => DEFAULT_SERVER_SETTINGS.addProjectBaseDirectory,
		),
		textGenerationModelSelection: readModelSelection(settings.textGenerationModelSelection),
		observability: {
			otlpTracesUrl: Option.getOrElse(
				decodeString(observability.otlpTracesUrl),
				() => DEFAULT_SERVER_SETTINGS.observability.otlpTracesUrl,
			),
			otlpMetricsUrl: Option.getOrElse(
				decodeString(observability.otlpMetricsUrl),
				() => DEFAULT_SERVER_SETTINGS.observability.otlpMetricsUrl,
			),
		},
	};
}

// A structural JSON diff against the defaults has no Schema-decoder equivalent, so it is
// expressed as explicit per-field comparisons over the fixed ServerSettings shape
// (textGenerationModelSelection compared as a whole via JSON, matching the original).
function stripDefaultServerSettings(next: ServerSettings): JsonRecord {
	const sparse: JsonRecord = {};
	if (next.enableAssistantStreaming !== DEFAULT_SERVER_SETTINGS.enableAssistantStreaming) {
		sparse.enableAssistantStreaming = next.enableAssistantStreaming;
	}
	if (next.defaultThreadEnvMode !== DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode) {
		sparse.defaultThreadEnvMode = next.defaultThreadEnvMode;
	}
	if (next.addProjectBaseDirectory !== DEFAULT_SERVER_SETTINGS.addProjectBaseDirectory) {
		sparse.addProjectBaseDirectory = next.addProjectBaseDirectory;
	}
	if (
		JSON.stringify(next.textGenerationModelSelection) !==
		JSON.stringify(DEFAULT_SERVER_SETTINGS.textGenerationModelSelection)
	) {
		sparse.textGenerationModelSelection = next.textGenerationModelSelection;
	}
	const observability: JsonRecord = {};
	if (next.observability.otlpTracesUrl !== DEFAULT_SERVER_SETTINGS.observability.otlpTracesUrl) {
		observability.otlpTracesUrl = next.observability.otlpTracesUrl;
	}
	if (next.observability.otlpMetricsUrl !== DEFAULT_SERVER_SETTINGS.observability.otlpMetricsUrl) {
		observability.otlpMetricsUrl = next.observability.otlpMetricsUrl;
	}
	if (Object.keys(observability).length > 0) {
		sparse.observability = observability;
	}
	return sparse;
}

function normalizeKeyToken(token: string): string {
	if (token === "space") {
		return " ";
	}
	if (token === "esc") {
		return "escape";
	}
	return token;
}

export function parseKeybindingShortcut(value: string): KeybindingShortcut | null {
	const rawTokens = value
		.toLowerCase()
		.split("+")
		.map((token) => token.trim());
	const tokens = [...rawTokens];
	let trailingEmptyCount = 0;
	while (tokens[tokens.length - 1] === "") {
		trailingEmptyCount += 1;
		tokens.pop();
	}
	if (trailingEmptyCount > 0) {
		tokens.push("+");
	}
	if (tokens.some((token) => token.length === 0) || tokens.length === 0) {
		return null;
	}

	let key: string | null = null;
	let metaKey = false;
	let ctrlKey = false;
	let shiftKey = false;
	let altKey = false;
	let modKey = false;

	for (const token of tokens) {
		switch (token) {
			case "cmd":
			case "meta":
				metaKey = true;
				break;
			case "ctrl":
			case "control":
				ctrlKey = true;
				break;
			case "shift":
				shiftKey = true;
				break;
			case "alt":
			case "option":
				altKey = true;
				break;
			case "mod":
				modKey = true;
				break;
			default:
				if (key !== null) {
					return null;
				}
				key = normalizeKeyToken(token);
				break;
		}
	}

	return key === null ? null : { key, metaKey, ctrlKey, shiftKey, altKey, modKey };
}

function tokenizeWhenExpression(expression: string): WhenToken[] | null {
	const tokens: WhenToken[] = [];
	let index = 0;
	while (index < expression.length) {
		const current = expression[index];
		if (!current) {
			break;
		}
		if (/\s/.test(current)) {
			index += 1;
			continue;
		}
		if (expression.startsWith("&&", index)) {
			tokens.push({ type: "and" });
			index += 2;
			continue;
		}
		if (expression.startsWith("||", index)) {
			tokens.push({ type: "or" });
			index += 2;
			continue;
		}
		if (current === "!") {
			tokens.push({ type: "not" });
			index += 1;
			continue;
		}
		if (current === "(") {
			tokens.push({ type: "lparen" });
			index += 1;
			continue;
		}
		if (current === ")") {
			tokens.push({ type: "rparen" });
			index += 1;
			continue;
		}
		const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(expression.slice(index));
		if (!identifier) {
			return null;
		}
		tokens.push({ type: "identifier", value: identifier[0] });
		index += identifier[0].length;
	}
	return tokens;
}

function parseKeybindingWhenExpression(expression: string): KeybindingWhenNode | null {
	const tokens = tokenizeWhenExpression(expression);
	if (!tokens || tokens.length === 0) {
		return null;
	}
	const parsedTokens = tokens;
	let index = 0;

	const parsePrimary = (depth: number): KeybindingWhenNode | null => {
		if (depth > MAX_WHEN_EXPRESSION_DEPTH) {
			return null;
		}
		const token = parsedTokens[index];
		if (!token) {
			return null;
		}
		if (token.type === "identifier") {
			index += 1;
			return { type: "identifier", name: token.value };
		}
		if (token.type !== "lparen") {
			return null;
		}
		index += 1;
		const expressionNode = parseOr(depth + 1);
		const closeToken = parsedTokens[index];
		if (!expressionNode || !closeToken || closeToken.type !== "rparen") {
			return null;
		}
		index += 1;
		return expressionNode;
	};

	const parseUnary = (depth: number): KeybindingWhenNode | null => {
		let notCount = 0;
		while (parsedTokens[index]?.type === "not") {
			index += 1;
			notCount += 1;
			if (notCount > MAX_WHEN_EXPRESSION_DEPTH) {
				return null;
			}
		}
		let node = parsePrimary(depth);
		if (!node) {
			return null;
		}
		while (notCount > 0) {
			node = { type: "not", node };
			notCount -= 1;
		}
		return node;
	};

	const parseAnd = (depth: number): KeybindingWhenNode | null => {
		let left = parseUnary(depth);
		if (!left) {
			return null;
		}
		while (parsedTokens[index]?.type === "and") {
			index += 1;
			const right = parseUnary(depth);
			if (!right) {
				return null;
			}
			left = { type: "and", left, right };
		}
		return left;
	};

	function parseOr(depth: number): KeybindingWhenNode | null {
		let left = parseAnd(depth);
		if (!left) {
			return null;
		}
		while (parsedTokens[index]?.type === "or") {
			index += 1;
			const right = parseAnd(depth);
			if (!right) {
				return null;
			}
			left = { type: "or", left, right };
		}
		return left;
	}

	const ast = parseOr(0);
	return ast && index === parsedTokens.length ? ast : null;
}

const KeybindingRuleInput = Schema.Struct({
	key: KeybindingRule.fields.key,
	command: KeybindingRule.fields.command,
	when: Schema.optionalKey(Schema.Unknown),
});
const decodeKeybindingRuleInput = Schema.decodeUnknownOption(KeybindingRuleInput);

// key and command are validated by the shared KeybindingRule field schemas. `when` keeps
// the original per-field leniency: a non-string value is dropped (the rule stays valid),
// while a present string must trim to 1..KEYBINDINGS_WHEN_MAX_LENGTH or the rule is rejected.
function normalizeKeybindingRule(value: unknown): KeybindingRule | null {
	const decoded = decodeKeybindingRuleInput(value);
	if (Option.isNone(decoded)) {
		return null;
	}
	const { key, command, when: rawWhen } = decoded.value;
	const when = typeof rawWhen === "string" ? rawWhen.trim() : undefined;
	if (when !== undefined && (when.length === 0 || when.length > KEYBINDINGS_WHEN_MAX_LENGTH)) {
		return null;
	}
	return {
		key,
		command,
		...(when !== undefined ? { when } : {}),
	};
}

export function compileResolvedKeybindingRule(rule: KeybindingRule): ResolvedKeybindingRule | null {
	const shortcut = parseKeybindingShortcut(rule.key);
	if (!shortcut) {
		return null;
	}
	if (rule.when !== undefined) {
		const whenAst = parseKeybindingWhenExpression(rule.when);
		return whenAst ? { command: rule.command, shortcut, whenAst } : null;
	}
	return { command: rule.command, shortcut };
}

export function compileResolvedKeybindingsConfig(
	config: readonly KeybindingRule[],
): ResolvedKeybindingsConfig {
	const compiled: ResolvedKeybindingRule[] = [];
	for (const rule of config) {
		const resolved = compileResolvedKeybindingRule(rule);
		if (resolved) {
			compiled.push(resolved);
		}
	}
	return compiled;
}

function encodeShortcut(shortcut: KeybindingShortcut): string | null {
	const modifiers: string[] = [];
	if (shortcut.modKey) {
		modifiers.push("mod");
	}
	if (shortcut.metaKey) {
		modifiers.push("meta");
	}
	if (shortcut.ctrlKey) {
		modifiers.push("ctrl");
	}
	if (shortcut.altKey) {
		modifiers.push("alt");
	}
	if (shortcut.shiftKey) {
		modifiers.push("shift");
	}
	if (!shortcut.key || (shortcut.key !== "+" && shortcut.key.includes("+"))) {
		return null;
	}
	const key = shortcut.key === " " ? "space" : shortcut.key;
	return [...modifiers, key].join("+");
}

function keybindingShortcutContext(rule: KeybindingRule): string | null {
	const parsed = parseKeybindingShortcut(rule.key);
	const encoded = parsed ? encodeShortcut(parsed) : null;
	return encoded ? `${encoded}\u0000${rule.when ?? ""}` : null;
}

function isSameKeybindingRule(left: KeybindingRule, right: KeybindingRule): boolean {
	return left.command === right.command && left.key === right.key && (left.when ?? "") === (right.when ?? "");
}

function hasSameShortcutContext(left: KeybindingRule, right: KeybindingRule): boolean {
	const leftContext = keybindingShortcutContext(left);
	const rightContext = keybindingShortcutContext(right);
	return leftContext !== null && rightContext !== null && leftContext === rightContext;
}

function mergeWithDefaultKeybindings(custom: ResolvedKeybindingsConfig): ResolvedKeybindingsConfig {
	if (custom.length === 0) {
		return [...DEFAULT_RESOLVED_KEYBINDINGS];
	}
	const overriddenCommands = new Set(custom.map((binding) => binding.command));
	const retainedDefaults = DEFAULT_RESOLVED_KEYBINDINGS.filter(
		(binding) => !overriddenCommands.has(binding.command),
	);
	const merged = [...retainedDefaults, ...custom];
	return merged.length <= MAX_KEYBINDINGS_COUNT ? merged : merged.slice(-MAX_KEYBINDINGS_COUNT);
}

function trimIssueMessage(message: string): string {
	const trimmed = message.trim();
	return trimmed.length > 0 ? trimmed : "Invalid keybindings configuration.";
}

function malformedConfigIssue(detail: string): ServerConfigIssue {
	return { kind: "keybindings.malformed-config", message: trimIssueMessage(detail) };
}

function invalidEntryIssue(index: number, detail: string): ServerConfigIssue {
	return { kind: "keybindings.invalid-entry", index, message: trimIssueMessage(detail) };
}

function encodeKeybindingsConfig(rules: readonly KeybindingRule[]): string {
	return `${JSON.stringify(rules, null, 2)}\n`;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
	const targetDir = path.dirname(filePath);
	const tempDir = await fs.mkdtemp(path.join(targetDir, `${path.basename(filePath)}.`));
	const tempPath = path.join(tempDir, `${process.pid}-${Date.now()}.tmp`);
	try {
		await fs.writeFile(tempPath, contents, "utf8");
		await fs.rename(tempPath, filePath);
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true });
	}
}

class AsyncMutex {
	private tail: Promise<void> = Promise.resolve();

	async run<T>(task: () => Promise<T>): Promise<T> {
		const previous = this.tail;
		let release: () => void = () => undefined;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await task();
		} finally {
			release();
		}
	}
}

export class DesktopAuxSettingsService {
	private readonly settingsListeners = new Set<SettingsListener>();
	private readonly keybindingsListeners = new Set<KeybindingsListener>();
	private readonly settingsWriteLock = new AsyncMutex();
	private readonly keybindingsWriteLock = new AsyncMutex();
	private settingsWatcher: FSWatcher | null = null;
	private keybindingsWatcher: FSWatcher | null = null;
	private settingsWatchTimer: NodeJS.Timeout | null = null;
	private keybindingsWatchTimer: NodeJS.Timeout | null = null;
	private settingsCache: ServerSettings | null = null;
	private keybindingsCache: KeybindingsConfigState | null = null;
	private started = false;

	readonly settingsPath: string;
	readonly keybindingsConfigPath: string;

	constructor(paths: AuxSettingsPaths) {
		this.settingsPath = paths.settingsPath;
		this.keybindingsConfigPath = paths.keybindingsConfigPath;
	}

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
		await fs.mkdir(path.dirname(this.keybindingsConfigPath), { recursive: true });
		// Create the keybindings file with defaults, then backfill newly added defaults unless the
		// user file currently has parse issues.
		await this.syncDefaultKeybindingsOnStartup();
		this.settingsCache = await this.loadSettingsFromDisk();
		this.keybindingsCache = await this.loadConfigStateFromDisk();
		this.startSettingsWatcher();
		this.startKeybindingsWatcher();
	}

	async dispose(): Promise<void> {
		this.started = false;
		if (this.settingsWatchTimer) {
			clearTimeout(this.settingsWatchTimer);
			this.settingsWatchTimer = null;
		}
		if (this.keybindingsWatchTimer) {
			clearTimeout(this.keybindingsWatchTimer);
			this.keybindingsWatchTimer = null;
		}
		this.settingsWatcher?.close();
		this.keybindingsWatcher?.close();
		this.settingsWatcher = null;
		this.keybindingsWatcher = null;
		this.settingsListeners.clear();
		this.keybindingsListeners.clear();
	}

	onSettingsChanged(listener: SettingsListener): () => void {
		this.settingsListeners.add(listener);
		return () => this.settingsListeners.delete(listener);
	}

	onKeybindingsChanged(listener: KeybindingsListener): () => void {
		this.keybindingsListeners.add(listener);
		return () => this.keybindingsListeners.delete(listener);
	}

	async snapshot(): Promise<AuxSettingsSnapshot> {
		const [settings, keybindings] = await Promise.all([this.getSettings(), this.getKeybindingsState()]);
		return {
			settings,
			settingsPath: this.settingsPath,
			keybindingsConfigPath: this.keybindingsConfigPath,
			keybindings: keybindings.keybindings,
			issues: keybindings.issues,
		};
	}

	async getSettings(): Promise<ServerSettings> {
		if (this.settingsCache) {
			return this.settingsCache;
		}
		const settings = await this.loadSettingsFromDisk();
		this.settingsCache = settings;
		return settings;
	}

	async updateSettings(patch: ServerSettingsPatch): Promise<ServerSettings> {
		if (Option.isNone(decodeUnknownRecord(patch))) {
			throw new ServerSettingsError({
				settingsPath: this.settingsPath,
				detail: "invalid settings patch",
			});
		}
		return this.settingsWriteLock.run(async () => {
			const current = await this.getSettings();
			const next = normalizeServerSettings(applyServerSettingsPatch(current, patch));
			const sparseSettings = stripDefaultServerSettings(next);
			await writeFileAtomically(this.settingsPath, `${JSON.stringify(sparseSettings, null, 2)}\n`);
			this.settingsCache = next;
			this.emitSettings(next);
			return next;
		});
	}

	async getKeybindingsState(): Promise<KeybindingsConfigState> {
		if (this.keybindingsCache) {
			return this.keybindingsCache;
		}
		const state = await this.loadConfigStateFromDisk();
		this.keybindingsCache = state;
		return state;
	}

	async upsertKeybindingRule(rule: KeybindingRule): Promise<ResolvedKeybindingsConfig> {
		const normalizedRule = normalizeKeybindingRule(rule);
		if (!normalizedRule || compileResolvedKeybindingRule(normalizedRule) === null) {
			throw new KeybindingsConfigError({
				configPath: this.keybindingsConfigPath,
				detail: "invalid keybinding rule",
			});
		}

		return this.keybindingsWriteLock.run(async () => {
			const customConfig = await this.loadWritableCustomKeybindingsConfig();
			const nextConfig = [
				...customConfig.filter((entry) => entry.command !== normalizedRule.command),
				normalizedRule,
			];
			const cappedConfig =
				nextConfig.length > MAX_KEYBINDINGS_COUNT
					? nextConfig.slice(-MAX_KEYBINDINGS_COUNT)
					: nextConfig;
			await writeFileAtomically(this.keybindingsConfigPath, encodeKeybindingsConfig(cappedConfig));
			const nextResolved = mergeWithDefaultKeybindings(
				compileResolvedKeybindingsConfig(cappedConfig),
			);
			const state = { keybindings: nextResolved, issues: [] } satisfies KeybindingsConfigState;
			this.keybindingsCache = state;
			this.emitKeybindings(state);
			return nextResolved;
		});
	}

	private async loadSettingsFromDisk(): Promise<ServerSettings> {
		if (!(await pathExists(this.settingsPath))) {
			return DEFAULT_SERVER_SETTINGS;
		}
		try {
			const raw = await fs.readFile(this.settingsPath, "utf8");
			return normalizeServerSettings(parseLenientJson(raw));
		} catch {
			return DEFAULT_SERVER_SETTINGS;
		}
	}

	private async loadWritableCustomKeybindingsConfig(): Promise<readonly KeybindingRule[]> {
		if (!(await pathExists(this.keybindingsConfigPath))) {
			return [];
		}
		const raw = await fs.readFile(this.keybindingsConfigPath, "utf8");
		const parsed = parseLenientJson(raw);
		if (!Array.isArray(parsed)) {
			throw new KeybindingsConfigError({
				configPath: this.keybindingsConfigPath,
				detail: "expected JSON array",
			});
		}
		const rules: KeybindingRule[] = [];
		for (const entry of parsed) {
			const normalized = normalizeKeybindingRule(entry);
			if (normalized && compileResolvedKeybindingRule(normalized)) {
				rules.push(normalized);
			}
		}
		return rules;
	}

	private async loadRuntimeCustomKeybindingsConfig(): Promise<{
		readonly keybindings: readonly KeybindingRule[];
		readonly issues: readonly ServerConfigIssue[];
	}> {
		if (!(await pathExists(this.keybindingsConfigPath))) {
			return { keybindings: [], issues: [] };
		}
		const raw = await fs.readFile(this.keybindingsConfigPath, "utf8");
		let parsed: unknown;
		try {
			parsed = parseLenientJson(raw);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return { keybindings: [], issues: [malformedConfigIssue(`expected JSON array (${detail})`)] };
		}
		if (!Array.isArray(parsed)) {
			return { keybindings: [], issues: [malformedConfigIssue("expected JSON array")] };
		}

		const keybindings: KeybindingRule[] = [];
		const issues: ServerConfigIssue[] = [];
		for (const [index, entry] of parsed.entries()) {
			const normalized = normalizeKeybindingRule(entry);
			if (!normalized) {
				issues.push(invalidEntryIssue(index, "Invalid keybinding rule"));
				continue;
			}
			if (!compileResolvedKeybindingRule(normalized)) {
				issues.push(invalidEntryIssue(index, "Invalid keybinding shortcut or when expression"));
				continue;
			}
			keybindings.push(normalized);
		}
		return { keybindings, issues };
	}

	private async loadConfigStateFromDisk(): Promise<KeybindingsConfigState> {
		const { keybindings, issues } = await this.loadRuntimeCustomKeybindingsConfig();
		return {
			keybindings: mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(keybindings)),
			issues,
		};
	}

	private async syncDefaultKeybindingsOnStartup(): Promise<void> {
		return this.keybindingsWriteLock.run(async () => {
			if (!(await pathExists(this.keybindingsConfigPath))) {
				await writeFileAtomically(this.keybindingsConfigPath, encodeKeybindingsConfig(DEFAULT_KEYBINDINGS));
				this.keybindingsCache = null;
				return;
			}
			const runtimeConfig = await this.loadRuntimeCustomKeybindingsConfig();
			if (runtimeConfig.issues.length > 0) {
				this.keybindingsCache = null;
				return;
			}
			const customConfig = runtimeConfig.keybindings;
			const existingCommands = new Set(customConfig.map((entry) => entry.command));
			const missingDefaults: KeybindingRule[] = [];
			for (const defaultRule of DEFAULT_KEYBINDINGS) {
				if (existingCommands.has(defaultRule.command)) {
					continue;
				}
				if (customConfig.find((entry) => hasSameShortcutContext(entry, defaultRule))) {
					continue;
				}
				missingDefaults.push(defaultRule);
			}
			if (missingDefaults.length === 0) {
				this.keybindingsCache = null;
				return;
			}
			const duplicateDefaults = DEFAULT_KEYBINDINGS.filter((defaultRule) =>
				customConfig.some((entry) => isSameKeybindingRule(entry, defaultRule)),
			);
			const nextConfig = [...customConfig, ...missingDefaults.filter((rule) => !duplicateDefaults.includes(rule))];
			const cappedConfig =
				nextConfig.length > MAX_KEYBINDINGS_COUNT
					? nextConfig.slice(-MAX_KEYBINDINGS_COUNT)
					: nextConfig;
			await writeFileAtomically(this.keybindingsConfigPath, encodeKeybindingsConfig(cappedConfig));
			this.keybindingsCache = null;
		});
	}

	private startSettingsWatcher(): void {
		const settingsDir = path.dirname(this.settingsPath);
		const settingsFile = path.basename(this.settingsPath);
		const resolvedSettingsPath = path.resolve(this.settingsPath);
		this.settingsWatcher = watch(settingsDir, (_eventType, fileName) => {
			const candidate = fileName?.toString() ?? "";
			const matches =
				candidate === settingsFile ||
				candidate === this.settingsPath ||
				path.resolve(settingsDir, candidate) === resolvedSettingsPath;
			if (!matches) {
				return;
			}
			if (this.settingsWatchTimer) {
				clearTimeout(this.settingsWatchTimer);
			}
			// Debounce editor truncate/write/rename bursts before re-reading settings.
			this.settingsWatchTimer = setTimeout(() => {
				void this.revalidateSettingsFromWatch();
			}, SETTINGS_WATCH_DEBOUNCE_MS);
		});
		this.settingsWatcher.on("error", () => undefined);
	}

	private startKeybindingsWatcher(): void {
		const keybindingsDir = path.dirname(this.keybindingsConfigPath);
		const keybindingsFile = path.basename(this.keybindingsConfigPath);
		const resolvedKeybindingsPath = path.resolve(this.keybindingsConfigPath);
		this.keybindingsWatcher = watch(keybindingsDir, (_eventType, fileName) => {
			const candidate = fileName?.toString() ?? "";
			const matches =
				candidate === keybindingsFile ||
				candidate === this.keybindingsConfigPath ||
				path.resolve(keybindingsDir, candidate) === resolvedKeybindingsPath;
			if (!matches) {
				return;
			}
			if (this.keybindingsWatchTimer) {
				clearTimeout(this.keybindingsWatchTimer);
			}
			// Debounce file-save bursts before re-reading keybindings.
			this.keybindingsWatchTimer = setTimeout(() => {
				void this.revalidateKeybindingsFromWatch();
			}, KEYBINDINGS_WATCH_DEBOUNCE_MS);
		});
		this.keybindingsWatcher.on("error", () => undefined);
	}

	private async revalidateSettingsFromWatch(): Promise<void> {
		const settings = await this.settingsWriteLock.run(async () => {
			const next = await this.loadSettingsFromDisk();
			this.settingsCache = next;
			return next;
		});
		this.emitSettings(settings);
	}

	private async revalidateKeybindingsFromWatch(): Promise<void> {
		const state = await this.keybindingsWriteLock.run(async () => {
			const next = await this.loadConfigStateFromDisk();
			this.keybindingsCache = next;
			return next;
		});
		this.emitKeybindings(state);
	}

	private emitSettings(settings: ServerSettings): void {
		for (const listener of this.settingsListeners) {
			listener(settings);
		}
	}

	private emitKeybindings(state: KeybindingsConfigState): void {
		for (const listener of this.keybindingsListeners) {
			listener(state);
		}
	}
}

export function createDesktopAuxSettingsService(userDataDir: string): DesktopAuxSettingsService {
	return new DesktopAuxSettingsService(resolveAuxSettingsPaths(userDataDir));
}
