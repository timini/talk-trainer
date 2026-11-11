// The learning engine in the browser (docs/learning.md, lib/learn/): what to say next, recording an attempt for the
// judge, the verdict on the same card, Hear it, and keeping the progress in localStorage and online. The React
// component renders it and calls its actions; it says when to render again through subscribe(). The browser's own
// parts (storage, the microphone, the clock, fetch) come in as dependencies, so the engine is tested with fakes.
//
// One attempt at a time: tap to speak, tap to stop, then "Checking..." while the judge works, then the verdict. A
// run-through is said slide by slide: a recording for each slide, Next slide between them, judged as they go.

import { byHand, outcome, run as runRecord, type Result } from "@/lib/learn/attempt";
import { crumbs, instruction, position, sections } from "@/lib/learn/label";
import { metrics, slidesAt, strip, weakest, weakSlides } from "@/lib/learn/metrics";
import { barOf, cues, estimates, familiar, hiding, known, record, type State, terms, troubleOf } from "@/lib/learn/model";
import { type Aim, GOOD } from "@/lib/learn/rules";
import { after, begin, pace, pick, type Pick, type Session } from "@/lib/learn/scheduler";
import { type Entry, inRange, type Log, logged, logKey, migrate, nodeKey, type Range, RULES, type Setting, SETTINGS, tidy } from "@/lib/learn/store";
import { build, hash, type Node, type Tree } from "@/lib/learn/tree";
import type { Verdict } from "@/lib/judge";
import { merge, streak, ymd } from "@/lib/schedule";
import type { Script, Sync } from "@/lib/train";

export type Screen = "home" | "session" | "done" | "progress";
// ready: nothing said yet; listening: recording; checking: the judge has the attempt; judged: the verdict is in;
// shown: the words are shown, to mark yourself; failed: the judge could not answer, so mark yourself; uncounted:
// nothing was heard or it started in the wrong place, so try again (no marking yourself: it was not said).
export type Phase = "ready" | "listening" | "checking" | "judged" | "shown" | "failed" | "uncounted";

// A recording under way: stop it for its sound, or throw it away.
export type Recording = { stop(): Promise<Blob>; cancel(): void };
export type Deps = {
  storage: Pick2<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
  fetch: typeof fetch;
  now: () => number;
  // the microphone: whether there is one, and a recording started (an error when it is blocked)
  canRecord: boolean;
  record: () => Promise<Recording>;
  // play the clips one after another; returns a function that stops them
  play: (clips: string[]) => () => void;
};
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

// The longest attempt: a whole slide said slowly.
const LONGEST = 180000;

// A familiar attempt as it was when Next slide was tapped: the pick, each leaf's share hidden, the share of the
// slide hidden, the gap since it was last tried and the wait before speaking.
type Flow = { item: Pick; hide: Map<string, number>; share: number; gap: number | null; waited: number | null };

// One slide of a run-through: its outcome once judged.
type Said = { points: number; leaves: Map<string, number>; trouble?: Map<string, number[]>; result: Result | null; why: string };

export class Engine {
  readonly tree: Tree;
  screen: Screen = "home";
  item: Pick | null = null;
  phase: Phase = "ready";
  // the card on screen: each leaf's share hidden, the words always shown, and whether Show me was tapped
  hide = new Map<string, number>();
  shown = false;
  result: Result | null = null;
  points: number | null = null;
  // how the attempt on screen was counted (null: not counted), its log entry, and the states it replaced
  counted: boolean | null = null;
  private entry: Entry | null = null;
  // getting familiar: the slides whose attempts are still with the judge
  readonly pending = new Set<string>();
  // getting familiar: slides to read again next (a verdict under GOOD, or not counted), each once a session; and the
  // slides not counted twice, passed over as new while there is anything else
  private redo: string[] = [];
  // waiting for the judge's last verdicts before choosing the next slide
  waiting = false;
  private again = new Set<string>();
  private passed = new Set<number>();
  private before = new Map<string, State | null>();
  // the trouble the judged attempt on screen put on each leaf's words
  private trouble: Map<string, number[]> | null = null;
  // a run-through: the slide being said (from 0) and each slide's outcome
  at = 0;
  said = new Map<number, Promise<Said>>();
  saidDone = new Map<number, Said>();
  note = "";
  sync: { state: Sync; at: number } = { state: "", at: 0 };
  blocked = false;
  session: Session = begin();
  since: number;
  // the estimate of the node on screen before and after its attempt
  known: { before: number; after: number | null; bar: number } | null = null;
  now: number;
  private version = 0;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private rec: Recording | null = null;
  private cap: ReturnType<typeof setTimeout> | undefined;
  private quiet: (() => void) | null = null;
  // how long the judge took on the last attempt
  private ms = 0;
  // for the log: when the card was shown and the recording started, the time recorded, the wait before the first
  // recording, the judge's problems by kind, each leaf's score, and a run-through's slides
  private cardAt = 0;
  private recAt = 0;
  private spoke = 0;
  private waited: number | null = null;
  private probs: Record<string, number> | null = null;
  private leafScores: number[] | null = null;
  private runSlides: [number, number][] | null = null;

