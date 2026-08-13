const textEncoder = new TextEncoder();
let nodeCrypto: typeof import('crypto') | null | undefined = undefined;

async function getNodeCrypto() {
  if (nodeCrypto !== undefined) return nodeCrypto;
  if (typeof window === 'undefined') {
    nodeCrypto = await import('crypto');
  } else {
    nodeCrypto = null;
  }
  return nodeCrypto;
}

function bytesToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const cryptoLib = await getNodeCrypto();
  if (cryptoLib) {
    const digest = await cryptoLib.webcrypto.subtle.digest('SHA-256', data);
    return new Uint8Array(digest);
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256Bytes(textEncoder.encode(value));
  return bytesToHex(digest);
}

export async function hmacSha256(key: string, message: string): Promise<Uint8Array> {
  const keyBytes = textEncoder.encode(key);
  const msgBytes = textEncoder.encode(message);
  const cryptoLib = await getNodeCrypto();
  if (cryptoLib) {
    const hmac = cryptoLib.createHmac('sha256', keyBytes);
    hmac.update(msgBytes);
    return new Uint8Array(hmac.digest());
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return new Uint8Array(signature);
}

export async function serverSeedId(): Promise<string> {
  const array = new Uint8Array(16);
  const cryptoLib = await getNodeCrypto();
  if (cryptoLib) {
    cryptoLib.webcrypto.getRandomValues(array);
  } else {
    crypto.getRandomValues(array);
  }
  return bytesToHex(array);
}

export async function newSeed(): Promise<string> {
  const array = new Uint8Array(32);
  const cryptoLib = await getNodeCrypto();
  if (cryptoLib) {
    cryptoLib.webcrypto.getRandomValues(array);
  } else {
    crypto.getRandomValues(array);
  }
  return bytesToHex(array);
}

export function bytesToFloat(bytes: Uint8Array, offset = 0): number {
  const x0 = bytes[offset] / 256;
  const x1 = bytes[offset + 1] / 65536;
  const x2 = bytes[offset + 2] / 16777216;
  const x3 = bytes[offset + 3] / 4294967296;
  return x0 + x1 + x2 + x3;
}

export async function rngBytes(serverSeed: string, clientSeed: string, nonce: number, cursor = 0): Promise<Uint8Array> {
  const message = `${clientSeed}:${nonce}:${cursor}`;
  return await hmacSha256(serverSeed, message);
}

export async function rngFloat(serverSeed: string, clientSeed: string, nonce: number, cursor = 0): Promise<number> {
  const bytes = await rngBytes(serverSeed, clientSeed, nonce, cursor);
  return bytesToFloat(bytes, 0);
}

export async function rngFloatStream(serverSeed: string, clientSeed: string, nonce: number, count: number): Promise<number[]> {
  const values: number[] = [];
  let cursor = 0;
  while (values.length < count) {
    const bytes = await rngBytes(serverSeed, clientSeed, nonce, cursor);
    for (let i = 0; i + 4 <= bytes.length && values.length < count; i += 4) {
      values.push(bytesToFloat(bytes, i));
    }
    cursor += 1;
  }
  return values;
}
