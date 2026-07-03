import { describe, expect, it } from "vitest";
import type { Effect } from "effect";
import { OpenApi } from "effect/unstable/httpapi";
import type { HttpApiClient } from "effect/unstable/httpapi";
import {
	decodeAuthSnapshot,
	decodeMessage,
	decodeModelCatalog,
	decodePart,
	decodeThreadStreamEvent,
	decodeThreadSummaryEvent,
	HonkApi,
	LoginInput,
	strictDecode,
	type Part,
	type ThreadStreamEvent,
} from "../src/core/v1/index";

const validTextPart = {
	_tag: "text",
	id: "part_1",
	messageId: "msg_1",
	turnId: null,
	origin: "claude-code",
	state: "active",
	text: "hello",
};

const validMessage = {
	id: "msg_1",
	role: "user",
	turnId: null,
	attachments: [],
	error: null,
	createdAt: "2026-07-01T00:00:00Z",
};

const validCatalog = {
	models: [
		{
			id: "openai-codex/gpt-5.5",
			provider: "openai-codex",
			name: "GPT-5.5",
			reasoning: true,
			thinkingLevels: ["low", "high"],
			defaultThinkingLevel: "high",
			contextWindow: 272_000,
			available: false,
		},
	],
	defaultModel: "anthropic/claude-fable-5",
};

const validAuthSnapshot = {
	credentials: [
		{
			kind: "codex-oauth",
			state: "missing",
			label: null,
			message: null,
			updatedAt: "2026-07-01T00:00:00Z",
		},
	],
	harnesses: [{ harness: "claude-code", available: false, detail: null }],
	flow: null,
};

describe("core/v1 decode is fail-closed", () => {
	it("accepts a valid Part", () => {
		const part: Part = decodePart(validTextPart);
		expect(part._tag).toBe("text");
		expect(part.state).toBe("active");
	});

	it("rejects an unmodeled key at the top level", () => {
		expect(() => decodePart({ ...validTextPart, surprise: 1 })).toThrow();
	});

	it("rejects an unmodeled key inside a nested tool state", () => {
		expect(() =>
			decodePart({
				_tag: "tool",
				id: "part_2",
				messageId: "msg_1",
				turnId: null,
				origin: "pi",
				state: "active",
				callId: "call_1",
				tool: "bash",
				toolState: { _tag: "pending", input: {}, surprise: 1 },
				display: { _tag: "bash", command: "ls" },
			}),
		).toThrow();
	});

	it("keeps tool input open-world (sanctioned site)", () => {
		const part = decodePart({
			_tag: "tool",
			id: "part_3",
			messageId: "msg_1",
			turnId: null,
			origin: "pi",
			state: "active",
			callId: "call_1",
			tool: "bash",
			toolState: { _tag: "pending", input: { anything: { goes: true } } },
			display: { _tag: "bash", command: "ls" },
		});
		expect(part._tag).toBe("tool");
	});

	it("rejects an unknown origin", () => {
		expect(() => decodePart({ ...validTextPart, origin: "gemini" })).toThrow();
	});

	it("rejects a Part without lifecycle state", () => {
		const { state: _state, ...missingState } = validTextPart;
		expect(() => decodePart(missingState)).toThrow();
	});

	it("rejects a system role on Message", () => {
		expect(() => decodeMessage({ ...validMessage, role: "system" })).toThrow();
	});

	it("decodes dotted-tag stream events with seq and explicit delta field", () => {
		const event: ThreadStreamEvent = decodeThreadStreamEvent({
			_tag: "part.delta",
			seq: 7,
			partId: "part_1",
			field: "text",
			delta: "more",
		});
		expect(event._tag).toBe("part.delta");
	});

	it("rejects a summary event without workspace seq", () => {
		expect(() =>
			decodeThreadSummaryEvent({ _tag: "thread.removed", threadId: "thread_1" }),
		).toThrow();
	});

	it("rejects a non-ISO timestamp", () => {
		expect(() => decodeMessage({ ...validMessage, createdAt: "06/29/2026" })).toThrow();
	});
});

