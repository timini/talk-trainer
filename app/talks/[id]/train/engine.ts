// The trainer's state and actions in the browser: today's plan, the card on screen, recording an attempt for the
// judge, Hear it, marking cards, and keeping the progress in localStorage and online. The React component renders
// it and calls its actions; it says when to render again through subscribe().

import { grade } from "@/lib/grade";
import { judged, type Verdict } from "@/lib/judge";
import { type Card, logged, merge, plan, review, ymd } from "@/lib/schedule";
import { chainStart } from "@/lib/text";
import { cardsOf, type Judged, type Script, type Sync, type TrainCard, view } from "@/lib/train";

export type Screen = "home" | "session" | "done" | "stats";
// ready: nothing said yet; listening: recording; judging: the judge has the attempt; graded: the verdict is in;
// shown: the words are shown, to mark yourself; failed: the judge could not answer, so mark yourself.
export type Phase = "ready" | "listening" | "judging" | "graded" | "shown" | "failed";

type SpeechRec = { lang: string; continuous: boolean; interimResults: boolean; onresult: (() => void) | null;
  onerror: (() => void) | null; start(): void; abort(): void };
type SpeechCtor = new () => SpeechRec;

const QUIET = 2500;
const LONGEST = 90000;

export class Engine {
  readonly cards: TrainCard[];
  screen: Screen = "home";
  card: TrainCard | null = null;
  queue = 0;
  phase: Phase = "ready";
  result: Judged | null = null;
  note = "";
  session = { done: 0, got: 0, missed: 0, top: 0, extra: 0, seen: new Set<string>() };
  sync: { state: Sync; at: number } = { state: "", at: 0 };
  blocked = false;
  playing = false;
  // The time of the last update, for the screens to count from.
  now = Date.now();
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private rec: { media: MediaRecorder; stream: MediaStream; speech: SpeechRec | null; quiet?: ReturnType<typeof setTimeout>;
    cap?: ReturnType<typeof setTimeout> } | null = null;
  private audio: HTMLAudioElement | null = null;

  constructor(readonly script: Script, private readonly fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.cards = cardsOf(script.slides);
  }

  // Rendering: a version that changes on each update, for useSyncExternalStore.
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.version;
  private emit() { this.now = Date.now(); this.version += 1; this.listeners.forEach((fn) => fn()); }

