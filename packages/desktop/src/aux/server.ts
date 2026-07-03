import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as path from "node:path";
import { CommandId } from "@honk/shared/base-schemas";
import type {
  ServerConfig,
  ServerConfigStreamEvent,
} from "@honk/shared/server-config";
import type { ClientOrchestrationCommand } from "@honk/shared/orchestration";
import {
  EDITORS,
  type EditorId,
} from "@honk/shared/editor";
import { EnvironmentId } from "@honk/shared/environment";
import {
  ProjectId as ProjectIdSchema,
  ThreadId,
} from "@honk/shared/base-schemas";
import type {
  GitCheckoutInput,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitDiscardPathsInput,
  GitFileImageInput,
  GitFilePatchInput,
  GitInitInput,
  GitListBranchesInput,
  GitPreparePullRequestThreadInput,
  GitPullInput,
  GitPullRequestRefInput,
  GitRemoveWorktreeInput,
  GitRunStackedActionInput,
  GitStackedAction,
  GitStatusInput,
} from "@honk/shared/git";
import {
  type KeybindingRule,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@honk/shared/keybindings";
import type { ModelSelection } from "@honk/shared/model";
import type { ProjectScript } from "@honk/shared/project-scripts";
import type { ServerSettingsPatch } from "@honk/shared/server-settings";

import { createDesktopAuxGitService, type DesktopAuxGitService } from "./git";
import {
	createDesktopAuxSettingsService,
	type DesktopAuxSettingsService,
} from "./settings";
import {
	createDesktopAuxProjectsService,
	type DesktopAuxProjectsService,
} from "./projects";

const REQUEST_BODY_LIMIT_BYTES = 1024 * 1024;
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "authorization, content-type",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-max-age": "600",
};

export interface DesktopAuxServerOptions {
	readonly userDataDir: string;
	readonly worktreesDir: string;
	readonly defaultCwd: string;
	readonly appVersion: string;
	readonly platform: NodeJS.Platform;
	readonly processArch: string;
	readonly logsDirectoryPath: string;
	readonly otlpTracesUrl?: string;
	readonly otlpMetricsUrl?: string;
}

export interface DesktopAuxServerSnapshot {
	readonly baseUrl: string;
	readonly bearerToken: string;
}

type JsonHandler = (body: unknown, url: URL) => Promise<unknown>;
type ModelSelectionPatch = NonNullable<ServerSettingsPatch["textGenerationModelSelection"]>;
type ProjectCreateCommand = Extract<
	ClientOrchestrationCommand,
	{ readonly type: "project.create" }
>;
type ProjectMetaUpdateCommand = Extract<
	ClientOrchestrationCommand,
	{ readonly type: "project.meta.update" }
>;
type ProjectDeleteCommand = Extract<
	ClientOrchestrationCommand,
	{ readonly type: "project.delete" }
>;

const STATIC_KEYBINDING_COMMANDS = new Set<string>([
	"threadTree.toggle",
	"commandPalette.toggle",
	"composer.cycleInteractionMode",
	"composer.mode.agent",
	"composer.mode.ask",
	"composer.mode.plan",
	"composer.mode.debug",
	"composer.mode.multitask",
	"composer.send",
	"composer.interrupt",
	"chat.new",
	"chat.newLocal",
	"route.back",
	"threadSelection.clear",
	"editor.openFavorite",
	"editor.saveFile",
	"editor.addSelectionToChat",
	"editorPanel.toggleFullscreen",
	"browser.focusLocationBar",
	"terminal.toggle",
	"terminal.split",
	"terminal.new",
	"terminal.close",
	"thread.previous",
	"thread.next",
	...THREAD_JUMP_KEYBINDING_COMMANDS,
]);

function toPlatformOs(platform: NodeJS.Platform): ServerConfig["environment"]["platform"]["os"] {
	switch (platform) {
		case "darwin":
			return "darwin";
		case "linux":
			return "linux";
		case "win32":
			return "windows";
		default:
			return "unknown";
	}
}

