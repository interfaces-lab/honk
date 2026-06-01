import type * as EffectAcpSchema from "effect-acp/schema";

export function textToAcpContentBlock(text: string): EffectAcpSchema.ContentBlock | undefined {
  return text.length > 0 ? { type: "text", text } : undefined;
}

export function imageBytesToAcpContentBlock(input: {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}): EffectAcpSchema.ContentBlock {
  return {
    type: "image",
    data: Buffer.from(input.bytes).toString("base64"),
    mimeType: input.mimeType,
  };
}

export function compactAcpContentBlocks(
  blocks: ReadonlyArray<EffectAcpSchema.ContentBlock | undefined>,
): EffectAcpSchema.ContentBlock[] {
  return blocks.filter((block): block is EffectAcpSchema.ContentBlock => block !== undefined);
}
