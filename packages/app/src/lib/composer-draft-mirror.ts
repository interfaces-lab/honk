let buf = "";

export function pushComposerDraft(text: string) {
  buf = text;
}

export function peekComposerDraft() {
  return buf;
}
