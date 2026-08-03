// expo-crypto has no HMAC primitive, so each platform supplies only a SHA-256 digest.

export type Sha256Digest = (message: Uint8Array) => Promise<Uint8Array>;

export async function hmacSha256(
  digest: Sha256Digest,
  key: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  const normalizedKey = key.length > 64 ? await digest(key) : key;
  const keyBlock = new Uint8Array(64);
  keyBlock.set(normalizedKey);
  const inner = new Uint8Array(64 + message.length);
  inner.set(keyBlock.map((byte) => byte ^ 0x36));
  inner.set(message, 64);
  const innerDigest = await digest(inner);
  const outer = new Uint8Array(64 + innerDigest.length);
  outer.set(keyBlock.map((byte) => byte ^ 0x5c));
  outer.set(innerDigest, 64);
  return digest(outer);
}

export async function hmacSha256Hex(
  digest: Sha256Digest,
  key: string,
  message: string,
): Promise<string> {
  return bytesToHex(await hmacSha256(digest, utf8ToBytes(key), utf8ToBytes(message)));
}

export function utf8ToBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined) continue;
    if (point <= 0x7f) {
      bytes.push(point);
      continue;
    }
    if (point <= 0x7ff) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      continue;
    }
    if (point <= 0xffff) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      continue;
    }
    bytes.push(
      0xf0 | (point >> 18),
      0x80 | ((point >> 12) & 0x3f),
      0x80 | ((point >> 6) & 0x3f),
      0x80 | (point & 0x3f),
    );
  }
  return new Uint8Array(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
