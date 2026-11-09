import { afterEach, describe, expect, test, vi } from "vitest";
import { clipKey, longest, pcmOf, seconds, speak, STYLE, TTS_MODEL, VOICE, wavOf } from "@/lib/tts";

// A WAV file with the given chunks: [kind, body].
const riff = (chunks: [string, Uint8Array][]) => {
  const parts = chunks.flatMap(([kind, body]) => {
    const head = new Uint8Array(8);
    head.set([...kind].map((c) => c.charCodeAt(0)));
    new DataView(head.buffer).setUint32(4, body.length, true);
    return [head, body, ...(body.length % 2 ? [new Uint8Array(1)] : [])];
  });
  const out = new Uint8Array(12 + parts.reduce((a, p) => a + p.length, 0));
  out.set([..."RIFF"].map((c) => c.charCodeAt(0)));
  out.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  let at = 12;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const fmt = (channels = 1, rate = 24000, bits = 16) => {
  const b = new Uint8Array(16), v = new DataView(b.buffer);
  v.setUint16(0, 1, true); v.setUint16(2, channels, true); v.setUint32(4, rate, true); v.setUint16(14, bits, true);
  return b;
};

describe("WAV handling", () => {
  test("the PCM is the data chunk only, before or after other chunks", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    expect(pcmOf(riff([["fmt ", fmt()], ["LIST", new Uint8Array(3)], ["data", pcm], ["c2pa", new Uint8Array(9)]]))).toEqual(pcm);
    // bytes that are not RIFF are raw PCM
    expect(pcmOf(new Uint8Array([9, 9]))).toEqual(new Uint8Array([9, 9]));
    expect(pcmOf(new Uint8Array(16))).toEqual(new Uint8Array(16));
    const notWave = riff([["data", pcm]]);
    notWave.set([..."AVI "].map((c) => c.charCodeAt(0)), 8);
    expect(pcmOf(notWave)).toBe(notWave);
  });

  test("a WAV in another format, or with no data, is refused", () => {
    expect(() => pcmOf(riff([["fmt ", fmt(2)], ["data", new Uint8Array(4)]]))).toThrow("not 16-bit mono 24 kHz PCM (1 2 24000 16)");
    expect(() => pcmOf(riff([["data", new Uint8Array(4)]]))).toThrow("(no format)");
    expect(() => pcmOf(riff([["fmt ", fmt()]]))).toThrow("Gemini's WAV has no audio data.");
  });

  test("a plain WAV around the PCM reads back the same", () => {
    const pcm = new Uint8Array(48000).map((_, i) => i % 251);
    const wav = wavOf(pcm);
    expect(wav.length).toBe(44 + 48000);
    expect(pcmOf(wav)).toEqual(pcm);
    expect(seconds(pcm)).toBe(1);
    expect(longest(100)).toBeCloseTo(14);
  });

  test("a clip's key depends on the text, voice, model and style", async () => {
    const a = await clipKey("Hello there."), b = await clipKey("Hello there!");
    expect(a).toMatch(/^clips\/[0-9a-f]{64}\.wav$/);
    expect(a).not.toBe(b);
    expect(await clipKey("Hello there.")).toBe(a);
    expect([TTS_MODEL, VOICE]).toEqual(["gemini-3.8-flash-tts", "Achird"]);
  });
});

describe("speak", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const reply = (status: number, body: unknown) => vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

  test("sends the text as a transcript with the voice and style, and returns a WAV", async () => {
    const pcm = new Uint8Array(4800);
    const fetch = reply(200, { steps: [{}, { content: [{ text: "x" }, { data: b64(riff([["fmt ", fmt()], ["data", pcm]])) }] }] });
    vi.stubGlobal("fetch", fetch);
    const wav = await speak("k", "Hello there.", "https://api.test");
    expect(pcmOf(wav)).toEqual(pcm);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1beta/interactions");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(TTS_MODEL);
    expect(body.input[0].content[0]).toEqual({ type: "text", text: "Hello there.",
      annotations: [{ type: "speech_metadata", style: STYLE }] });
    expect(body.generation_config).toEqual({ speech_config: [{ voice: VOICE }] });
  });

  test("errors, no audio, and a take far too long all throw, so the step retries", async () => {
    vi.stubGlobal("fetch", reply(429, "slow down"));
    await expect(speak("k", "Hi.")).rejects.toThrow("Gemini answered 429: slow down");
    vi.stubGlobal("fetch", reply(200, { steps: [{ content: [{ text: "no audio" }] }] }));
    await expect(speak("k", "Hi.")).rejects.toThrow("Gemini replied without audio.");
    vi.stubGlobal("fetch", reply(200, {}));
    await expect(speak("k", "Hi.")).rejects.toThrow("Gemini replied without audio.");
    vi.stubGlobal("fetch", reply(200, { steps: [{ content: [{ data: b64(new Uint8Array(48000 * 4)) }] }] }));
    await expect(speak("k", "Hi.")).rejects.toThrow("The voice went off script: 4.0 s of audio for 3 characters.");
  });
});