  // Storage: this talk's keys in localStorage.
  private get prefix() { return `talk-trainer:${this.script.talk.id}:`; }
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(this.prefix + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  }
  set(k: string, v: unknown) { try { localStorage.setItem(this.prefix + k, JSON.stringify(v)); } catch { /* private mode */ } }
  items(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i) as string;
      if (k.startsWith(`${this.prefix}train:`)) out[k.slice(this.prefix.length)] = JSON.parse(localStorage.getItem(k) as string);
    }
    return out;
  }
  absorb(items: Record<string, unknown>) {
    Object.entries(merge(this.items(), items)).forEach(([k, v]) => this.set(k, v));
    this.emit();
  }

  state = (c: TrainCard) => this.get<Card | null>(c.key, null);
  level = (c: TrainCard) => this.state(c)?.level ?? null;
  get talkAt() { return this.script.talk.talkAt; }
  setTalkAt(t: number | null) { this.script.talk.talkAt = t; this.emit(); }
  get micOn() {
    return !this.blocked && this.get("train:mic", true) && typeof navigator !== "undefined"
      && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }
  setMic(on: boolean) { this.set("train:mic", on); this.blocked = false; this.emit(); }

  planNow(now = Date.now()) {
    return plan(this.cards.map((c) => ({ ...c, state: this.state(c), pick: true })), now, this.talkAt ?? now, this.session.extra);
  }
  view() { return this.card ? view(this.cards, this.card, this.level, chainStart) : null; }

  show(screen: Screen) {
    this.halt();
    this.screen = screen;
    this.emit();
  }

  // A session: today's plan, one card at a time, until nothing is due. A missed card comes back in it.
  start(extra = 0) {
    if (!this.talkAt) return;
    Object.assign(this.session, { done: 0, got: 0, missed: 0, extra, top: this.planNow().top, seen: new Set() });
    this.next();
    this.show(this.card ? "session" : "home");
  }
  private next() {
    this.halt();
    const p = this.planNow();
    this.card = p.queue[0] ?? null;
    this.queue = p.queue.length;
    Object.assign(this, { phase: "ready", result: null, note: "" });
  }
  finish() {
    this.halt();
    this.session.extra = 0;
    this.show("done");
  }

  // Mark the card and go on. The day goes into the practice record, for the streak.
  mark(pass: boolean) {
    const c = this.card;
    if (this.screen !== "session" || !c || !["graded", "shown", "failed"].includes(this.phase)) return;
    const now = Date.now(), day = ymd(now);
    this.set(c.key, review(this.state(c), pass, now, this.talkAt ?? now, this.result ? this.result.acc : null));
    const dates = this.get<string[]>("train:days", []);
    if (!dates.includes(day)) this.set("train:days", dates.concat(day));
    this.set(`train:log:${day}`, logged(this.get(`train:log:${day}`, null), pass));
    this.session.done += 1;
    this.session[pass ? "got" : "missed"] += 1;
    this.session.seen.add(c.key);
    this.set("train:last", { at: now, done: this.session.done, got: this.session.got });
    this.pushSoon();
    this.next();
    if (this.card) this.emit();
    else this.finish();
  }

  reveal() {
    if (!this.card || this.phase !== "ready") return;
    this.halt();
    this.phase = "shown";
    this.emit();
  }

  // Space: speak, stop, or show the words without the microphone.
  space() {
    if (this.screen === "home") { this.start(); return; }
    if (this.screen !== "session") return;
    if (this.phase === "listening") this.stop();
    else if (this.phase === "ready") { if (this.micOn) void this.speak(); else this.reveal(); }
  }
  // Enter: go on.
  enter() {
    if (this.screen === "session" && this.phase === "graded" && this.result) this.mark(this.result.pass);
    else if (this.screen === "done") this.show("home");
    else if (this.screen === "home") this.start();
  }

  // Record an attempt. The browser's speech recognition, where there is one, only stops the recording after 2.5
  // seconds of quiet; a tap stops it anywhere. The judge grades the recording.
  async speak() {
    if (!this.card || this.phase === "listening" || this.phase === "judging") return;
    this.halt();
    Object.assign(this, { phase: "listening", result: null, note: "" });
    this.emit();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      Object.assign(this, { blocked: true, phase: "ready",
        note: "The microphone is blocked, so mark yourself: say it, tap Show, then Got it or Missed." });
      this.emit();
      return;
    }
    if ((this.phase as Phase) !== "listening") {
      // stopped before the microphone was ready: nothing was recorded
      stream.getTracks().forEach((t) => t.stop());
      if ((this.phase as Phase) === "judging") {
        Object.assign(this, { phase: "ready", note: "Nothing was recorded. Tap to speak again." });
        this.emit();
      }
      return;
    }
    const key = (this.card as TrainCard).key, chunks: Blob[] = [];
    const media = new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
    media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    media.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (this.card?.key === key && this.phase === "judging") void this.ask(key, new Blob(chunks, { type: media.mimeType || "audio/webm" }));
    };
    media.start();
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Speech = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const rec: NonNullable<Engine["rec"]> = { media, stream, speech: null };
    this.rec = rec;
    rec.cap = setTimeout(() => this.stop(), LONGEST);
    if (Speech) {
      try {
        const speech = new Speech();
        Object.assign(speech, { lang: "en-GB", continuous: true, interimResults: true });
        speech.onresult = () => { clearTimeout(rec.quiet); rec.quiet = setTimeout(() => this.stop(), QUIET); };
        speech.onerror = () => {};
        speech.start();
        rec.speech = speech;
      } catch { /* no recognition: a tap stops */ }
    }
  }

  // Stop recording and send the attempt to the judge.
  stop() {
    if (this.phase !== "listening") return;
    this.phase = "judging";
    this.endRecording(true);
    this.emit();
  }
  private endRecording(keep: boolean) {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return;
    clearTimeout(rec.quiet);
    clearTimeout(rec.cap);
    try { rec.speech?.abort(); } catch { /* already stopped */ }
    if (rec.media.state !== "inactive") {
      if (!keep) rec.media.onstop = () => rec.stream.getTracks().forEach((t) => t.stop());
      rec.media.stop();
    }
  }

  // The judge: the recording, the sentences and the talk's names go to /api/grade, which asks Gemini. Its verdict
  // decides the card by the 85% rule (lib/judge judged); while it works, no verdict is shown.
  private async ask(key: string, blob: Blob) {
    const v = this.view() as NonNullable<ReturnType<Engine["view"]>>;
    try {
      if (!blob.size) throw new Error("Nothing was recorded. Tap to speak again.");
      const audio = await base64(blob);
      const res = await this.fetcher("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "card", audio, mime: blob.type.split(";")[0], target: v.parts.join(" "),
          glossary: this.script.talk.glossary }) });
      const body = await res.json().catch(() => ({})) as Verdict & { error?: string };
      if (!res.ok) throw new Error(`${body.error ?? `The judge answered ${res.status}.`} Try again, or mark yourself.`);
      if (this.card?.key !== key) return;
      Object.assign(this, { result: judged(grade(v.parts, "", v.must), body), phase: "graded" });
    } catch (err) {
      if (this.card?.key !== key) return;
      Object.assign(this, { phase: "failed", note: (err as Error).message });
    }
    this.emit();
  }

  // Hear it: the card's clips, one after another (a chain card plays the whole chain).
  hear() {
    const v = this.view();
    if (this.screen !== "session" || !v?.clips || this.phase === "listening") return;
    this.quiet();
    const clips = v.clips, audio = (this.audio ??= new Audio());
    let i = 0;
    const play = () => {
      audio.src = clips[i];
      audio.play().catch(() => this.quiet());
    };
    audio.onended = () => { i += 1; if (i < clips.length) play(); else this.quiet(); };
    this.playing = true;
    play();
    this.emit();
  }
  private quiet() {
    if (this.audio) { this.audio.onended = null; this.audio.pause(); }
    if (this.playing) { this.playing = false; this.emit(); }
  }

  // Stop anything under way: a recording (thrown away) and Hear it.
  halt() {
    if (this.phase === "listening") this.phase = "ready";
    this.endRecording(false);
    this.quiet();
  }

  // Progress online, per talk: merged with this browser's on opening, saved a few seconds after each card, and at
  // once (keepalive) when the page goes away.
  private url() { return `/api/talks/${this.script.talk.id}/progress`; }
  async pull() {
    try {
      const res = await this.fetcher(this.url(), { cache: "no-store" });
      if (!res.ok) throw new Error();
      this.absorb((await res.json() as { items: Record<string, unknown> }).items);
      await this.push();
    } catch {
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

  // The page goes away: a card with a verdict counts as marked, and anything waiting is saved at once.
  pagehide() {
    if (this.screen === "session" && this.phase === "graded" && this.result) this.mark(this.result.pass);
    if (this.timer) void this.push(true);
  }
}

const base64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
  r.onerror = () => reject(new Error("The recording could not be read."));
  r.readAsDataURL(blob);
});
