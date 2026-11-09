// The trainer's state and actions in the browser, for the one-slide-at-a-time flow (lib/flow.ts): what to say
// next, recording an attempt for the judge, the verdict on the same card, Hear it, and keeping the progress in
// localStorage and online. The React component renders it and calls its actions; it says when to render again
// through subscribe().
//
// One attempt at a time: tap to speak, tap to stop (or the recogniser hears the last words), then "Checking..."
// while the judge works, then the verdict on the card just said. The progress moves when the verdict arrives.

import { clipsOf, type Item, migrate, mustOf, next, record, summary, textOf } from "@/lib/flow";
import { grade } from "@/lib/grade";
import { judged, type Verdict } from "@/lib/judge";
import { merge, ymd } from "@/lib/schedule";
import { sentences } from "@/lib/text";
import { heardAll, type Judged, type Script, type Sync } from "@/lib/train";

export type Screen = "home" | "session" | "done";
// ready: nothing said yet; listening: recording; checking: the judge has the attempt; judged: the verdict is in;
// shown: the words are shown, to mark yourself; failed: the judge could not answer, so mark yourself.
export type Phase = "ready" | "listening" | "checking" | "judged" | "shown" | "failed";

type SpeechResults = ArrayLike<ArrayLike<{ transcript: string }>>;
type SpeechRec = { lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: { results: SpeechResults }) => void) | null; onerror: (() => void) | null; start(): void; abort(): void };
type SpeechCtor = new () => SpeechRec;

// The longest attempt: a whole slide said slowly.
const LONGEST = 180000;
// Opus at 16 kbps: a smaller upload, and the judge hears it as well as at 24.
const BITRATE = 16000;

export class Engine {
  screen: Screen = "home";
  item: Item | null = null;
  phase: Phase = "ready";
  result: Judged | null = null;
  // How the attempt on screen was counted (the judge's pass, or the speaker's own mark), and the progress entries
  // it replaced, so it can be counted the other way.
  counted: boolean | null = null;
  private before: Record<string, unknown> = {};
  note = "";
  sync: { state: Sync; at: number } = { state: "", at: 0 };
  blocked = false;
  // The time of the last update, for the screens to count from.
  now = Date.now();
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private rec: { media: MediaRecorder; stream: MediaStream; speech: SpeechRec | null; cap?: ReturnType<typeof setTimeout>;
    done?: (blob: Blob) => void } | null = null;
  private audio: HTMLAudioElement | null = null;

  constructor(readonly script: Script, private readonly fetcher: typeof fetch = (...a) => fetch(...a)) {}

  get slides() { return this.script.slides; }

  // Rendering: a version that changes on each update, for useSyncExternalStore.
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.version;
  private emit() { this.now = Date.now(); this.version += 1; this.listeners.forEach((fn) => fn()); }

  // Storage: this talk's keys in localStorage.
  private get prefix() { return `talk-trainer:${this.script.talk.id}:`; }
  get = <T>(k: string, d: T): T => {
    try { const v = localStorage.getItem(this.prefix + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  };
  set(k: string, v: unknown) { try { localStorage.setItem(this.prefix + k, JSON.stringify(v)); } catch { /* private mode */ } }
  private remove(k: string) { try { localStorage.removeItem(this.prefix + k); } catch { /* private mode */ } }
  items(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i) as string;
      if (k.startsWith(`${this.prefix}train:`) || k.startsWith(`${this.prefix}flow:`)) {
        out[k.slice(this.prefix.length)] = JSON.parse(localStorage.getItem(k) as string);
      }
    }
    return out;
  }
  absorb(items: Record<string, unknown>) {
    Object.entries(merge(this.items(), items)).forEach(([k, v]) => this.set(k, v));
    this.emit();
  }
  // Progress from the earlier trainer, once: its well-known slides count as learned.
  private migrateOnce() {
    const items = this.items();
    if (Object.keys(items).some((k) => k.startsWith("flow:"))) return;
    Object.entries(migrate(this.slides, items)).forEach(([k, v]) => this.set(k, v));
  }

  get talkAt() { return this.script.talk.talkAt; }
  get micOn() {
    return !this.blocked && this.get("train:mic", true) && typeof navigator !== "undefined"
      && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }
  setMic(on: boolean) { this.set("train:mic", on); this.blocked = false; this.emit(); }
  summary() { return summary(this.slides, this.get, this.now); }