function toPlatformArch(processArch: string): ServerConfig["environment"]["platform"]["arch"] {
	if (processArch === "arm64" || processArch === "x64") {
		return processArch;
	}
	return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireBodyRecord(body: unknown, label: string): Record<string, unknown> {
	if (!isRecord(body)) {
		throw new Error(`${label} body must be a JSON object.`);
	}
	return body;
}

function requireString(record: Record<string, unknown>, key: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${key} is required.`);
	}
	return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireStringArray(record: Record<string, unknown>, key: string): string[] {
	const value = record[key];
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
		throw new Error(`${key} must be a non-empty string array.`);
	}
	return value;
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
		throw new Error(`${key} must be a string array.`);
	}
	return value;
}

function isKeybindingCommand(value: unknown): value is KeybindingRule["command"] {
	if (typeof value !== "string") {
		return false;
	}
	if (STATIC_KEYBINDING_COMMANDS.has(value)) {
		return true;
	}
	return /^script\.[a-z0-9][a-z0-9-]*\.run$/.test(value);
}

function isGitStackedAction(value: unknown): value is GitStackedAction {
	return (
		value === "commit" ||
		value === "push" ||
		value === "create_pr" ||
		value === "commit_push" ||
		value === "commit_push_pr"
	);
}

function requireGitStatusInput(body: unknown): GitStatusInput {
	const record = requireBodyRecord(body, "git status");
	const scope = record.scope;
	if (scope !== undefined && scope !== "full" && scope !== "local") {
		throw new Error("git status scope must be full or local.");
	}
	return {
		cwd: requireString(record, "cwd"),
		...(scope ? { scope } : {}),
	};
}

function requireKeybindingRule(body: unknown): KeybindingRule {
	const record = requireBodyRecord(body, "keybinding");
	if (typeof record.key !== "string" || !isKeybindingCommand(record.command)) {
		throw new Error("keybinding requires key and command.");
	}
	return {
		key: record.key,
		command: record.command,
		...(typeof record.when === "string" ? { when: record.when } : {}),
	};
}

function requireSettingsPatch(body: unknown): ServerSettingsPatch {
	const record = requireBodyRecord(body, "settings patch");
	const patch = isRecord(record.patch) ? record.patch : record;
	const selectionRecord = isRecord(patch.textGenerationModelSelection)
		? patch.textGenerationModelSelection
		: null;
	const selectionOptions =
		selectionRecord && Array.isArray(selectionRecord.options)
			? selectionRecord.options.flatMap((entry) => {
					if (!isRecord(entry) || typeof entry.id !== "string") {
						return [];
					}
					if (typeof entry.value !== "string" && typeof entry.value !== "boolean") {
						return [];
					}
					return [{ id: entry.id, value: entry.value }];
				})
			: undefined;
	const textGenerationModelSelection: ModelSelectionPatch | undefined = selectionRecord
		? {
				...(typeof selectionRecord.instanceId === "string"
					? { instanceId: selectionRecord.instanceId }
					: {}),
				...(typeof selectionRecord.model === "string" ? { model: selectionRecord.model } : {}),
				...(selectionOptions !== undefined ? { options: selectionOptions } : {}),
			}
		: undefined;
	const observabilityRecord = isRecord(patch.observability) ? patch.observability : null;
	const observability: NonNullable<ServerSettingsPatch["observability"]> | undefined =
		observabilityRecord
			? {
					...(typeof observabilityRecord.otlpTracesUrl === "string"
						? { otlpTracesUrl: observabilityRecord.otlpTracesUrl }
						: {}),
					...(typeof observabilityRecord.otlpMetricsUrl === "string"
						? { otlpMetricsUrl: observabilityRecord.otlpMetricsUrl }
						: {}),
				}
			: undefined;
	return {
		...(typeof patch.enableAssistantStreaming === "boolean"
			? { enableAssistantStreaming: patch.enableAssistantStreaming }
			: {}),
		...(patch.defaultThreadEnvMode === "local" || patch.defaultThreadEnvMode === "worktree"
			? { defaultThreadEnvMode: patch.defaultThreadEnvMode }
			: {}),
		...(typeof patch.addProjectBaseDirectory === "string"
			? { addProjectBaseDirectory: patch.addProjectBaseDirectory }
			: {}),
		...(textGenerationModelSelection ? { textGenerationModelSelection } : {}),
		...(observability ? { observability } : {}),
	};
}

function requireModelSelection(value: unknown, label: string): ModelSelection {
	if (!isRecord(value)) {
		throw new Error(`${label} must be a model selection.`);
	}
	const options =
		Array.isArray(value.options)
			? value.options.flatMap((entry, index) => {
					if (!isRecord(entry)) {
						throw new Error(`${label}.options[${index}] must be an object.`);
					}
					const optionValue = entry.value;
					if (typeof optionValue !== "string" && typeof optionValue !== "boolean") {
						throw new Error(`${label}.options[${index}].value must be a string or boolean.`);
					}
					return [{ id: requireString(entry, "id"), value: optionValue }];
				})
			: undefined;
	return {
		instanceId: requireString(value, "instanceId"),
		model: requireString(value, "model"),
		...(options !== undefined && options.length > 0 ? { options } : {}),
	};
}

function optionalModelSelection(
	record: Record<string, unknown>,
	key: string,
): ModelSelection | null | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	return value === null ? null : requireModelSelection(value, key);
}

function requireProjectScriptIcon(value: unknown, label: string): ProjectScript["icon"] {
	switch (value) {
		case "play":
		case "test":
		case "lint":
		case "configure":
		case "build":
		case "debug":
			return value;
		default:
			throw new Error(`${label} is invalid.`);
	}
}

function requireProjectScript(value: unknown, index: number): ProjectScript {
	if (!isRecord(value)) {
		throw new Error(`scripts[${index}] must be an object.`);
	}
	if (typeof value.runOnWorktreeCreate !== "boolean") {
		throw new Error(`scripts[${index}].runOnWorktreeCreate must be a boolean.`);
	}
	return {
		id: requireString(value, "id"),
		name: requireString(value, "name"),
		command: requireString(value, "command"),
		icon: requireProjectScriptIcon(value.icon, `scripts[${index}].icon`),
		runOnWorktreeCreate: value.runOnWorktreeCreate,
	};
}

function optionalProjectScripts(
	record: Record<string, unknown>,
	key: string,
): ProjectScript[] | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new Error(`${key} must be an array.`);
	}
	return value.map((entry, index) => requireProjectScript(entry, index));
}

function requireProjectCreateCommand(body: unknown): ProjectCreateCommand {
	const record = requireBodyRecord(body, "project create");
	const createProjectRootIfMissing = optionalBoolean(record, "createProjectRootIfMissing");
	const defaultModelSelection = optionalModelSelection(record, "defaultModelSelection");
	return {
		type: "project.create",
		commandId: CommandId.make(requireString(record, "commandId")),
		projectId: ProjectIdSchema.make(requireString(record, "projectId")),
		title: requireString(record, "title"),
		projectRoot: requireString(record, "projectRoot"),
		...(createProjectRootIfMissing !== undefined ? { createProjectRootIfMissing } : {}),
		...(defaultModelSelection !== undefined ? { defaultModelSelection } : {}),
		createdAt: requireString(record, "createdAt"),
	};
}

function requireProjectMetaUpdateCommand(body: unknown): ProjectMetaUpdateCommand {
	const record = requireBodyRecord(body, "project meta update");
	const defaultModelSelection = optionalModelSelection(record, "defaultModelSelection");
	const scripts = optionalProjectScripts(record, "scripts");
	return {
		type: "project.meta.update",
		commandId: CommandId.make(requireString(record, "commandId")),
		projectId: ProjectIdSchema.make(requireString(record, "projectId")),
		...(optionalString(record, "title") ? { title: optionalString(record, "title") } : {}),
		...(optionalString(record, "projectRoot")
			? { projectRoot: optionalString(record, "projectRoot") }
			: {}),
		...(defaultModelSelection !== undefined ? { defaultModelSelection } : {}),
		...(scripts !== undefined ? { scripts } : {}),
	};
}

function requireProjectDeleteCommand(body: unknown): ProjectDeleteCommand {
	const record = requireBodyRecord(body, "project delete");
	const force = optionalBoolean(record, "force");
	return {
		type: "project.delete",
		commandId: CommandId.make(requireString(record, "commandId")),
		projectId: ProjectIdSchema.make(requireString(record, "projectId")),
		...(force !== undefined ? { force } : {}),
	};
}

function requireGitPullInput(body: unknown): GitPullInput {
	const record = requireBodyRecord(body, "git pull");
	return { cwd: requireString(record, "cwd") };
}

function requireGitDiscardPathsInput(body: unknown): GitDiscardPathsInput {
	const record = requireBodyRecord(body, "git discard");
	const paths = requireStringArray(record, "paths");
	if (paths.length === 0) {
		throw new Error("paths must not be empty.");
	}
	return { cwd: requireString(record, "cwd"), paths };
}

function requireGitFilePatchInput(body: unknown): GitFilePatchInput {
	const record = requireBodyRecord(body, "git file patch");
	return {
		cwd: requireString(record, "cwd"),
		path: requireString(record, "path"),
		...(optionalString(record, "prevPath") ? { prevPath: optionalString(record, "prevPath") } : {}),
	};
}

function requireGitFileImageInput(body: unknown): GitFileImageInput {
	const record = requireBodyRecord(body, "git file image");
	return { cwd: requireString(record, "cwd"), path: requireString(record, "path") };
}

function requireGitListBranchesInput(body: unknown): GitListBranchesInput {
	const record = requireBodyRecord(body, "git branches");
	const cursor = optionalNumber(record, "cursor");
	const limit = optionalNumber(record, "limit");
	return {
		cwd: requireString(record, "cwd"),
		...(optionalString(record, "query") ? { query: optionalString(record, "query") } : {}),
		...(cursor !== undefined ? { cursor } : {}),
		...(limit !== undefined ? { limit } : {}),
	};
}

function requireGitCreateWorktreeInput(body: unknown): GitCreateWorktreeInput {
	const record = requireBodyRecord(body, "git create worktree");
	const rawPath = record.path;
	if (rawPath !== null && rawPath !== undefined && typeof rawPath !== "string") {
		throw new Error("path must be a string or null.");
	}
	return {
		cwd: requireString(record, "cwd"),
		branch: requireString(record, "branch"),
		...(optionalString(record, "newBranch") ? { newBranch: optionalString(record, "newBranch") } : {}),
		path: rawPath === undefined ? null : rawPath,
	};
}

function requireGitRemoveWorktreeInput(body: unknown): GitRemoveWorktreeInput {
	const record = requireBodyRecord(body, "git remove worktree");
	return {
		cwd: requireString(record, "cwd"),
		path: requireString(record, "path"),
		...(optionalBoolean(record, "force") !== undefined ? { force: optionalBoolean(record, "force") } : {}),
	};
}

function requireGitCreateBranchInput(body: unknown): GitCreateBranchInput {
	const record = requireBodyRecord(body, "git create branch");
	return {
		cwd: requireString(record, "cwd"),
		branch: requireString(record, "branch"),
		...(optionalBoolean(record, "checkout") !== undefined
			? { checkout: optionalBoolean(record, "checkout") }
			: {}),
	};
}

function requireGitCheckoutInput(body: unknown): GitCheckoutInput {
	const record = requireBodyRecord(body, "git checkout");
	return { cwd: requireString(record, "cwd"), branch: requireString(record, "branch") };
}

function requireGitInitInput(body: unknown): GitInitInput {
	const record = requireBodyRecord(body, "git init");
	return { cwd: requireString(record, "cwd") };
}

function requireGitPullRequestRefInput(body: unknown): GitPullRequestRefInput {
	const record = requireBodyRecord(body, "git pull request");
	return { cwd: requireString(record, "cwd"), reference: requireString(record, "reference") };
}

function requireGitPreparePullRequestThreadInput(body: unknown): GitPreparePullRequestThreadInput {
	const record = requireBodyRecord(body, "git prepare pull request thread");
	if (record.mode !== "local" && record.mode !== "worktree") {
		throw new Error("mode must be local or worktree.");
	}
	const threadId = optionalString(record, "threadId");
	return {
		cwd: requireString(record, "cwd"),
		reference: requireString(record, "reference"),
		mode: record.mode,
		...(threadId ? { threadId: ThreadId.make(threadId) } : {}),
	};
}

function requireGitRunStackedActionInput(body: unknown): GitRunStackedActionInput {
	const record = requireBodyRecord(body, "git run stacked action");
	if (!isGitStackedAction(record.action)) {
		throw new Error("Invalid git action.");
	}
	return {
		actionId: requireString(record, "actionId"),
		cwd: requireString(record, "cwd"),
		action: record.action,
		...(optionalString(record, "commitMessage")
			? { commitMessage: optionalString(record, "commitMessage") }
			: {}),
		...(optionalBoolean(record, "featureBranch") !== undefined
			? { featureBranch: optionalBoolean(record, "featureBranch") }
			: {}),
		...(optionalStringArray(record, "filePaths") ? { filePaths: optionalStringArray(record, "filePaths") } : {}),
	};
}

function serializeError(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		const base: Record<string, unknown> = {
			name: error.name,
			message: error.message,
		};
		for (const key of ["_tag", "operation", "command", "cwd", "detail", "settingsPath", "configPath"]) {
			const value = Reflect.get(error, key);
			if (typeof value === "string") {
				base[key] = value;
			}
		}
		return base;
	}
	return { message: String(error) };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		totalBytes += buffer.byteLength;
		if (totalBytes > REQUEST_BODY_LIMIT_BYTES) {
			throw new Error("Request body is too large.");
		}
		chunks.push(buffer);
	}
	if (chunks.length === 0) {
		return {};
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	return raw.length > 0 ? JSON.parse(raw) : {};
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(`${JSON.stringify(payload)}\n`);
}

function sendOptions(response: ServerResponse): void {
	response.writeHead(204, CORS_HEADERS);
	response.end();
}

function sendSse(response: ServerResponse): void {
	response.writeHead(200, {
		...CORS_HEADERS,
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-store",
		connection: "keep-alive",
		"x-accel-buffering": "no",
	});
	response.write(": connected\n\n");
}

function writeSse(response: ServerResponse, event: string, payload: unknown): void {
	response.write(`event: ${event}\n`);
	response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export class DesktopAuxServer {
	private readonly token = randomBytes(32).toString("base64url");
	private readonly git: DesktopAuxGitService;
	private readonly settings: DesktopAuxSettingsService;
	private readonly projects: DesktopAuxProjectsService;
	private readonly options: DesktopAuxServerOptions;
	private server: Server | null = null;
	private baseUrl: string | null = null;

	constructor(options: DesktopAuxServerOptions) {
		this.options = options;
		this.git = createDesktopAuxGitService({
			worktreesDir: options.worktreesDir,
		});
		this.settings = createDesktopAuxSettingsService(options.userDataDir);
		this.projects = createDesktopAuxProjectsService(options.userDataDir);
	}

	getBearerToken(): string {
		return this.token;
	}

	getBaseUrl(): string | null {
		return this.baseUrl;
	}

	getSnapshot(): DesktopAuxServerSnapshot | null {
		return this.baseUrl ? { baseUrl: this.baseUrl, bearerToken: this.token } : null;
	}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}
		await Promise.all([this.settings.start(), this.projects.start()]);
		this.server = createServer((request, response) => {
			void this.handleRequest(request, response);
		});
		await new Promise<void>((resolve, reject) => {
			const server = this.server;
			if (!server) {
				reject(new Error("Aux server missing."));
				return;
			}
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => {
				server.off("error", reject);
				const address = server.address();
				if (typeof address === "object" && address !== null) {
					this.baseUrl = `http://127.0.0.1:${address.port}`;
					resolve();
					return;
				}
				reject(new Error("Aux server did not bind a TCP port."));
			});
		});
	}

	async dispose(): Promise<void> {
		await Promise.all([
			this.git.dispose(),
			this.settings.dispose(),
			this.projects.dispose(),
			new Promise<void>((resolve, reject) => {
				const server = this.server;
				if (!server) {
					resolve();
					return;
				}
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			}),
		]);
		this.server = null;
		this.baseUrl = null;
	}

	private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			if (request.method === "OPTIONS") {
				sendOptions(response);
				return;
			}
			if (!this.isAuthorized(request)) {
				sendJson(response, 401, { error: { message: "Unauthorized." } });
				return;
			}
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (request.method === "GET" && url.pathname === "/health") {
				sendJson(response, 200, { ok: true });
				return;
			}
			if (request.method === "GET" && url.pathname === "/config") {
				sendJson(response, 200, await this.loadServerConfig());
				return;
			}
			if (request.method === "GET" && url.pathname === "/settings") {
				sendJson(response, 200, await this.settings.getSettings());
				return;
			}
			if (request.method === "GET" && url.pathname === "/projects") {
				sendJson(response, 200, await this.projects.list());
				return;
			}
			if (request.method === "GET" && url.pathname === "/config/stream") {
				await this.handleConfigStream(request, response);
				return;
			}
			if (request.method === "GET" && url.pathname === "/projects/stream") {
				await this.handleProjectsStream(request, response);
				return;
			}
			if (request.method === "GET" && url.pathname === "/git/status/stream") {
				await this.handleGitStatusStream(request, response, url);
				return;
			}
			if (request.method === "POST" && url.pathname === "/git/run-stacked-action/stream") {
				await this.handleRunStackedActionStream(request, response, url);
				return;
			}
			if (request.method === "POST") {
				await this.handleJsonPost(request, response, url);
				return;
			}
			sendJson(response, 404, { error: { message: "Not found." } });
		} catch (error) {
			if (!response.headersSent) {
				sendJson(response, 500, { error: serializeError(error) });
				return;
			}
			writeSse(response, "error", serializeError(error));
			response.end();
		}
	}

	private isAuthorized(request: IncomingMessage): boolean {
		const authorization = request.headers.authorization;
		return authorization === `Bearer ${this.token}`;
	}

	private async handleJsonPost(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<void> {
		const body = await readJsonBody(request);
		const handler = this.jsonRoutes().get(url.pathname);
		if (!handler) {
			sendJson(response, 404, { error: { message: "Not found." } });
			return;
		}
		const result = await handler(body, url);
		sendJson(response, 200, result ?? { ok: true });
	}

	private jsonRoutes(): Map<string, JsonHandler> {
		return new Map<string, JsonHandler>([
			["/settings/update", (body) => this.settings.updateSettings(requireSettingsPatch(body))],
			["/projects/create", (body) => this.projects.createProject(requireProjectCreateCommand(body))],
			[
				"/projects/meta-update",
				(body) => this.projects.metaUpdate(requireProjectMetaUpdateCommand(body)),
			],
			["/projects/delete", (body) => this.projects.deleteProject(requireProjectDeleteCommand(body))],
			[
				"/keybindings/upsert",
				async (body) => ({
					keybindings: await this.settings.upsertKeybindingRule(requireKeybindingRule(body)),
					issues: [],
				}),
			],
			["/git/status/refresh", (body) => this.git.refreshStatus(requireGitStatusInput(body))],
			["/git/pull", (body) => this.git.pull(requireGitPullInput(body))],
			[
				"/git/discard-paths",
				(body) => this.git.discardPaths(requireGitDiscardPathsInput(body)),
			],
			[
				"/git/file-patch",
				(body) => this.git.getFilePatch(requireGitFilePatchInput(body)),
			],
			[
				"/git/file-image",
				(body) => this.git.getFileImage(requireGitFileImageInput(body)),
			],
			[
				"/git/branches",
				(body) => this.git.listBranches(requireGitListBranchesInput(body)),
			],
			[
				"/git/worktrees/create",
				(body) => this.git.createWorktree(requireGitCreateWorktreeInput(body)),
			],
			[
				"/git/worktrees/remove",
				(body) => this.git.removeWorktree(requireGitRemoveWorktreeInput(body)),
			],
			[
				"/git/branches/create",
				(body) => this.git.createBranch(requireGitCreateBranchInput(body)),
			],
			["/git/checkout", (body) => this.git.checkout(requireGitCheckoutInput(body))],
			["/git/init", (body) => this.git.init(requireGitInitInput(body))],
			[
				"/git/pull-request/resolve",
				(body) => this.git.resolvePullRequest(requireGitPullRequestRefInput(body)),
			],
			[
				"/git/pull-request/prepare-thread",
				(body) => this.git.preparePullRequestThread(requireGitPreparePullRequestThreadInput(body)),
			],
			[
				"/git/run-stacked-action",
				(body) => this.git.runStackedAction(requireGitRunStackedActionInput(body)),
			],
		]);
	}

	private async handleConfigStream(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		sendSse(response);
		writeSse(response, "message", {
			version: 1,
			type: "snapshot",
			config: await this.loadServerConfig(),
		} satisfies ServerConfigStreamEvent);
		const removeSettingsListener = this.settings.onSettingsChanged((settings) => {
			writeSse(response, "message", {
				version: 1,
				type: "settingsUpdated",
				payload: { settings },
			} satisfies ServerConfigStreamEvent);
		});
		const removeKeybindingsListener = this.settings.onKeybindingsChanged((state) => {
			writeSse(response, "message", {
				version: 1,
				type: "keybindingsUpdated",
				payload: { issues: state.issues },
			} satisfies ServerConfigStreamEvent);
		});
		request.once("close", () => {
			removeSettingsListener();
			removeKeybindingsListener();
		});
	}

	private async handleProjectsStream(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		sendSse(response);
		const unsubscribe = this.projects.onProjectEvent((event) => {
			writeSse(response, "message", event);
		});
		request.once("close", unsubscribe);
	}

	private async handleGitStatusStream(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
	): Promise<void> {
		const cwd = url.searchParams.get("cwd")?.trim();
		if (!cwd) {
			sendJson(response, 400, { error: { message: "cwd query parameter is required." } });
			return;
		}
		const rawScope = url.searchParams.get("scope");
		const scope = rawScope === "full" || rawScope === "local" ? rawScope : undefined;
		sendSse(response);
		const unsubscribe = await this.git.subscribeStatus({ cwd, ...(scope ? { scope } : {}) }, (event) => {
			writeSse(response, "message", event);
		});
		request.once("close", unsubscribe);
	}

	private async handleRunStackedActionStream(
		request: IncomingMessage,
		response: ServerResponse,
		_url: URL,
	): Promise<void> {
		const input = requireGitRunStackedActionInput(await readJsonBody(request));
		sendSse(response);
		try {
			const result = await this.git.runStackedAction(input, (event) => {
				writeSse(response, "message", event);
			});
			writeSse(response, "result", result);
			response.end();
		} catch (error) {
			writeSse(response, "error", serializeError(error));
			response.end();
		}
	}

	private async loadServerConfig(): Promise<ServerConfig> {
		const snapshot = await this.settings.snapshot();
		const availableEditors: EditorId[] = EDITORS.map((editor) => editor.id);
		return {
			environment: {
				environmentId: EnvironmentId.make("desktop-local"),
				label: "Desktop Local",
				platform: {
					os: toPlatformOs(this.options.platform),
					arch: toPlatformArch(this.options.processArch),
				},
				serverVersion: this.options.appVersion,
				capabilities: { repositoryIdentity: false },
				startupStatus: "ready",
			},
			auth: {
				policy: "desktop-managed-local",
				bootstrapMethods: ["desktop-bootstrap"],
				sessionMethods: ["bearer-session-token"],
			},
			cwd: this.options.defaultCwd,
			keybindingsConfigPath: snapshot.keybindingsConfigPath,
			keybindings: snapshot.keybindings,
			issues: snapshot.issues,
			availableEditors,
			observability: {
				logsDirectoryPath: this.options.logsDirectoryPath,
				localTracingEnabled: true,
				...(this.options.otlpTracesUrl ? { otlpTracesUrl: this.options.otlpTracesUrl } : {}),
				otlpTracesEnabled: this.options.otlpTracesUrl !== undefined,
				...(this.options.otlpMetricsUrl ? { otlpMetricsUrl: this.options.otlpMetricsUrl } : {}),
				otlpMetricsEnabled: this.options.otlpMetricsUrl !== undefined,
			},
			settings: snapshot.settings,
		};
	}
}

export function createDesktopAuxServer(options: DesktopAuxServerOptions): DesktopAuxServer {
	return new DesktopAuxServer({
		...options,
		worktreesDir: path.resolve(options.worktreesDir),
	});
}
