import { randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EventId } from "@honk/shared/base-schemas";
import type {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  OrchestrationProjectShell,
} from "@honk/shared/orchestration";
import {
  ProjectId as ProjectIdSchema,
  type ProjectId,
} from "@honk/shared/base-schemas";
import type { ModelSelection } from "@honk/shared/model";
import type { ProjectScript } from "@honk/shared/project-scripts";

import { createDesktopAuxRepositoryIdentityResolver } from "./repository-identity";

const PROJECTS_WATCH_DEBOUNCE_MS = 100;

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
export type DesktopAuxProjectEvent = Extract<
	OrchestrationEvent,
	{ readonly type: "project.created" | "project.meta-updated" | "project.deleted" }
>;
type ProjectCommandId =
	| ProjectCreateCommand["commandId"]
	| ProjectMetaUpdateCommand["commandId"]
	| ProjectDeleteCommand["commandId"];
type ProjectListener = (event: DesktopAuxProjectEvent) => void;
type JsonRecord = Record<string, unknown>;

interface StoredProjectRecord {
	readonly projectId: ProjectId;
	readonly title: string;
	readonly projectRoot: string;
	readonly defaultModelSelection: ModelSelection | null;
	readonly scripts: ProjectScript[];
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly deletedAt: string | null;
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

export function resolveAuxProjectsPath(userDataDir: string): string {
	return path.join(userDataDir, "projects.json");
}

function jsonRecord(value: unknown): JsonRecord | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return Object.fromEntries(Object.entries(value));
}

