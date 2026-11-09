import { describe, expect, it } from "vitest";
import { filesOf, kvFiles, span, type KvLike } from "@/lib/kvfiles";

const memory = () => {
  const m = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  const kv: KvLike = {
    get: async (k) => m.get(k)?.value ?? null,
    getWithMetadata: async <M,>(k: string) => ({ value: m.get(k)?.value ?? null, metadata: (m.get(k)?.metadata ?? null) as M | null }),
    put: async (k, value, { metadata }) => { m.set(k, { value, metadata }); },
    delete: async (k) => { m.delete(k); },
  };
  return { m, kv };
};
const text = async (o: { body: ReadableStream } | null) => new TextDecoder().decode(await new Response(o!.body).arrayBuffer());

describe("files in KV", () => {
  it("cuts the span a Range header asks for", () => {
    expect(span("bytes=2-4", 10)).toEqual({ offset: 2, length: 3 });
    expect(span("bytes=7-", 10)).toEqual({ offset: 7, length: 3 });
    expect(span("bytes=8-99", 10)).toEqual({ offset: 8, length: 2 });
    expect(span("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
    expect(span("bytes=-30", 10)).toEqual({ offset: 0, length: 10 });
    expect(span("bytes=12-", 10)).toEqual({ offset: 10, length: 0 });
    expect([span(null, 10), span("items=1-2", 10), span("bytes=-", 10)]).toEqual([null, null, null]);
  });

  it("puts bytes, views, strings and streams, and gets them back whole or in part", async () => {
    const { m, kv } = memory();
    const files = kvFiles(kv);
    await files.put("a", new TextEncoder().encode("abcdefghij"), { httpMetadata: { contentType: "text/plain" } });
    await files.put("b", new TextEncoder().encode("xyz").buffer);
    await files.put("c", "hello");
    await files.put("d", new Blob(["blob"]).stream());
    expect(m.get("a")!.metadata).toEqual({ contentType: "text/plain", size: 10 });
    const a = await files.get("a");
    expect([a!.size, a!.httpMetadata.contentType, a!.range, await text(a)]).toEqual([10, "text/plain", undefined, "abcdefghij"]);
    const part = await files.get("a", { range: new Headers({ Range: "bytes=2-4" }) });
    expect([part!.range, await text(part), new TextDecoder().decode(await part!.arrayBuffer())]).toEqual([{ offset: 2, length: 3 }, "cde", "cde"]);
    expect(await text(await files.get("a", { range: new Headers() }))).toBe("abcdefghij");
    expect([await text(await files.get("b")), await text(await files.get("c")), await text(await files.get("d"))]).toEqual(["xyz", "hello", "blob"]);
    expect(await files.get("gone")).toBeNull();
  });

  it("heads, deletes, and copes with a value stored without metadata", async () => {
    const { m, kv } = memory();
    const files = kvFiles(kv);
    await files.put("a", "abc");
    expect(await files.head("a")).toEqual({ key: "a", size: 3 });
    m.set("bare", { value: new TextEncoder().encode("12345").buffer, metadata: null });
    expect(await files.head("bare")).toEqual({ key: "bare", size: 5 });
    expect((await files.get("bare"))!.size).toBe(5);
    await files.delete("a");
    expect([await files.head("a"), await files.get("a")]).toEqual([null, null]);
  });

  it("uses R2 when it is bound, else KV", () => {
    const r2 = { r2: true };
    expect(filesOf({ FILES: r2, FILES_KV: {} })).toBe(r2);
    expect(typeof filesOf({ FILES_KV: memory().kv }).put).toBe("function");
  });
});
