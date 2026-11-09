// Files in Workers KV, behind the part of the R2 bucket interface the app uses (put, get with a byte range, head,
// delete), for an account without R2. A value is the file's bytes, with its content type and size as metadata;
// KV holds up to 25 MiB a value, more than a deck, a slide image or a clip needs. Byte ranges are cut from the
// whole value. filesOf() picks R2 when the FILES binding is there, else KV.
type Meta = { contentType?: string; size: number };
type Range = { offset: number; length: number };
export type KvLike = {
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  getWithMetadata<M>(key: string, type: "arrayBuffer"): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
  put(key: string, value: ArrayBuffer, options: { metadata: Meta }): Promise<void>;
  delete(key: string): Promise<void>;
};

// The span a Range header asks for in a file of size bytes ("bytes=2-4", "bytes=7-", "bytes=-3"); null for none.
export const span = (header: string | null, size: number): Range | null => {
  const m = header ? /bytes=(\d*)-(\d*)/.exec(header) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") { const length = Math.min(size, Number(m[2])); return { offset: size - length, length }; }
  const offset = Math.min(Number(m[1]), size), end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return { offset, length: Math.max(0, end - offset + 1) };
};

const bytes = async (body: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string): Promise<ArrayBuffer> => {
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  return new Response(body).arrayBuffer();
};

const object = (key: string, data: ArrayBuffer, meta: Meta, range: Range | null) => {
  const part = range ? data.slice(range.offset, range.offset + range.length) : data;
  return {
    key, size: meta.size, httpEtag: `"${meta.size}-${key.length}"`, httpMetadata: { contentType: meta.contentType },
    range: range ?? undefined,
    body: new Blob([part]).stream(),
    arrayBuffer: async () => part,
  };
};

export const kvFiles = (kv: KvLike) => ({
  async put(key: string, body: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string,
    options?: { httpMetadata?: { contentType?: string } }) {
    const data = await bytes(body);
    await kv.put(key, data, { metadata: { contentType: options?.httpMetadata?.contentType, size: data.byteLength } });
  },
  async get(key: string, options?: { range?: Headers }) {
    const { value, metadata } = await kv.getWithMetadata<Meta>(key, "arrayBuffer");
    if (!value) return null;
    const meta = metadata ?? { size: value.byteLength };
    return object(key, value, meta, span(options?.range?.get("Range") ?? null, meta.size));
  },
  async head(key: string) {
    const { value, metadata } = await kv.getWithMetadata<Meta>(key, "arrayBuffer");
    return value ? { key, size: metadata?.size ?? value.byteLength } : null;
  },
  delete: (key: string) => kv.delete(key),
});

// The file store: R2 when bound, else the KV namespace FILES_KV.
export const filesOf = (env: { FILES?: unknown; FILES_KV?: unknown }): R2Bucket =>
  (env.FILES ?? kvFiles(env.FILES_KV as KvLike)) as R2Bucket;