describe("core/v1 models and auth (ADR 0016)", () => {
	it("accepts a valid catalog", () => {
		const catalog = decodeModelCatalog(validCatalog);
		expect(catalog.models[0]?.provider).toBe("openai-codex");
	});

	it("rejects a fourth provider", () => {
		const model = { ...validCatalog.models[0], provider: "gemini" };
		expect(() => decodeModelCatalog({ ...validCatalog, models: [model] })).toThrow();
	});

	it("rejects empty thinkingLevels — a model with no offered pair is not a model", () => {
		const model = { ...validCatalog.models[0], thinkingLevels: [] };
		expect(() => decodeModelCatalog({ ...validCatalog, models: [model] })).toThrow();
	});

	it("accepts the zero auth snapshot and rejects a dropped credential kind", () => {
		expect(decodeAuthSnapshot(validAuthSnapshot).flow).toBeNull();
		const dropped = { ...validAuthSnapshot.credentials[0], kind: "codex-api-key" };
		expect(() =>
			decodeAuthSnapshot({ ...validAuthSnapshot, credentials: [dropped] }),
		).toThrow();
	});

	it("rejects a login flow for a non-OAuth kind", () => {
		expect(() =>
			decodeAuthSnapshot({
				...validAuthSnapshot,
				flow: {
					kind: "cursor-api-key",
					state: "pending",
					message: null,
					verificationUri: null,
					userCode: null,
					updatedAt: "2026-07-01T00:00:00Z",
				},
			}),
		).toThrow();
	});

	it("makes impossible logins unrepresentable", () => {
		const decodeLoginInput = strictDecode(LoginInput);
		expect(decodeLoginInput({ kind: "codex-oauth" }).kind).toBe("codex-oauth");
		expect(decodeLoginInput({ kind: "cursor-api-key", apiKey: "key_1" }).kind).toBe(
			"cursor-api-key",
		);
		// The api-key kind without its key, and OAuth carrying one, both fail.
		expect(() => decodeLoginInput({ kind: "cursor-api-key" })).toThrow();
		expect(() => decodeLoginInput({ kind: "codex-oauth", apiKey: "key_1" })).toThrow();
	});
});

describe("HonkApi", () => {
	it("derives an OpenAPI document with core/v1-prefixed paths", () => {
		const spec = OpenApi.fromApi(HonkApi);
		const paths = Object.keys(spec.paths);
		expect(paths).toContain("/core/v1/threads");
		expect(paths).toContain("/core/v1/threads/{threadId}/messages");
		expect(paths).toContain("/core/v1/threads/{threadId}/watch");
		expect(paths).toContain("/core/v1/threads/{threadId}/questions/{questionId}/answer");
		expect(paths).toContain("/core/v1/threads/{threadId}/plans/{planId}/implement");
		expect(paths).toContain("/core/v1/threads/{threadId}/attachments/{attachmentId}");
		expect(paths).toContain("/core/v1/models");
		expect(paths).toContain("/core/v1/auth");
		expect(paths).toContain("/core/v1/auth/login");
		expect(paths).toContain("/core/v1/auth/logout");
		expect(paths).toContain("/core/v1/auth/flow");
		expect(paths).toContain("/core/v1/sessions");
		expect(paths).toContain("/core/v1/sessions/{sessionId}");
		expect(paths).toContain("/core/v1/sessions/pairings");
		expect(paths).toContain("/core/v1/sessions/exchange");
	});

	it("type-derives a client with grouped methods", () => {
		type Client = HttpApiClient.ForApi<typeof HonkApi>;
		type SendResult =
			ReturnType<Client["messages"]["send"]> extends Effect.Effect<infer A, infer _E, infer _R>
				? A
				: never;
		const _check: SendResult extends { readonly disposition: string } ? true : never = true;
		expect(_check).toBe(true);
	});
});
