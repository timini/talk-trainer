// The voice for each sentence: Gemini text to speech, through the interactions endpoint, which reads the text as a
// transcript. Gemini returns a WAV file; its 16-bit PCM is kept and wrapped in a plain WAV header, so a browser can
// play it with no conversion. Clips are keyed by a hash of what decides the sound, so the same sentence is voiced
// once, whichever talk or upload it comes from.

export const TTS_MODEL = "gemini-3.8-flash-tts";
export const VOICE = "Achird";
export const STYLE = "a calm, clear conference speaker";
export const API = "https://generativelanguage.googleapis.com";
// Gemini's audio: 16-bit little-endian PCM, mono, 24 kHz.
const RATE = 24000;

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

// The R2 key of a sentence's clip.
export const clipKey = async (text: string) =>
  `clips/${await sha256(JSON.stringify(["gemini-interactions", text, TTS_MODEL, VOICE, STYLE]))}.wav`;

// The longest a clip may be, in seconds: 0.11 s a character plus 3 s. Normal speech runs 0.06 to 0.08 s a
// character; a voice that answers the text instead of reading it runs far longer.
export const longest = (characters: number) => characters * 0.11 + 3;

const text4 = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

// The PCM in a WAV file: the "data" chunk only, so the header and any provenance chunk after it are not played.
// Bytes that are not RIFF are taken as raw PCM.
export const pcmOf = (wav: Uint8Array): Uint8Array => {
  if (wav.length < 12 || text4(wav, 0) !== "RIFF" || text4(wav, 8) !== "WAVE") return wav;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let format = "";
  for (let at = 12; at + 8 <= wav.length;) {
    const kind = text4(wav, at), size = view.getUint32(at + 4, true), body = at + 8;
    if (kind === "fmt ") {
      format = [view.getUint16(body, true), view.getUint16(body + 2, true), view.getUint32(body + 4, true),
        view.getUint16(body + 14, true)].join(" ");
    } else if (kind === "data") {
      if (format !== `1 1 ${RATE} 16`) throw new Error(`Gemini's WAV is not 16-bit mono 24 kHz PCM (${format || "no format"}).`);
      return wav.subarray(body, Math.min(body + size, wav.length));
    }
    at = body + size + (size % 2);
  }
  throw new Error("Gemini's WAV has no audio data.");
};

// A WAV file around 16-bit mono 24 kHz PCM.
export const wavOf = (pcm: Uint8Array): Uint8Array => {
  const out = new Uint8Array(44 + pcm.length), view = new DataView(out.buffer);
  const put = (at: number, s: string) => [...s].forEach((c, k) => { out[at + k] = c.charCodeAt(0); });
  put(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  put(8, "WAVE");
  put(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
};

export const seconds = (pcm: Uint8Array) => pcm.length / (RATE * 2);

// One sentence voiced: a WAV file. A failed request or a take far too long for its text throws, and the build step
// that asked tries again.
export const speak = async (key: string, text: string, api = API): Promise<Uint8Array> => {
  const res = await fetch(`${api}/v1beta/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: STYLE }] }] }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: VOICE }] },
    }),
  });
  if (!res.ok) throw new Error(`Gemini answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { steps = [] } = (await res.json()) as { steps?: { content?: { data?: string }[] }[] };
  const data = steps.flatMap((s) => s.content ?? []).find((c) => c.data)?.data;
  if (!data) throw new Error("Gemini replied without audio.");
  const pcm = pcmOf(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
  if (seconds(pcm) > longest(text.length)) {
    throw new Error(`The voice went off script: ${seconds(pcm).toFixed(1)} s of audio for ${text.length} characters.`);
  }
  return wavOf(pcm);
};