  show(screen: Screen) {
    this.halt();
    this.screen = screen;
    this.emit();
  }
  // Start, or carry on: the next thing to say.
  start() {
    this.go();
    this.show(this.item ? "session" : "done");
  }
  // After a verdict: the next thing to say, or the done screen when everything is learned.
  go() {
    this.halt();
    this.item = next(this.slides, this.get, Date.now());
    Object.assign(this, { phase: "ready", result: null, counted: null, note: "", before: {} });
    if (!this.item && this.screen === "session") this.screen = "done";
    this.emit();
  }

  // Count the attempt on screen: the flow moves on, and the day goes into the practice record.
  private count(pass: boolean) {
    const item = this.item as Item, now = Date.now(), day = ymd(now);
    Object.entries(this.before).forEach(([k, v]) => (v === undefined ? this.remove(k) : this.set(k, v)));
    const entries = record(item, pass, this.get, now);
    this.before = Object.fromEntries(Object.keys(entries).map((k) => [k, this.get<unknown>(k, undefined)]));
    Object.entries(entries).forEach(([k, v]) => this.set(k, v));
    const dates = this.get<string[]>("train:days", []);
    if (!dates.includes(day)) this.set("train:days", dates.concat(day));
    this.counted = pass;
    this.pushSoon();
  }
  // Count the attempt on screen the other way ("Count it as got").
  recount(pass: boolean) {
    if (this.phase !== "judged" || this.counted === pass) return;
    this.count(pass);
    this.emit();
  }
  // Marking yourself, without the judge: the attempt counts, then on to the next.
  mark(pass: boolean) {
    if (this.screen !== "session" || !this.item || (this.phase !== "shown" && this.phase !== "failed")) return;
    this.count(pass);
    this.go();
  }
  reveal() {
    if (!this.item || this.phase !== "ready") return;
    this.halt();
    this.phase = "shown";
    this.emit();
  }

  // The big button, and Space: start, speak, stop, or go on after the verdict.
  space() {
    if (this.screen !== "session") { this.start(); return; }
    if (this.phase === "listening") this.stop();
    else if (this.phase === "ready") { if (this.micOn) void this.speak(); else this.reveal(); }
    else if (this.phase === "judged") this.go();
  }