  constructor(readonly script: Script, private readonly deps: Deps) {
    this.tree = build(script.slides);
    this.now = deps.now();
    this.since = this.now;
  }

  get slides() { return this.script.slides; }

  // Rendering: a version that changes on each update, for useSyncExternalStore.
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.version;
  private emit() { this.now = this.deps.now(); this.version += 1; this.listeners.forEach((fn) => fn()); }

  // Storage: this talk's keys in localStorage, shared with the old trainer.
  private get prefix() { return `talk-trainer:${this.script.talk.id}:`; }
  get = <T>(k: string, d: T): T => {
    try { const v = this.deps.storage.getItem(this.prefix + k); return v === null ? d : JSON.parse(v); } catch { return d; }
  };
  set(k: string, v: unknown) { try { this.deps.storage.setItem(this.prefix + k, JSON.stringify(v)); } catch { /* private mode */ } }
  private remove(k: string) { try { this.deps.storage.removeItem(this.prefix + k); } catch { /* private mode */ } }
  items(): Record<string, unknown> {
    const out: Record<string, unknown> = {}, s = this.deps.storage;
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i) as string;
      if (k.startsWith(this.prefix) && /^(train|flow|learn):/.test(k.slice(this.prefix.length))) {
        out[k.slice(this.prefix.length)] = JSON.parse(s.getItem(k) as string);
      }
    }
    return out;
  }
  absorb(items: Record<string, unknown>) {
    Object.entries(merge(this.items(), items)).forEach(([k, v]) => this.set(k, v));
    this.emit();
  }
  state = (id: string) => this.get<State | null>(nodeKey(id), null);

  // The settings, each {v, at}; before they are set, the old trainer's.
  private setting<T>(name: keyof typeof SETTINGS, old: string, d: T): T {
    return this.get<Setting<T> | null>(SETTINGS[name], null)?.v ?? this.get<T>(old, d);
  }
  private put(name: keyof typeof SETTINGS, v: unknown) { this.set(SETTINGS[name], { v, at: this.deps.now() }); this.pushSoon(); this.emit(); }
  get aim(): Aim {
    const a = this.setting<Aim>("aim", "train:aim", "gist");
    return a === "verbatim" || a === "familiar" ? a : "gist";
  }
  setAim(aim: Aim) { this.put("aim", aim); }
  // The slides to work on: a range, or from before there were ranges the last slide (from slide 1), 14 at first.
  get range(): Range {
    const r = this.get<Setting<Range> | null>(SETTINGS.range, null)?.v;
    return tidy(r ?? [[1, this.setting<number>("goal", "train:goal", 14)]], this.slides.length);
  }
  setRange(r: Range) { this.put("range", tidy(r, this.slides.length)); }
  // The talk's sections, and the opening and close (the first and last of them).
  get sections() { return sections(this.slides, this.tree); }
  get ends(): Range | null {
    const s = this.sections;
    return s.length > 1 ? [[s[0].from, s[0].to], [s[s.length - 1].from, s[s.length - 1].to]] : null;
  }
  get micOn() { return this.deps.canRecord && !this.blocked && this.setting<boolean>("mic", "train:mic", true); }
  setMic(on: boolean) { this.blocked = false; this.put("mic", on); }

  // Progress from the old trainer, once.
  private migrateOnce() {
    if (this.get(SETTINGS.migrated, null)) return;
    Object.entries(migrate(this.tree, this.slides, (k) => this.get(k, null), this.aim)).forEach(([k, v]) => this.set(k, v));
    this.set(SETTINGS.migrated, { v: true, at: this.deps.now() });
  }

  // The home screen and the Progress screen.
  summary() { return slidesAt(this.tree, this.state, this.deps.now(), this.aim); }
  // The strip across the top: each slide, how well it is known, and whether it is on screen or with the judge.
  strip() {
    const on = this.node?.slides ?? [], busy = new Set([...this.pending].flatMap((id) => (this.tree.nodes.get(id) as Node).slides));
    return strip(this.tree, this.state, this.deps.now(), this.aim).map((x) => ({ ...x, now: on.includes(x.n), judging: busy.has(x.n) }));
  }
  log(): Entry[] {
    return Object.entries(this.items()).filter(([k]) => k.startsWith("learn:log:")).sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([, v]) => (v as Log).list);
  }
  progress() {
    const log = this.log();
    return { ...metrics(log, this.since), weakest: weakest(this.tree, this.state, this.deps.now()), slides: weakSlides(log) };
  }
  get days() {
    return streak(Object.entries(this.items()).filter(([k, v]) => k.startsWith("learn:log:") && (v as Log).list.length)
      .map(([k]) => k.slice("learn:log:".length)), this.deps.now());
  }
  // The first slide in talk order not yet started, within the range.
  get next() { return this.slides.find((s) => inRange(this.range)(s.n) && s.sentences.length && !this.tree.order.some((id) => this.tree.nodes.get(id)?.slides.includes(s.n) && this.state(id))) ?? null; }

  show(screen: Screen) {
    this.halt();
    this.screen = screen;
    this.emit();
  }
  start() {
    this.go();
    this.show(this.item ? "session" : "done");
    if (this.flow && this.item && this.micOn) void this.speak();
  }
  // Getting familiar: one button, the next slide; each attempt is judged in the background and never shown.
  get flow() { return this.aim === "familiar"; }
  // A slide to read again, as a pick.
  private again1(id: string, now: number): Pick {
    const node = this.tree.nodes.get(id) as Node;
    return { node, why: "due", est: estimates(this.tree, this.state, now).get(id) as number, bar: barOf(node, this.aim) };
  }
  // After a familiar verdict: under GOOD, or not counted, the slide comes next, once a session; not counted again, it
  // is passed over as new while there is anything else.
  private after1(n: Node, points: number | null) {
    if (points !== null && points >= GOOD) return;
    if (!this.again.has(n.id)) { this.again.add(n.id); this.redo.push(n.id); }
    else if (points === null) this.passed.add(n.slides[0]);
  }
  // The next thing to say, or the done screen when there is nothing left within the range.
  go() {
    this.halt();
    const now = this.deps.now();
    // a slide still with the judge is not picked again until its verdict is in, unless there is nothing else
    const within = inRange(this.range), busy = new Set([...this.pending].flatMap((id) => (this.tree.nodes.get(id) as Node).slides));
    this.passed.forEach((n) => busy.add(n));
    const redo = this.flow ? this.redo.shift() : undefined;
    const narrow = redo ? this.again1(redo, now) : pick(this.tree, this.state, now, this.aim, (n) => within(n) && !busy.has(n), this.session);
    // getting familiar, with only slides still with the judge left: wait for their verdicts, not show one again
    this.waiting = !narrow && this.flow && this.pending.size > 0;
    this.item = narrow ?? (this.waiting ? null : pick(this.tree, this.state, now, this.aim, within, this.session));
    const est = estimates(this.tree, this.state, now);
    this.hide = this.item ? hiding(this.tree, this.item.node, est, this.aim, pace(this.session)) : new Map();
    Object.assign(this, { phase: "ready", result: null, points: null, counted: null, entry: null, note: "", shown: false,
      at: 0, known: this.item ? { before: this.item.est, after: null, bar: this.item.bar } : null });
    this.before = new Map();
    this.trouble = null;
    Object.assign(this, { cardAt: now, spoke: 0, waited: null, probs: null, leafScores: null, runSlides: null });
    this.said = new Map();
    this.saidDone = new Map();
    if (!this.item && !this.waiting && this.screen === "session") this.screen = "done";
    this.emit();
  }

  // What the card shows.
  get node(): Node | null { return this.item?.node ?? null; }
  get isRun() { const k = this.node?.kind; return k === "section" || k === "talk"; }
  // the share of the node's words hidden
  get share() {
    const n = this.node;
    if (!n || this.shown) return 0;
    if (this.isRun) return 1;
    const ws = n.leaves.map((l) => (this.tree.nodes.get(l) as Node).words), all = ws.reduce((a, b) => a + b, 0);
    return Math.round((20 * n.leaves.reduce((a, l, k) => a + (this.hide.get(l) as number) * ws[k], 0)) / all) / 20;
  }
  get instruction() { return instruction(this.share, this.isRun); }
  get position() { return this.node ? position(this.tree, this.node) : ""; }
  get crumbs() { return this.node ? crumbs(this.tree, this.node) : []; }
  // Each leaf to draw: its text, its share hidden, the words kept, the terms cued by their first letter, and a seed.
  lines() {
    const n = this.node;
    if (!n) return [];
    const est = estimates(this.tree, this.state, this.deps.now()), keep = cues(this.tree, n, this.state(n.id));
    return n.leaves.map((id) => {
      const leaf = this.tree.nodes.get(id) as Node, slide = this.slides.find((s) => s.n === leaf.slides[0]);
      const must = (slide?.sentences[leaf.first]?.must_say ?? []).filter((m) => leaf.text.includes(m));
      const mode = terms(est.get(id) as number);
      return { id, slide: leaf.slides[0], sentence: leaf.first, text: leaf.text, share: this.shown ? 0 : this.hide.get(id) as number,
        keep: [...(mode === "full" ? must : []), ...keep], initial: mode === "initial" ? must : [],
        seed: Number.parseInt(hash(`${id}:${this.state(id)?.n ?? 0}`), 36) >>> 0 };
    });
  }
  // Each word's trouble on the card, in the order of the node's words (0 for a word with none).
  troubles(): number[] {
    const n = this.node, now = this.deps.now();
    return n ? n.leaves.flatMap((id) => troubleOf(this.state(id), now) ?? new Array<number>((this.tree.nodes.get(id) as Node).words).fill(0)) : [];
  }
  // The must-say items of a node's text, and its voice clips.
  private mustOf(n: Node) {
    return [...new Set(n.slides.flatMap((k) => this.slides.find((s) => s.n === k)?.sentences ?? [])
      .flatMap((s) => s.must_say).filter((m) => n.text.includes(m)))];
  }
  clips(): string[] | null {
    const n = this.node;
    if (!n || this.isRun) return null;
    const out: string[] = [];
    n.leaves.forEach((id) => {
      const leaf = this.tree.nodes.get(id) as Node;
      const clip = this.slides.find((s) => s.n === leaf.slides[0])?.sentences[leaf.first]?.clip ?? null;
      if (clip && out.at(-1) !== clip) out.push(clip);
    });
    return out.length ? out : null;
  }
  // The slide being said in a run-through.
  get runSlide() { const n = this.node; return n && this.isRun ? this.slides.find((s) => s.n === n.slides[this.at]) ?? null : null; }

  // The big button, and Space: start, speak, stop or go on to the next slide, or go on after the verdict.
  space() {
    if (this.screen !== "session") { this.start(); return; }
    if (this.flow) { void this.nextCard(); return; }
    if (this.phase === "listening") { if (this.isRun) void this.nextSlide(); else this.stop(); }
    else if (this.phase === "ready") { if (this.micOn) void this.speak(); else this.reveal(); }
    else if (this.phase === "judged") this.go();
  }

  // "Show me": every word, for this attempt. "I know this one": the node and its parts known.
  showMe() {
    if (!this.item || (this.phase !== "ready" && this.phase !== "uncounted")) return;
    Object.assign(this, { shown: true, phase: "ready", note: "" });
    this.emit();
  }
  knowIt() {
    if (!this.item || this.phase !== "ready") return;
    known(this.tree, this.state, this.item.node, this.deps.now()).forEach((v, k) => this.set(nodeKey(k), v));
    this.logAttempt(this.item, null, this.deps.now(), this.gap(this.item.node, this.deps.now()), "known");
    this.pushSoon();
    this.go();
  }
  reveal() {
    if (!this.item || this.phase !== "ready") return;
    this.halt();
    this.phase = "shown";
    this.shown = true;
    this.emit();
  }

  // Record an attempt; it stops on a tap, never on a pause.
  async speak() {
    if (!this.item || this.phase !== "ready") return;
    this.halt();
    Object.assign(this, { phase: "listening", result: null, note: "" });
    this.emit();
    await this.begin();
  }
  private async begin() {
    const item = this.item;
    try {
      const rec = await this.deps.record();
      if (this.phase !== "listening" || this.item !== item) { rec.cancel(); return; }
      this.rec = rec;
      this.recAt = this.deps.now();
      if (this.waited === null) this.waited = this.recAt - this.cardAt;
      this.cap = setTimeout(() => this.space(), LONGEST);
      this.emit();
    } catch {
      Object.assign(this, { blocked: true, phase: "ready",
        note: "The microphone is blocked, so mark yourself: say it, tap Show the words, then Got it or Missed." });
      this.emit();
    }
  }
  // Whether the microphone is recording (it takes a moment to start).
  get recording() { return this.rec !== null; }
  private async take(): Promise<Blob | null> {
    const rec = this.rec;
    this.rec = null;
    clearTimeout(this.cap);
    if (rec) this.spoke += this.deps.now() - this.recAt;
    return rec ? rec.stop() : null;
  }

  // Stop recording and send the attempt to the judge.
  stop() {
    if (this.phase !== "listening" || this.isRun) return;
    const item = this.item as Pick;
    if (!this.rec) {
      Object.assign(this, { phase: "ready", note: "Nothing was recorded. Tap to speak again." });
      this.emit();
      return;
    }
    this.phase = "checking";
    this.emit();
    void this.take().then((blob) => this.ask(item, blob as Blob));
  }

  // Getting familiar: this slide's recording goes to the judge in the background, and the next slide comes up,
  // recording. Without the microphone the slide counts as read. A tap before the microphone started moves on.
  async nextCard() {
    const item = this.item;
    if (!this.flow || !item) return;
    const at = { item, hide: this.hide, share: this.share, gap: this.gap(item.node, this.deps.now()), waited: this.waited };
    if (!this.micOn) {
      const h = byHand(item.node, true);
      this.countFlow(at, h.points, h.leaves, "read");
    } else if (this.phase === "listening" && this.rec) {
      const t0 = this.recAt, blob = this.take();
      this.pending.add(item.node.id);
      void blob.then((b) => this.background({ ...at, spoke: this.deps.now() - t0 }, b as Blob));
    }
    this.go();
    if (this.item && this.micOn) await this.speak();
  }
  private async background(at: Flow & { spoke: number }, blob: Blob) {
    const n = at.item.node, t0 = this.deps.now();
    try {
      const v = await this.judge(n, blob, { hidden: at.share, why: at.item.why, before: at.item.est });
      const o = outcome(this.tree, n, v, this.mustOf(n), true);
      if (!o.counted) { this.logFlow(at, null, "", this.deps.now() - t0); this.after1(n, null); }
      else {
        this.countFlow(at, o.points, o.leaves, at.item.why, o.trouble, this.deps.now() - t0, {
          ...o.read as { meaning: number; delivery: number }, clarity: v.clarity, fluency: v.fluency, pace: v.pace, tip: v.tip });
        this.after1(n, o.points);
      }
    } catch {
      this.logFlow(at, null, "failed", this.deps.now() - t0);
      this.after1(n, null);
    }
    this.pending.delete(n.id);
    this.pushSoon();
    if (this.waiting && !this.pending.size && this.screen === "session") {
      this.go();
      if (this.item && this.micOn) await this.speak();
    }
    this.emit();
  }
  // A familiar attempt counted on its own slide, whatever is on screen now, and logged.
  private countFlow(at: Flow & { spoke?: number }, points: number, leaves: Map<string, number>, why: string,
    trouble?: Map<string, number[]>, ms = 0, read?: Entry["read"]) {
    const now = this.deps.now(), n = at.item.node;
    const got = record(this.tree, this.state, n, leaves, points, now, at.hide, estimates(this.tree, this.state, now), trouble, 0);
    this.write(familiar(got, this.state));
    this.session = after(this.session, at.item, points >= 60);
    this.logFlow(at, points, why, ms, read, n.leaves.map((l) => leaves.get(l) as number));
  }
  private logFlow(at: Flow & { spoke?: number }, points: number | null, why: string, ms: number, read?: Entry["read"],
    leaves?: number[]) {
    const now = this.deps.now(), n = at.item.node;
    const e: Entry = { id: `${now.toString(36)}-${hash(n.id)}`, at: now, node: n.id, slide: n.slides[0], kind: n.kind,
      height: n.height, words: n.words, before: at.item.est, bar: at.item.bar,
      after: points === null ? null : estimates(this.tree, this.state, now).get(n.id) as number, hidden: at.share, points,
      pass: points === null ? null : points >= 60, ms, gap: at.gap, why: why || at.item.why, m: now, v: RULES,
      ...(leaves ? { leaves } : {}), ...(read ? { read } : {}), speak: at.spoke ?? 0, wait: at.waited };
    const day = ymd(now);
    this.set(logKey(day), logged(this.get<Log | null>(logKey(day), null), e));
  }

  // A run-through: this slide's recording goes to the judge, and the next slide's starts; after the last, the
  // verdict once every slide is judged.
  async nextSlide() {
    if (this.phase !== "listening" || !this.isRun || !this.rec) return;
    const item = this.item as Pick, n = item.node.slides[this.at], blob = await this.take() as Blob;
    this.said.set(n, this.judgeSlide(n, blob));
    if (this.at < item.node.slides.length - 1) {
      this.at += 1;
      this.emit();
      await this.begin();
      return;
    }
    this.phase = "checking";
    this.emit();
    await this.finishRun(item);
  }
  private async judgeSlide(n: number, blob: Blob): Promise<Said> {
    const root = this.tree.nodes.get(this.tree.roots.get(n) as string) as Node;
    const zero = (why: string): Said => ({ points: 0, leaves: new Map(root.leaves.map((l) => [l, 0])), result: null, why });
    const v = await this.judge(root, blob, { run: this.node?.id });
    const o = outcome(this.tree, root, v, this.mustOf(root));
    const out = o.counted ? { points: o.points, leaves: o.leaves, trouble: o.trouble, result: o.result, why: "" } : zero(o.why);
    this.saidDone.set(n, out);
    this.emit();
    return out;
  }
  private async finishRun(item: Pick) {
    try {
      const all = new Map<number, Said>();
      for (const [n, p] of this.said) all.set(n, await p);
      if (this.item !== item) return;
      if (!all.size) throw new Error("Nothing was recorded.");
      this.countRun(item, all);
    } catch (err) {
      if (this.item !== item) return;
      Object.assign(this, { phase: "failed", note: `${(err as Error).message} Try again, or mark yourself.` });
    }
    this.emit();
  }
  private countRun(item: Pick, all: Map<number, Said>) {
    const now = this.deps.now(), est = estimates(this.tree, this.state, now), gap = this.gap(item.node, now);
    this.before.forEach((v, k) => (v === null ? this.remove(nodeKey(k)) : this.set(nodeKey(k), v)));
    const states = runRecord(this.tree, this.state, item.node, all, now, est);
    // the judge's scores, kept through a recount
    this.runSlides ??= [...all].map(([n, x]) => [n, Math.round(x.points)]);
    this.before = new Map([...states.keys()].map((k) => [k, this.state(k)]));
    this.write(states);
    const points = Math.round([...all.values()].reduce((a, x) => a + x.points, 0) / all.size);
    this.counted = points >= 60;
    this.points = points;
    this.logAttempt(item, points, now, gap);
    this.phase = "judged";
  }
  // The time since a node was last tried (null: never).
  private gap(n: Node, now: number) { const st = this.state(n.id); return st ? now - st.at : null; }

  // The judge: the recording, the text, the talk's names and the must-say items go to /api/grade. The place in the
  // tree goes with them, for the judge's log.
  private async judge(n: Node, blob: Blob, extra: Record<string, unknown> = {}): Promise<Verdict> {
    if (!blob.size) throw new Error("Nothing was recorded.");
    const audio = await base64(blob), st = this.state(n.id), t0 = this.deps.now();
    const res = await this.deps.fetch("/api/grade", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: this.flow ? "read" : "card", audio, mime: blob.type.split(";")[0] || "audio/webm", target: n.text,
        glossary: this.script.talk.glossary, must: this.mustOf(n),
        at: { engine: "learn", node: n.id, kind: n.kind, height: n.height, words: n.words, before: this.known?.before,
          hidden: this.share, why: this.item?.why, gap: st ? this.deps.now() - st.at : null, ...extra } }) });
    const body = await res.json().catch(() => ({})) as Verdict & { error?: string };
    this.ms = this.deps.now() - t0;
    if (!res.ok) throw new Error(body.error ?? `The judge answered ${res.status}.`);
    return body;
  }
  private async ask(item: Pick, blob: Blob) {
    try {
      const v = await this.judge(item.node, blob);
      if (this.item !== item) return;
      this.probs = (v.problems ?? []).reduce<Record<string, number>>((a, x) => ({ ...a, [x.kind]: (a[x.kind] ?? 0) + 1 }), {});
      const o = outcome(this.tree, item.node, v, this.mustOf(item.node));
      if (!o.counted) {
        this.session = after(this.session, item, null);
        this.logAttempt(item, null, this.deps.now(), this.gap(item.node, this.deps.now()));
        // not counted: try again or read it first, never mark it got
        Object.assign(this, { phase: "uncounted", note: `${o.why} Try again, or tap Show me to read it first.` });
        this.emit();
        return;
      }
      this.result = o.result;
      this.trouble = o.trouble;
      this.count(item, o.points, o.leaves, o.trouble);
      this.phase = "judged";
    } catch (err) {
      if (this.item !== item) return;
      Object.assign(this, { phase: "failed", note: `${(err as Error).message} Try again, or mark yourself.` });
    }
    this.emit();
  }

  // Count the attempt on screen: the states move and the attempt is logged. Counting again (a recount) first puts
  // back what the last count replaced.
  private count(item: Pick, points: number, leaves: Map<string, number>, trouble?: Map<string, number[]>) {
    const now = this.deps.now();
    this.before.forEach((v, k) => (v === null ? this.remove(nodeKey(k)) : this.set(nodeKey(k), v)));
    const est = estimates(this.tree, this.state, now), gap = this.gap(item.node, now);
    const hide = this.shown ? new Map(item.node.leaves.map((l) => [l, 0])) : this.hide;
    const got = record(this.tree, this.state, item.node, leaves, points, now, hide, est, trouble);
    const states = this.aim === "familiar" ? familiar(got, this.state) : got;
    this.before = new Map([...states.keys()].map((k) => [k, this.state(k)]));
    this.write(states);
    this.points = points;
    this.counted = points >= 60;
    this.leafScores ??= item.node.leaves.map((l) => leaves.get(l) ?? 0);
    this.logAttempt(item, points, now, gap);
  }
  private write(states: Map<string, State>) {
    states.forEach((v, k) => this.set(nodeKey(k), v));
    this.pushSoon();
  }
  // The attempt in the day's log, and the session's pace. A recount changes the same entry.
  private logAttempt(item: Pick, points: number | null, now: number, gap: number | null, why: string = item.why) {
    const n = item.node, after1 = points === null ? null : estimates(this.tree, this.state, now).get(n.id) as number;
    const prev = this.entry;
    const e: Entry = { id: prev?.id ?? `${now.toString(36)}-${hash(n.id)}`, at: prev?.at ?? now, node: n.id, slide: n.slides[0],
      kind: n.kind, height: n.height, words: n.words, before: item.est, bar: item.bar, after: after1, hidden: this.share,
      points, pass: points === null ? null : points >= 60, ms: this.ms, gap: prev ? prev.gap : gap, why, m: now, v: RULES,
      ...(this.leafScores && points !== null ? { leaves: this.leafScores } : {}), ...(this.probs ? { probs: this.probs } : {}),
      ...(this.runSlides ? { slides: this.runSlides } : {}), shown: this.shown, speak: this.spoke, wait: this.waited };
    if (!prev && points !== null) this.session = after(this.session, item, points >= 60);
    else if (points !== null) this.session = { ...this.session, recent: [...this.session.recent.slice(0, -1), points >= 60],
      last: { id: n.id, pass: points >= 60 } };
    this.entry = points === null ? null : e;
    const day = ymd(e.at);
    this.set(logKey(day), logged(this.get<Log | null>(logKey(day), null), e));
    if (this.known && points !== null) this.known = { ...this.known, after: after1 };
  }

  // "Count it as got" or "Count it as missed": the attempt rescored, every leaf alike.
  recount(pass: boolean) {
    if (this.phase !== "judged" || this.counted === pass || !this.item) return;
    if (this.isRun) {
      const all = new Map([...this.saidDone.keys()].map((n) => {
        const root = this.tree.nodes.get(this.tree.roots.get(n) as string) as Node, h = byHand(root, pass);
        return [n, { ...h, result: null, why: "" }] as const;
      }));
      this.countRun(this.item, all);
    } else {
      // counted as got: the words the judge marked take on no trouble; as missed: what they took on at first
      const h = byHand(this.item.node, pass), t = this.trouble;
      this.count(this.item, h.points, h.leaves, t ? (pass ? new Map([...t].map(([k, v]) => [k, v.map(() => 0)])) : t) : undefined);
    }
    this.emit();
  }
  // Marking yourself, without the microphone or when the judge could not answer: counted, then on to the next.
  mark(pass: boolean) {
    if (this.screen !== "session" || !this.item || (this.phase !== "shown" && this.phase !== "failed")) return;
    const item = this.item;
    if (this.isRun) {
      const all = new Map(item.node.slides.map((n) => {
        const root = this.tree.nodes.get(this.tree.roots.get(n) as string) as Node, h = byHand(root, pass);
        return [n, { ...h, result: null, why: "" }] as const;
      }));
      this.countRun(item, all);
    } else {
      const h = byHand(item.node, pass);
      this.count(item, h.points, h.leaves);
    }
    this.go();
  }
  retry() {
    if (this.phase !== "failed" && this.phase !== "uncounted") return;
    Object.assign(this, { phase: "ready", note: "", at: 0 });
    this.said = new Map();
    this.saidDone = new Map();
    void this.speak();
  }

  // Hear it: the clips of what is to be said.
  hear() {
    const clips = this.clips();
    if (this.screen !== "session" || !clips || this.phase === "listening") return;
    this.quiet?.();
    this.quiet = this.deps.play(clips);
  }

  // Stop anything under way: a recording (thrown away) and Hear it.
  halt() {
    if (this.phase === "listening") this.phase = "ready";
    const rec = this.rec;
    this.rec = null;
    clearTimeout(this.cap);
    rec?.cancel();
    this.quiet?.();
    this.quiet = null;
  }

  // Progress online, per talk: merged with this browser's on opening, saved a few seconds after each attempt, and at
  // once (keepalive) when the page goes away.
  private url() { return `/api/talks/${this.script.talk.id}/progress`; }
  async pull() {
    try {
      const res = await this.deps.fetch(this.url(), { cache: "no-store" });
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
      const res = await this.deps.fetch(this.url(), { method: "PUT", keepalive, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: this.items() }) });
      if (!res.ok) throw new Error();
      this.absorb((await res.json() as { items: Record<string, unknown> }).items);
      this.sync = { state: "on", at: this.deps.now() };
    } catch {
      this.sync.state = "error";
    }
    this.emit();
  }
  pushSoon() { clearTimeout(this.timer); this.timer = setTimeout(() => void this.push(), 3000); }
  pagehide() { if (this.timer) void this.push(true); }
}