function readString(record: JsonRecord, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function readProjectScriptIcon(value: unknown): ProjectScript["icon"] | null {
	switch (value) {
		case "play":
		case "test":
		case "lint":
		case "configure":
		case "build":
		case "debug":
			return value;
		default:
			return null;
	}
}

function readModelOption(value: unknown): NonNullable<ModelSelection["options"]>[number] | null {
	const record = jsonRecord(value);
	if (!record) {
		return null;
	}
	const id = readString(record, "id");
	const optionValue = record.value;
	if (!id || (typeof optionValue !== "string" && typeof optionValue !== "boolean")) {
		return null;
	}
	return { id, value: optionValue };
}

function readModelSelection(value: unknown): ModelSelection | null {
	if (value === null) {
		return null;
	}
	const record = jsonRecord(value);
	if (!record) {
		return null;
	}
	const instanceId = readString(record, "instanceId");
	const model = readString(record, "model");
	if (!instanceId || !model) {
		return null;
	}
	const options = Array.isArray(record.options)
		? record.options.flatMap((entry) => {
				const option = readModelOption(entry);
				return option ? [option] : [];
			})
		: [];
	return {
		instanceId,
		model,
		...(options.length > 0 ? { options } : {}),
	};
}

function readProjectScript(value: unknown): ProjectScript | null {
	const record = jsonRecord(value);
	if (!record) {
		return null;
	}
	const id = readString(record, "id");
	const name = readString(record, "name");
	const command = readString(record, "command");
	const icon = readProjectScriptIcon(record.icon);
	if (!id || !name || !command || !icon || typeof record.runOnWorktreeCreate !== "boolean") {
		return null;
	}
	return {
		id,
		name,
		command,
		icon,
		runOnWorktreeCreate: record.runOnWorktreeCreate,
	};
}

function readProjectRecord(value: unknown): StoredProjectRecord | null {
	const record = jsonRecord(value);
	if (!record) {
		return null;
	}
	const projectId = readString(record, "projectId");
	const title = readString(record, "title");
	const projectRoot = readString(record, "projectRoot");
	const createdAt = readString(record, "createdAt");
	const updatedAt = readString(record, "updatedAt");
	if (!Object.hasOwn(record, "deletedAt")) {
		return null;
	}
	const deletedAt = record.deletedAt === null ? null : readString(record, "deletedAt");
	if (!projectId || !title || !projectRoot || !createdAt || !updatedAt) {
		return null;
	}
	const defaultModelSelection = readModelSelection(record.defaultModelSelection);
	const scripts = Array.isArray(record.scripts)
		? record.scripts.flatMap((entry) => {
				const script = readProjectScript(entry);
				return script ? [script] : [];
			})
		: [];
	return {
		projectId: ProjectIdSchema.make(projectId),
		title,
		projectRoot,
		defaultModelSelection,
		scripts,
		createdAt,
		updatedAt,
		deletedAt,
	};
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

function encodeProjects(records: readonly StoredProjectRecord[]): string {
	return `${JSON.stringify(records, null, 2)}\n`;
}

function activeRecords(records: readonly StoredProjectRecord[]): StoredProjectRecord[] {
	return records.filter((record) => record.deletedAt === null);
}

function recordsByProjectId(
	records: readonly StoredProjectRecord[],
): ReadonlyMap<ProjectId, StoredProjectRecord> {
	return new Map(records.map((record) => [record.projectId, record]));
}

function recordsEqual(left: StoredProjectRecord, right: StoredProjectRecord): boolean {
	return (
		left.title === right.title &&
		left.projectRoot === right.projectRoot &&
		JSON.stringify(left.defaultModelSelection) === JSON.stringify(right.defaultModelSelection) &&
		JSON.stringify(left.scripts) === JSON.stringify(right.scripts) &&
		left.updatedAt === right.updatedAt &&
		left.deletedAt === right.deletedAt
	);
}

export class DesktopAuxProjectsService {
	private readonly listeners = new Set<ProjectListener>();
	private readonly writeLock = new AsyncMutex();
	private readonly repositoryIdentity = createDesktopAuxRepositoryIdentityResolver();
	private projectsWatcher: FSWatcher | null = null;
	private projectsWatchTimer: NodeJS.Timeout | null = null;
	private recordsCache: StoredProjectRecord[] | null = null;
	private started = false;
	private sequence = 0;

	readonly projectsPath: string;

	constructor(projectsPath: string) {
		this.projectsPath = projectsPath;
	}

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		await fs.mkdir(path.dirname(this.projectsPath), { recursive: true });
		this.recordsCache = await this.loadRecordsFromDisk();
		this.startProjectsWatcher();
	}

	async dispose(): Promise<void> {
		this.started = false;
		if (this.projectsWatchTimer) {
			clearTimeout(this.projectsWatchTimer);
			this.projectsWatchTimer = null;
		}
		this.projectsWatcher?.close();
		this.projectsWatcher = null;
		this.listeners.clear();
	}

	onProjectEvent(listener: ProjectListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async list(): Promise<OrchestrationProjectShell[]> {
		const records = await this.getRecords();
		return Promise.all(activeRecords(records).map((record) => this.toProjectShell(record)));
	}

	async createProject(command: ProjectCreateCommand): Promise<DesktopAuxProjectEvent> {
		if (command.createProjectRootIfMissing === true) {
			await fs.mkdir(command.projectRoot, { recursive: true });
		}
		const event = await this.writeLock.run(async () => {
			const current = await this.getRecords();
			const nextRecord: StoredProjectRecord = {
				projectId: command.projectId,
				title: command.title,
				projectRoot: command.projectRoot,
				defaultModelSelection: command.defaultModelSelection ?? null,
				scripts: [],
				createdAt: command.createdAt,
				updatedAt: command.createdAt,
				deletedAt: null,
			};
			await this.writeRecords([
				...current.filter((record) => record.projectId !== command.projectId),
				nextRecord,
			]);
			return this.projectCreatedEvent(nextRecord, command.commandId);
		});
		this.emit(event);
		return event;
	}

	async metaUpdate(command: ProjectMetaUpdateCommand): Promise<DesktopAuxProjectEvent> {
		const event = await this.writeLock.run(async () => {
			const current = await this.getRecords();
			const existing = current.find(
				(record) => record.projectId === command.projectId && record.deletedAt === null,
			);
			if (!existing) {
				throw new Error(`Project ${command.projectId} was not found.`);
			}
			const updatedAt = new Date().toISOString();
			const nextRecord: StoredProjectRecord = {
				...existing,
				...(command.title !== undefined ? { title: command.title } : {}),
				...(command.projectRoot !== undefined ? { projectRoot: command.projectRoot } : {}),
				...(command.defaultModelSelection !== undefined
					? { defaultModelSelection: command.defaultModelSelection }
					: {}),
				...(command.scripts !== undefined ? { scripts: [...command.scripts] } : {}),
				updatedAt,
			};
			await this.writeRecords(
				current.map((record) => (record.projectId === command.projectId ? nextRecord : record)),
			);
			return this.projectMetaUpdatedEvent(nextRecord, command, updatedAt);
		});
		this.emit(event);
		return event;
	}

	async deleteProject(command: ProjectDeleteCommand): Promise<DesktopAuxProjectEvent> {
		const event = await this.writeLock.run(async () => {
			const current = await this.getRecords();
			const existing = current.find(
				(record) => record.projectId === command.projectId && record.deletedAt === null,
			);
			if (!existing) {
				throw new Error(`Project ${command.projectId} was not found.`);
			}
			const deletedAt = new Date().toISOString();
			const nextRecord = { ...existing, deletedAt };
			await this.writeRecords(
				current.map((record) => (record.projectId === command.projectId ? nextRecord : record)),
			);
			return this.projectDeletedEvent(command.projectId, command.commandId, deletedAt);
		});
		this.emit(event);
		return event;
	}

	private async toProjectShell(record: StoredProjectRecord): Promise<OrchestrationProjectShell> {
		return {
			id: record.projectId,
			title: record.title,
			projectRoot: record.projectRoot,
			repositoryIdentity: await this.repositoryIdentity.resolve(record.projectRoot),
			defaultModelSelection: record.defaultModelSelection,
			scripts: record.scripts,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		};
	}

	private async getRecords(): Promise<StoredProjectRecord[]> {
		if (this.recordsCache) {
			return this.recordsCache;
		}
		const records = await this.loadRecordsFromDisk();
		this.recordsCache = records;
		return records;
	}

	private async loadRecordsFromDisk(): Promise<StoredProjectRecord[]> {
		if (!(await pathExists(this.projectsPath))) {
			return [];
		}
		const raw = await fs.readFile(this.projectsPath, "utf8");
		const parsed: unknown = raw.trim().length > 0 ? JSON.parse(raw) : [];
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.flatMap((entry) => {
			const record = readProjectRecord(entry);
			return record ? [record] : [];
		});
	}

	private async writeRecords(records: readonly StoredProjectRecord[]): Promise<void> {
		await writeFileAtomically(this.projectsPath, encodeProjects(records));
		this.recordsCache = [...records];
	}

	private startProjectsWatcher(): void {
		if (this.projectsWatcher) {
			return;
		}
		const projectsDir = path.dirname(this.projectsPath);
		const projectsFileName = path.basename(this.projectsPath);
		this.projectsWatcher = watch(projectsDir, (_eventType, fileName) => {
			const changedFileName = typeof fileName === "string" ? fileName : null;
			if (changedFileName !== null && changedFileName !== projectsFileName) {
				return;
			}
			if (this.projectsWatchTimer) {
				clearTimeout(this.projectsWatchTimer);
			}
			this.projectsWatchTimer = setTimeout(() => {
				this.projectsWatchTimer = null;
				void this.reloadRecordsFromDisk();
			}, PROJECTS_WATCH_DEBOUNCE_MS);
		});
	}

	private async reloadRecordsFromDisk(): Promise<void> {
		const previous = this.recordsCache ?? [];
		const next = await this.loadRecordsFromDisk();
		this.recordsCache = next;
		const events = await this.diffProjectEvents(previous, next);
		for (const event of events) {
			this.emit(event);
		}
	}

	private async diffProjectEvents(
		previousRecords: readonly StoredProjectRecord[],
		nextRecords: readonly StoredProjectRecord[],
	): Promise<DesktopAuxProjectEvent[]> {
		const previousByProjectId = recordsByProjectId(activeRecords(previousRecords));
		const nextByProjectId = recordsByProjectId(activeRecords(nextRecords));
		const events: DesktopAuxProjectEvent[] = [];
		for (const nextRecord of nextByProjectId.values()) {
			const previousRecord = previousByProjectId.get(nextRecord.projectId);
			if (!previousRecord) {
				events.push(await this.projectCreatedEvent(nextRecord, null));
				continue;
			}
			if (!recordsEqual(previousRecord, nextRecord)) {
				events.push(await this.projectMetaUpdatedSnapshotEvent(nextRecord));
			}
		}
		for (const previousRecord of previousByProjectId.values()) {
			if (!nextByProjectId.has(previousRecord.projectId)) {
				const deletedRecord = nextRecords.find(
					(record) => record.projectId === previousRecord.projectId,
				);
				events.push(
					this.projectDeletedEvent(
						previousRecord.projectId,
						null,
						deletedRecord?.deletedAt ?? new Date().toISOString(),
					),
				);
			}
		}
		return events;
	}

	private nextEventBase(input: {
		readonly projectId: ProjectId;
		readonly occurredAt: string;
		readonly commandId: ProjectCommandId | null;
	}): Omit<DesktopAuxProjectEvent, "type" | "payload"> {
		this.sequence += 1;
		return {
			sequence: this.sequence,
			eventId: EventId.make(`desktop-aux-project:${this.sequence}:${randomUUID()}`),
			aggregateKind: "project",
			aggregateId: input.projectId,
			occurredAt: input.occurredAt,
			commandId: input.commandId,
			causationEventId: null,
			correlationId: input.commandId,
			metadata: {},
		};
	}

	private async projectCreatedEvent(
		record: StoredProjectRecord,
		commandId: ProjectCommandId | null,
	): Promise<DesktopAuxProjectEvent> {
		return {
			...this.nextEventBase({
				projectId: record.projectId,
				occurredAt: record.createdAt,
				commandId,
			}),
			type: "project.created",
			payload: {
				projectId: record.projectId,
				title: record.title,
				projectRoot: record.projectRoot,
				repositoryIdentity: await this.repositoryIdentity.resolve(record.projectRoot),
				defaultModelSelection: record.defaultModelSelection,
				scripts: record.scripts,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt,
			},
		};
	}

	private async projectMetaUpdatedEvent(
		record: StoredProjectRecord,
		command: ProjectMetaUpdateCommand,
		updatedAt: string,
	): Promise<DesktopAuxProjectEvent> {
		return {
			...this.nextEventBase({
				projectId: record.projectId,
				occurredAt: updatedAt,
				commandId: command.commandId,
			}),
			type: "project.meta-updated",
			payload: {
				projectId: record.projectId,
				...(command.title !== undefined ? { title: command.title } : {}),
				...(command.projectRoot !== undefined ? { projectRoot: command.projectRoot } : {}),
				repositoryIdentity: await this.repositoryIdentity.resolve(record.projectRoot),
				...(command.defaultModelSelection !== undefined
					? { defaultModelSelection: command.defaultModelSelection }
					: {}),
				...(command.scripts !== undefined ? { scripts: command.scripts } : {}),
				updatedAt,
			},
		};
	}

	private async projectMetaUpdatedSnapshotEvent(
		record: StoredProjectRecord,
	): Promise<DesktopAuxProjectEvent> {
		return {
			...this.nextEventBase({
				projectId: record.projectId,
				occurredAt: record.updatedAt,
				commandId: null,
			}),
			type: "project.meta-updated",
			payload: {
				projectId: record.projectId,
				title: record.title,
				projectRoot: record.projectRoot,
				repositoryIdentity: await this.repositoryIdentity.resolve(record.projectRoot),
				defaultModelSelection: record.defaultModelSelection,
				scripts: record.scripts,
				updatedAt: record.updatedAt,
			},
		};
	}

	private projectDeletedEvent(
		projectId: ProjectId,
		commandId: ProjectCommandId | null,
		deletedAt: string,
	): DesktopAuxProjectEvent {
		return {
			...this.nextEventBase({
				projectId,
				occurredAt: deletedAt,
				commandId,
			}),
			type: "project.deleted",
			payload: {
				projectId,
				deletedAt,
			},
		};
	}

	private emit(event: DesktopAuxProjectEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export function createDesktopAuxProjectsService(userDataDir: string): DesktopAuxProjectsService {
	return new DesktopAuxProjectsService(resolveAuxProjectsPath(userDataDir));
}
