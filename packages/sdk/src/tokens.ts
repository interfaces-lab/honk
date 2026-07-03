export type PromptToken =
	| {
			readonly kind: "text";
			readonly text: string;
	  }
	| {
			readonly kind: "mention";
			readonly path: string;
			readonly raw: string;
	  }
	| {
			readonly kind: "skill";
			readonly name: string;
			readonly path: string | null;
			readonly raw: string;
	  }
	| {
			readonly kind: "inline";
			readonly label: string;
			readonly uri: string;
			readonly raw: string;
	  };

const MENTION_TOKEN_REGEX = /(^|\s)@([^\s@]+)(?=\s)/g;
const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s)/g;
const MARKDOWN_SKILL_TOKEN_REGEX = /(^|\s)\[\$([a-zA-Z0-9][a-zA-Z0-9:_-]*)\]\(([^)]*)\)(?=\s)/g;
const MARKDOWN_INLINE_TOKEN_REGEX = /(^|\s)\[([^\]]+)]\(([^)\s]+)\)(?=\s|$)/g;

type TokenMatch =
	| {
			readonly kind: "mention";
			readonly path: string;
			readonly raw: string;
			readonly start: number;
			readonly end: number;
	  }
	| {
			readonly kind: "skill";
			readonly name: string;
			readonly path: string | null;
			readonly raw: string;
			readonly start: number;
			readonly end: number;
	  }
	| {
			readonly kind: "inline";
			readonly label: string;
			readonly uri: string;
			readonly raw: string;
			readonly start: number;
			readonly end: number;
	  };

const pushTextToken = (tokens: Array<PromptToken>, text: string): void => {
	if (!text) return;
	const last = tokens[tokens.length - 1];
	if (last !== undefined && last.kind === "text") {
		tokens[tokens.length - 1] = { kind: "text", text: last.text + text };
		return;
	}
	tokens.push({ kind: "text", text });
};

const isMarkdownInlineToken = (label: string, sourceUri: string): boolean => {
	if (label.startsWith("$")) return false;
	if (label.startsWith("@")) return true;
	return (
		sourceUri.startsWith("plugin://") ||
		sourceUri.startsWith("tool://") ||
		sourceUri.startsWith("model://") ||
		sourceUri.startsWith("file://") ||
		sourceUri.startsWith("vscode-file://")
	);
};

const collectTokenMatches = (text: string): Array<TokenMatch> => {
	const matches: Array<TokenMatch> = [];

	for (const match of text.matchAll(MENTION_TOKEN_REGEX)) {
		const fullMatch = match[0];
		const prefix = match[1] ?? "";
		const path = match[2] ?? "";
		const matchIndex = match.index ?? 0;
		const start = matchIndex + prefix.length;
		const end = start + fullMatch.length - prefix.length;
		if (path.length > 0) {
			matches.push({ kind: "mention", path, raw: text.slice(start, end), start, end });
		}
	}

	for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
		const fullMatch = match[0];
		const prefix = match[1] ?? "";
		const skillName = match[2] ?? "";
		const matchIndex = match.index ?? 0;
		const start = matchIndex + prefix.length;
		const end = start + fullMatch.length - prefix.length;
		if (skillName.length > 0) {
			matches.push({ kind: "skill", name: skillName, path: null, raw: text.slice(start, end), start, end });
		}
	}

	for (const match of text.matchAll(MARKDOWN_SKILL_TOKEN_REGEX)) {
		const fullMatch = match[0];
		const prefix = match[1] ?? "";
		const skillName = match[2] ?? "";
		const skillPath = match[3] ?? "";
		const matchIndex = match.index ?? 0;
		const start = matchIndex + prefix.length;
		const end = start + fullMatch.length - prefix.length;
		if (skillName.length > 0 && skillPath.length > 0) {
			matches.push({
				kind: "skill",
				name: skillName,
				path: skillPath,
				raw: text.slice(start, end),
				start,
				end,
			});
		}
	}

	for (const match of text.matchAll(MARKDOWN_INLINE_TOKEN_REGEX)) {
		const fullMatch = match[0];
		const prefix = match[1] ?? "";
		const label = match[2] ?? "";
		const sourceUri = match[3] ?? "";
		const matchIndex = match.index ?? 0;
		const start = matchIndex + prefix.length;
		const raw = fullMatch.slice(prefix.length);
		const end = start + raw.length;
		if (isMarkdownInlineToken(label, sourceUri)) {
			matches.push({
				kind: "inline",
				label: label.startsWith("@") ? label.slice(1) : label,
				uri: sourceUri,
				raw,
				start,
				end,
			});
		}
	}

	return matches.toSorted((left, right) => left.start - right.start);
};

export const parsePromptTokens = (text: string): Array<PromptToken> => {
	const tokens: Array<PromptToken> = [];
	if (!text) return tokens;

	const matches = collectTokenMatches(text);
	let cursor = 0;
	for (const match of matches) {
		if (match.start < cursor) continue;
		if (match.start > cursor) {
			pushTextToken(tokens, text.slice(cursor, match.start));
		}

		if (match.kind === "mention") {
			tokens.push({ kind: "mention", path: match.path, raw: match.raw });
		} else if (match.kind === "skill") {
			tokens.push({ kind: "skill", name: match.name, path: match.path, raw: match.raw });
		} else {
			tokens.push({ kind: "inline", label: match.label, uri: match.uri, raw: match.raw });
		}
		cursor = match.end;
	}

	if (cursor < text.length) {
		pushTextToken(tokens, text.slice(cursor));
	}
	return tokens;
};

export const serializeToken = (token: PromptToken): string => {
	switch (token.kind) {
		case "text":
			return token.text;
		case "mention":
			return `@${token.path}`;
		case "skill":
			return token.path === null ? `$${token.name}` : `[$${token.name}](${token.path})`;
		case "inline":
			return token.raw;
	}
};