// A recording as base64, in pieces so a long one does not overflow the call stack.
export const base64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// The browser's parts: localStorage, fetch, the clock, the microphone (Opus at 16 kbps) and an audio element.
export const browser = (): Deps => {
  let audio: HTMLAudioElement | null = null;
  return {
    storage: localStorage,
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    canRecord: !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined",
    record: async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const opus = "audio/webm;codecs=opus", chunks: Blob[] = [];
      const media = new MediaRecorder(stream, { audioBitsPerSecond: 16000, ...(MediaRecorder.isTypeSupported?.(opus) ? { mimeType: opus } : {}) });
      media.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      media.start();
      const end = () => stream.getTracks().forEach((t) => t.stop());
      return {
        stop: () => new Promise<Blob>((resolve) => {
          media.onstop = () => { end(); resolve(new Blob(chunks, { type: media.mimeType || "audio/webm" })); };
          media.stop();
        }),
        cancel: () => { media.onstop = end; if (media.state !== "inactive") media.stop(); else end(); },
      };
    },
    play: (clips) => {
      const a = (audio ??= new Audio());
      let i = 0;
      const go = () => { a.src = clips[i]; a.play().catch(() => a.pause()); };
      a.onended = () => { i += 1; if (i < clips.length) go(); };
      go();
      return () => { a.onended = null; a.pause(); };
    },
  };
};