  // Record an attempt. It stops on a tap, or once the browser's recogniser (where there is one) has heard the last
  // words of the text. There is no stop on a pause: the speaker may be recalling.
  async speak() {
    if (!this.item || this.phase !== "ready") return;
    this.halt();
    Object.assign(this, { phase: "listening", result: null, note: "" });
    this.emit();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      Object.assign(this, { blocked: true, phase: "ready",
        note: "The microphone is blocked, so mark yourself: say it, tap Show the words, then Got it or Missed." });
      this.emit();
      return;
    }
    if ((this.phase as Phase) !== "listening") { stream.getTracks().forEach((t) => t.stop()); return; }
    const item = this.item, chunks: Blob[] = [], parts = sentences(textOf(item.unit)), must = mustOf(item.unit);
    const opus = "audio/webm;codecs=opus";
    const media = new MediaRecorder(stream, { audioBitsPerSecond: BITRATE,
      ...(MediaRecorder.isTypeSupported?.(opus) ? { mimeType: opus } : {}) });
    const rec: NonNullable<Engine["rec"]> = { media, stream, speech: null };
    media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    media.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      rec.done?.(new Blob(chunks, { type: media.mimeType || "audio/webm" }));
    };
    media.start();
    this.rec = rec;
    rec.cap = setTimeout(() => this.stop(), LONGEST);
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Speech = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (Speech) {
      try {
        const speech = new Speech();
        Object.assign(speech, { lang: "en-GB", continuous: true, interimResults: true, maxAlternatives: 5 });
        speech.onresult = (e) => {
          if (heardAll(parts, Array.from(e.results, (r) => Array.from(r, (a) => a.transcript)), must)) this.stop();
        };
        speech.onerror = () => {};
        speech.start();
        rec.speech = speech;
      } catch { /* no recognition: a tap stops */ }
    }
  }

  // Stop recording and send the attempt to the judge; the card says "Checking..." until the verdict comes.
  stop() {
    if (this.phase !== "listening") return;
    const rec = this.rec, item = this.item as Item;
    if (!rec) {
      // stopped before the microphone was ready: nothing was recorded
      Object.assign(this, { phase: "ready", note: "Nothing was recorded. Tap to speak again." });
      this.halt();
      this.emit();
      return;
    }
    this.phase = "checking";
    rec.done = (blob) => void this.ask(item, blob);
    this.endRecording(true);
    this.emit();
  }
  private endRecording(keep: boolean) {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    clearTimeout(rec.cap);
    try { rec.speech?.abort(); } catch { /* already stopped */ }
    if (rec.media.state !== "inactive") {
      if (!keep) rec.media.onstop = () => rec.stream.getTracks().forEach((t) => t.stop());
      rec.media.stop();
    }
  }

  // The judge: the recording, the text, the talk's names and the must-say items go to /api/grade, which asks
  // Gemini whether the meaning came through (lib/judge judged).
  private async ask(item: Item, blob: Blob) {
    const parts = sentences(textOf(item.unit)), must = mustOf(item.unit);
    try {
      if (!blob.size) throw new Error("Nothing was recorded.");
      const audio = await base64(blob);
      const res = await this.fetcher("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "card", audio, mime: blob.type.split(";")[0], target: parts.join(" "),
          glossary: this.script.talk.glossary, must }) });
      const body = await res.json().catch(() => ({})) as Verdict & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `The judge answered ${res.status}.`);
      if (this.item !== item) return;
      this.result = judged(grade(parts, "", must), body);
      this.count(this.result.pass);
      this.phase = "judged";
    } catch (err) {
      if (this.item !== item) return;
      Object.assign(this, { phase: "failed", note: `${(err as Error).message} Try again, or mark yourself.` });
    }
    this.emit();
  }
  // Try the same step again after the judge could not answer.
  retry() {
    if (this.phase !== "failed") return;
    Object.assign(this, { phase: "ready", note: "" });
    void this.speak();
  }

  // Hear it: the clips of what is to be said, one after another.
  hear() {
    const clips = this.item ? clipsOf(this.item.unit) : null;
    if (this.screen !== "session" || !clips || this.phase === "listening") return;
    this.quiet();
    const audio = (this.audio ??= new Audio());
    let i = 0;
    const play = () => {
      audio.src = clips[i];
      audio.play().catch(() => this.quiet());
    };
    audio.onended = () => { i += 1; if (i < clips.length) play(); else this.quiet(); };
    play();
  }
  private quiet() {
    if (this.audio) { this.audio.onended = null; this.audio.pause(); }
  }

  // Stop anything under way: a recording (thrown away) and Hear it.
  halt() {
    if (this.phase === "listening") this.phase = "ready";
    this.endRecording(false);
    this.quiet();
  }

  // Progress online, per talk: merged with this browser's on opening, saved a few seconds after each attempt, and
  // at once (keepalive) when the page goes away.
  private url() { return `/api/talks/${this.script.talk.id}/progress`; }
  async pull() {
    try {
      const res = await this.fetcher(this.url(), { cache: "no-store" });
      if (!res.ok) throw new Error();
      this.absorb((await res.json() as { items: Record<string, unknown> }).items);
      this.migrateOnce();
      await this.push();
    } catch {
      this.migrateOnce();
      this.sync.state = "error";
      this.emit();
    }
  }
  async push(keepalive = false) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.sync.state = "saving";
    try {
      const res = await this.fetcher(this.url(), { method: "PUT", keepalive, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: this.items() }) });
      if (!res.ok) throw new Error();
      this.absorb((await res.json() as { items: Record<string, unknown> }).items);
      this.sync = { state: "on", at: Date.now() };
    } catch {
      this.sync.state = "error";
    }
    this.emit();
  }
  pushSoon() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.push(), 3000); }

  // The page goes away: anything waiting is saved at once. An attempt is counted when its verdict arrives, so
  // nothing else is needed.
  pagehide() {
    if (this.timer) void this.push(true);
  }
}

const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("The recording could not be read."));
  r.readAsDataURL(blob);
});
