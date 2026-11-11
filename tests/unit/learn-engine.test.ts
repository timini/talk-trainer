// The /learn engine with fakes for the browser: storage, fetch, the clock, the microphone and the audio.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { base64, type Deps, Engine, type Recording } from "@/app/talks/[id]/learn/engine";
import type { State } from "@/lib/learn/model";
import { nodeKey, RULES } from "@/lib/learn/store";
import type { Script } from "@/lib/train";

const sentence = (i: number, text: string, must: string[] = []) => ({ i, text, hash: `h${i}${text.length}`, clip: `/clip/${text.length}`, must_say: must });
const SCRIPT: Script = {
  talk: { id: "t1", title: "Bread", status: "ready", talkAt: null, glossary: [] },
  slides: [
    { n: 1, title: "Welcome", image: "/img/1.png", sentences: [sentence(1, "Good morning, and thank you for coming."), sentence(2, "Today we bake bread.")] },
    { n: 2, title: "Flour", image: null, sentences: [sentence(1, "Mix 500 grams of flour.", ["500"])] },
  ],
};
const P = "talk-trainer:t1:";

class Store {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

type Reply = { status?: number; body: unknown };
let clock: number, storage: Store, server: Record<string, unknown>, grades: Reply[], sent: { url: string; body: unknown }[], played: string[][];
let micBlocked: boolean;
// the judge's replies wait for this, so a test can keep an attempt with the judge
let hold: Promise<void>;
const deps = (): Deps => ({
  storage, now: () => clock, canRecord: true,
  fetch: (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url, body });
    if (url === "/api/grade") {
      await hold;
      const r = grades.shift() ?? { body: { heard: body.target, meaning_ok: true, problems: [], clarity: 5, fluency: 5, pace: "good", tip: "Good." } };
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }
    if (url.endsWith("/progress") && init?.method === "PUT") {
      Object.assign(server, body.items);
      return new Response(JSON.stringify({ items: server }), { status: 200 });
    }
    if (url.endsWith("/progress")) return new Response(JSON.stringify({ items: server }), { status: 200 });
    return new Response("{}", { status: 404 });
  }) as typeof fetch,
  record: async (): Promise<Recording> => {
    if (micBlocked) throw new Error("blocked");
    return { stop: async () => new Blob(["sound"], { type: "audio/webm;codecs=opus" }), cancel: () => {} };
  },
  play: (clips) => { played.push(clips); return () => {}; },
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  clock = Date.UTC(2026, 10, 10, 9);
  storage = new Store();
  server = {};
  grades = [];
  sent = [];
  played = [];
  micBlocked = false;
  hold = Promise.resolve();
});
afterEach(() => { vi.useRealTimers(); });

const flush = async () => { for (let k = 0; k < 20; k += 1) await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); };
const make = () => new Engine(SCRIPT, deps());
const state = (e: Engine, id: string) => e.get<State | null>(nodeKey(id), null);
// speak and stop: the verdict comes from the next reply in grades
const say = async (e: Engine) => {
  await e.speak();
  e.stop();
  await flush();
};

describe("an attempt from start to verdict", () => {
  test("the first leaf, read aloud, judged: its score moves and it is logged", async () => {
    const e = make();
    e.setAim("verbatim");
    e.start();
    expect(e.screen).toBe("session");
    expect(e.node?.text).toBe("Good morning, and thank you for coming.");
    expect([e.instruction, e.position, e.share]).toEqual(["Read it aloud.", "Sentence 1 of 2", 0]);
    expect(e.crumbs).toEqual(["Slide 1", "Sentence 1"]);
    await e.speak();
    expect(e.phase).toBe("listening");
    e.stop();
    expect(e.phase).toBe("checking");
    await flush();
    expect(e.phase).toBe("judged");
    expect([e.points, e.counted]).toEqual([100, true]);
    const id = e.node!.id;
    expect(state(e, id)).toMatchObject({ s: 0.5, n: 1, passes: 1, hid: 0 });
    expect(e.known).toEqual({ before: 0, after: 0.5, bar: 0.75 });
    const grade = sent.find((x) => x.url === "/api/grade")!.body as Record<string, unknown>;
    expect(grade).toMatchObject({ mode: "card", mime: "audio/webm", target: "Good morning, and thank you for coming.", audio: base64Of("sound") });
    expect(grade.at).toMatchObject({ engine: "learn", node: id, kind: "sentence", why: "new", gap: null });
    expect(e.log()).toHaveLength(1);
    expect(e.log()[0]).toMatchObject({ node: id, points: 100, pass: true, before: 0, after: 0.5 });
    expect(e.session.recent).toEqual([true]);
    // next: the same leaf, now partly hidden
    e.go();
    expect(e.node?.id).toBe(id);
    expect(e.share).toBeGreaterThan(0);
    expect(e.lines()[0]).toMatchObject({ text: "Good morning, and thank you for coming.", keep: ["Good morning, and"] });
    // the save goes online a few seconds later
    await vi.advanceTimersByTimeAsync(3000);
    expect(Object.keys(server).some((k) => k.startsWith("learn:n:"))).toBe(true);
    expect(e.sync.state).toBe("on");
  });

  test("a miss lands on the part that was missed, and the next pick goes down to it", async () => {
    const e = make();
    const s1 = SCRIPT.slides[0].sentences;
    // both sentences known, so the slide is tried
    e.start();
    const [a, b, root] = e.tree.order;
    const known: State = { s: 0.8, at: clock, interval: 600000, n: 3, passes: 3, lastPass: clock, run: 0, hid: 0.85 };
    e.set(nodeKey(a), known);
    e.set(nodeKey(b), known);
    e.go();
    expect(e.node?.id).toBe(root);
    grades.push({ body: { heard: s1[0].text, meaning_ok: false, problems: [{ kind: "left_out", script: s1[1].text }], clarity: 5, fluency: 5 } });
    await say(e);
    expect([e.phase, e.counted]).toEqual(["judged", false]);
    expect(state(e, b)!.s).toBeLessThan(state(e, a)!.s);
    e.go();
    expect([e.node?.id, e.item?.why]).toEqual([b, "down"]);
  });
});

describe("not counted", () => {
  test("almost nothing heard, or started at another sentence: says why, and nothing moves", async () => {
    const e = make();
    e.start();
    grades.push({ body: { heard: "", meaning_ok: false, problems: [], clarity: 1, fluency: 1 } });
    await say(e);
    expect(e.phase).toBe("uncounted");
    expect(e.note).toBe("I didn't catch that. Try again, or tap Show me to read it first.");
    // not counted: it cannot be marked got
    e.mark(true);
    expect(e.phase).toBe("uncounted");
    expect(state(e, e.node!.id)).toBeNull();
    expect(e.log()[0]).toMatchObject({ points: null, pass: null });
    expect(e.session).toMatchObject({ recent: [], same: 1 });
    // try again: started at sentence 2
    grades.push({ body: { heard: "Today we bake bread.", meaning_ok: false, problems: [], clarity: 5, fluency: 5 } });
    e.retry();
    await flush();
    e.stop();
    await flush();
    expect(e.note).toMatch(/^That started at 'Today we bake bread'/);
    expect(e.phase).toBe("uncounted");
    // the judge failing: mark yourself
    grades.push({ status: 502, body: { error: "The judge answered 500." } });
    e.retry();
    await flush();
    e.stop();
    await flush();
    expect([e.phase, e.note]).toEqual(["failed", "The judge answered 500. Try again, or mark yourself."]);
    grades.push({ status: 500, body: "not json" });
    e.retry();
    await flush();
    e.stop();
    await flush();
    expect(e.note).toBe("The judge answered 500. Try again, or mark yourself.");
    e.mark(true);
    expect(e.log().filter((x) => x.points !== null)).toHaveLength(1);
    expect(e.log().at(-1)).toMatchObject({ points: 85 });
  });

  test("not counted, then Show me: the words to read, and on from there", async () => {
    const e = make();
    e.start();
    grades.push({ body: { heard: "", meaning_ok: false, problems: [], clarity: 1, fluency: 1 } });
    await say(e);
    e.showMe();
    expect([e.phase, e.shown, e.share, e.note]).toEqual(["ready", true, 0, ""]);
    await say(e);
    // read off the screen: counted, as missed
    expect([e.phase, e.counted, e.points]).toEqual(["judged", false, 50]);
    // Show me does nothing once judged
    e.showMe();
    expect(e.phase).toBe("judged");
  });

  test("started right but stopped early: a miss, which goes down", async () => {
    const e = make();
    e.setAim("verbatim");
    e.start();
    const [a, b, root] = e.tree.order;
    const known: State = { s: 0.8, at: clock, interval: 600000, n: 3, passes: 3, lastPass: clock, run: 0, hid: 0.85 };
    e.set(nodeKey(a), known);
    e.set(nodeKey(b), known);
    e.go();
    expect(e.node?.id).toBe(root);
    grades.push({ body: { heard: "Good morning", meaning_ok: true, problems: [], clarity: 5, fluency: 5 } });
    await say(e);
    expect([e.phase, e.counted]).toEqual(["judged", false]);
    e.go();
    expect(e.item?.why).toBe("down");
  });

  test("stopped before the microphone was ready; the microphone blocked", async () => {
    const e = make();
    e.start();
    e.phase = "listening";
    e.stop();
    expect([e.phase, e.note]).toEqual(["ready", "Nothing was recorded. Tap to speak again."]);
    micBlocked = true;
    await e.speak();
    expect([e.phase, e.blocked, e.micOn]).toEqual(["ready", true, false]);
    e.space();
    expect(e.phase).toBe("shown");
    e.mark(false);
    expect(e.log()[0]).toMatchObject({ points: 50, pass: false });
  });
});

describe("recount, Show me and I know this one", () => {
  test("Count it as got rescored at 85, every leaf alike, the same log entry; and back", async () => {
    const e = make();
    e.setAim("verbatim");
    e.start();
    const id = e.node!.id;
    grades.push({ body: { heard: "Good morning", meaning_ok: false, problems: [{ kind: "left_out", script: "thank you for coming" }], clarity: 5, fluency: 5 } });
    await say(e);
    expect(e.counted).toBe(false);
    const missed = state(e, id)!.s;
    clock += 1000;
    e.recount(true);
    expect([e.counted, e.points]).toEqual([true, 85]);
    expect(state(e, id)).toMatchObject({ s: 0.425, n: 1, passes: 1 });
    expect(state(e, id)!.s).toBeGreaterThan(missed);
    expect(e.log()).toHaveLength(1);
    expect(e.log()[0]).toMatchObject({ points: 85, pass: true });
    expect(e.session.recent).toEqual([true]);
    // counted as got, the words marked took on no trouble; as missed again, they did
    expect(state(e, id)!.trouble).toEqual([0, 0, 0, 0, 0, 0, 0]);
    e.recount(true);
    e.recount(false);
    expect([e.counted, state(e, id)!.s]).toEqual([false, 0.25]);
    expect(state(e, id)!.trouble).toEqual([0, 0, 0, 1, 1, 1, 1]);
    expect(e.troubles()).toEqual([0, 0, 0, 1, 1, 1, 1]);
    expect(e.progress().weakest).toEqual([{ slide: 1, phrase: "thank you for coming.", trouble: 4 }]);
  });

  test("Show me shows every word for this attempt; I know this one moves on", async () => {
    const e = make();
    e.setAim("verbatim");
    e.start();
    const [a] = e.tree.order;
    e.set(nodeKey(a), { s: 0.5, at: clock, interval: 600000, n: 2, passes: 2, lastPass: clock, run: 0, hid: 0.4 });
    e.go();
    expect(e.share).toBeGreaterThan(0);
    e.showMe();
    expect([e.share, e.instruction]).toEqual([0, "Read it aloud."]);
    expect(e.lines()[0].share).toBe(0);
    await say(e);
    expect(state(e, a)!).toMatchObject({ hid: 0, run: 1 });
    // missed, so the same clause again
    e.go();
    const b = e.node!.id;
    expect(b).toBe(a);
    clock += 1000;
    e.knowIt();
    expect(state(e, b)).toMatchObject({ s: 0.9, hid: 1 });
    expect(e.node?.id).not.toBe(b);
    // both logged: the attempt with Show me used (missed), then "I know this one", not counted
    expect(e.log().map((x) => [x.node, x.why, x.pass, x.shown])).toEqual([[a, expect.any(String), false, true], [b, "known", null, false]]);
  });

  test("each attempt logs what a later fit needs: the rules, each leaf's score, the problems, the time spoken and waited", async () => {
    const e = make();
    e.setAim("verbatim");
    e.start();
    const id = e.node!.id;
    grades.push({ body: { heard: "Good morning.", meaning_ok: false, clarity: 5, fluency: 4, pace: "good", tip: "",
      problems: [{ kind: "left_out", script: "and thank you for coming.", said: "" }, { kind: "stumble", script: "Good morning", said: "Good mor- morning" }] } });
    clock += 4000;
    await e.speak();
    clock += 3000;
    e.stop();
    await flush();
    const [x] = e.log();
    expect(x).toMatchObject({ node: id, v: RULES, probs: { left_out: 1, stumble: 1 }, wait: 4000, speak: 3000, shown: false });
    expect(x.leaves).toHaveLength(e.tree.nodes.get(id)!.leaves.length);
    expect(x.leaves!.every((v) => v >= 0 && v <= 100)).toBe(true);
    expect(RULES).toMatch(/^[0-9a-z]+$/);
  });

  test("no trouble yet: every word 0; nothing on screen: none", () => {
    const e = make();
    expect(e.troubles()).toEqual([]);
    e.start();
    expect(e.troubles()).toEqual(new Array(11).fill(0));
  });

  test("Hear it plays the clips of what is to be said", () => {
    const e = make();
    e.hear();
    e.start();
    e.hear();
    e.hear();
    // the gist starts with the whole slide: both its sentences
    expect(played).toEqual([["/clip/39", "/clip/20"], ["/clip/39", "/clip/20"]]);
  });
});

describe("a run-through", () => {
  test("said slide by slide, each judged, then the talk's verdict", async () => {
    const e = make();
    const all: State = { s: 0.95, at: clock, interval: 600000, n: 3, passes: 3, lastPass: clock, run: 0, hid: 1 };
    e.tree.order.filter((id) => id !== "t").forEach((id) => e.set(nodeKey(id), all));
    e.start();
    expect([e.node?.id, e.isRun, e.share, e.instruction]).toEqual(["t", true, 1, "From memory: say each slide, then tap Next slide."]);
    expect([e.runSlide?.n, e.clips()]).toEqual([1, null]);
    await e.speak();
    grades.push({ body: { heard: "Good morning, and thank you for coming. Today we bake bread.", meaning_ok: true, problems: [], clarity: 5, fluency: 5 } });
    grades.push({ body: { heard: "", meaning_ok: false, problems: [], clarity: 1, fluency: 1 } });
    e.space();
    await flush();
    expect([e.phase, e.at, e.runSlide?.n]).toEqual(["listening", 1, 2]);
    e.space();
    await flush();
    expect(e.phase).toBe("judged");
    expect([...e.saidDone.entries()].map(([n, x]) => [n, x.points, x.why])).toEqual([[1, 100, ""], [2, 0, "I didn't catch that."]]);
    expect([e.points, e.counted]).toEqual([50, false]);
    expect(state(e, "t")).toMatchObject({ n: 1, run: 1 });
    expect(state(e, e.tree.roots.get(2)!)).toMatchObject({ run: 1 });
    e.recount(true);
    expect([e.points, e.counted]).toEqual([85, true]);
    expect(state(e, "t")).toMatchObject({ n: 1, run: 0, passes: 1 });
    // logged once, with each slide's points as the judge gave them
    expect(e.log()).toHaveLength(1);
    expect(e.log()[0]).toMatchObject({ node: "t", points: 85, slides: [[1, 100], [2, 0]] });
  });

  test("marked by hand without the microphone", () => {
    const e = new Engine(SCRIPT, { ...deps(), canRecord: false });
    const all: State = { s: 0.95, at: clock, interval: 600000, n: 3, passes: 3, lastPass: clock, run: 0, hid: 1 };
    e.tree.order.filter((id) => id !== "t").forEach((id) => e.set(nodeKey(id), all));
    e.start();
    e.space();
    expect(e.phase).toBe("shown");
    e.mark(true);
    expect(state(e, "t")).toMatchObject({ passes: 1 });
  });
});

describe("getting familiar", () => {
  const entries = (e: Engine) => e.log();
  const grade = () => sent.filter((x) => x.url === "/api/grade").map((x) => x.body as { mode: string; target: string });

  test("Start records slide 1; Next slide shows slide 2 at once, recording, and slide 1 is judged in the background", async () => {
    const e = make();
    e.setAim("familiar");
    e.start();
    await flush();
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    expect([e.flow, e.node?.id, e.share, e.phase, e.recording]).toEqual([true, one, 0, "listening", true]);
    let release = () => {};
    hold = new Promise((r) => { release = r; });
    await e.nextCard();
    await flush();
    // on to slide 2, recording, while slide 1 is still with the judge
    expect([e.node?.id, e.phase, e.recording, [...e.pending]]).toEqual([two, "listening", true, [one]]);
    expect(state(e, one)).toBeNull();
    release();
    await flush();
    // judged as a reading: the meaning and the delivery, 100 each; counted on slide 1, never shown
    expect(grade()[0]).toMatchObject({ mode: "read", target: "Good morning, and thank you for coming. Today we bake bread." });
    // one good reading is enough: at the bar (0.6) at once, capped at 0.65
    expect(state(e, one)?.s).toBe(0.65);
    expect(e.strip()).toEqual([{ n: 1, known: 1, tried: true, at: true, now: false, judging: false, learning: true },
      { n: 2, known: 0, tried: false, at: false, now: true, judging: false, learning: true }]);
    // the slides being practised: the range
    e.setRange([[2, 2]]);
    expect(e.strip().map((x) => x.learning)).toEqual([false, true]);
    expect([e.pending.size, e.node?.id, e.phase, e.points]).toEqual([0, two, "listening", null]);
    expect(entries(e)[0]).toMatchObject({ node: one, points: 100, pass: true, why: "new",
      read: { meaning: 100, delivery: 100, clarity: 5, fluency: 5, pace: "good", tip: "Good." } });
    expect(e.progress().slides).toEqual([{ slide: 1, points: 100, low: "delivery" }]);
  });

  test("a slide still with the judge is not picked again while there is another; then it is", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    e.start();
    await flush();
    let release = () => {};
    hold = new Promise((r) => { release = r; });
    await e.nextCard();
    await flush();
    // slide 1 is with the judge: slide 2, shown on the strip as being judged
    expect([e.node?.id, [...e.pending]]).toEqual([two, [one]]);
    expect(e.strip().map((x) => [x.n, x.now, x.judging])).toEqual([[1, false, true], [2, true, false]]);
    await e.nextCard();
    await flush();
    // both with the judge and nothing else: wait for the verdicts, not slide 1 again
    expect([e.item, e.waiting, e.screen]).toEqual([null, true, "session"]);
    release();
    await flush();
    // both read well: nothing left
    expect([e.pending.size, e.waiting, e.screen]).toEqual([0, false, "done"]);
  });

  test("waiting for the last verdict, then the slide that needs reading again", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string;
    e.start();
    await flush();
    await e.nextCard();
    await flush();
    let release = () => {};
    hold = new Promise((r) => { release = r; });
    grades.push({ body: { heard: "Mix 500 grams of flour.", meaning_ok: true, problems: [], clarity: 2, fluency: 2 } });
    await e.nextCard();
    await flush();
    expect(e.waiting).toBe(true);
    release();
    await flush();
    // slide 2 scored 70: read it again, recording
    expect([e.waiting, e.node?.id, e.item?.why, e.phase]).toEqual([false, e.tree.roots.get(2), "due", "listening"]);
    expect(state(e, one)?.s).toBe(0.65);
  });

  test("a reading under 85 comes back next, once a session; a good one does not", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    const mumbled = { body: { heard: "Good morning, and thank you for coming. Today we bake bread.", meaning_ok: true, problems: [],
      clarity: 3, fluency: 3, pace: "good", tip: "Pause." } };
    e.start();
    await flush();
    grades.push(mumbled);
    await e.nextCard();
    await flush();
    // 80: below the bar, so after slide 2 it is slide 1 again
    expect([e.node?.id, state(e, one)?.s]).toEqual([two, 0.4]);
    await e.nextCard();
    await flush();
    expect([e.node?.id, e.item?.why]).toEqual([one, "due"]);
    // under 85 again: not a second time this session
    grades.push(mumbled);
    await e.nextCard();
    await flush();
    await e.nextCard();
    await flush();
    expect(e.item?.why).not.toBe("due");
  });

  test("a slide not counted twice is passed over as new while there is anything else", async () => {
    const three: Script = { ...SCRIPT, slides: [...SCRIPT.slides, { n: 3, title: "Rest", image: null, sentences: [sentence(1, "Let it rest.")] }] };
    const e = new Engine(three, deps());
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string, last = e.tree.roots.get(3) as string;
    const empty = { body: { heard: "", meaning_ok: false, problems: [], clarity: 1, fluency: 1 } };
    e.start();
    await flush();
    grades.push(empty);
    await e.nextCard();
    await flush();
    // not counted: slide 1 again after slide 2
    await e.nextCard();
    await flush();
    expect(e.node?.id).toBe(one);
    grades.push(empty);
    await e.nextCard();
    await flush();
    // not counted twice: slide 3, not slide 1, though slide 1 is still new
    expect([e.node?.id, state(e, one)]).toEqual([last, null]);
    await e.nextCard();
    await flush();
    // nothing else left: slide 1 after all
    expect(e.node?.id).toBe(one);
    expect(state(e, two)?.s).toBe(0.65);
  });

  test("not heard, a judge error and a tap before the microphone started log no score and change nothing", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string;
    e.start();
    await flush();
    grades.push({ body: { heard: "", meaning_ok: false, problems: [], clarity: 1, fluency: 1 } });
    await e.nextCard();
    await flush();
    grades.push({ status: 500, body: { error: "Busy." } });
    await e.nextCard();
    await flush();
    expect(state(e, one)).toBeNull();
    expect(entries(e).map((x) => [x.points, x.why])).toEqual([[null, "new"], [null, "failed"]]);
    // tapped before the microphone started: on to the next, nothing sent
    const n = grade().length;
    e.start();
    await e.nextCard();
    await flush();
    expect(grade().length).toBe(n);
  });

  test("a mumbled reading with the meaning right scores half; stumbles do not count", async () => {
    const e = make();
    e.setAim("familiar");
    e.start();
    await flush();
    grades.push({ body: { heard: "Good morning, and thank you for coming. Today we bake bread.", meaning_ok: false,
      problems: [{ kind: "stumble", script: "thank you", said: "thank thank you" }], clarity: 1, fluency: 1, pace: "too fast", tip: "Slow down." } });
    await e.nextCard();
    await flush();
    expect(entries(e)[0]).toMatchObject({ points: 60, read: { meaning: 100, delivery: 20, tip: "Slow down." } });
    expect(e.progress().slides).toEqual([{ slide: 1, points: 60, low: "delivery" }]);
  });

  test("offline: no microphone and no judge; each reading scored from Peek", async () => {
    const e = new Engine(SCRIPT, { ...deps(), canRecord: false });
    e.setAim("familiar");
    expect(e.offline).toBe(true);
    e.start();
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    expect([e.node?.id, e.phase]).toEqual([one, "ready"]);
    // peek 3 seconds in two holds: 70
    e.peek(true);
    expect(e.lines().every((l) => l.share === 0)).toBe(true);
    clock += 1000;
    e.peek(false);
    e.peek(false);
    e.peek(true);
    clock += 2000;
    e.advance();
    await flush();
    expect(entries(e)[0]).toMatchObject({ node: one, points: 70, why: "offline", peeks: 2, peekMs: 3000 });
    expect(entries(e)[0].read).toBeUndefined();
    // no peek: 100, at the bar
    expect(e.node?.id).toBe(two);
    e.advance();
    await flush();
    expect(entries(e)[1]).toMatchObject({ node: two, points: 100, peeks: 0 });
    expect(state(e, two)?.s).toBe(0.65);
    // slide 1 scored 70: read again; nothing is ever sent to the judge
    expect([e.node?.id, e.item?.why]).toEqual([one, "due"]);
    expect(grade()).toEqual([]);
    e.setOffline(false);
    expect(e.offline).toBe(true);
  });

  test("hiding climbs in small steps: none, none, then 3% of the slide after two good readings", async () => {
    const e = make();
    e.setAim("familiar");
    e.setRange([[1, 1]]);
    const one = e.tree.roots.get(1) as string;
    e.start();
    await flush();
    await e.nextCard();
    await flush();
    expect(state(e, one)).toMatchObject({ next: 0, streak: 1 });
    // a day later slide 1 is due again, read well again: 3% next time
    clock += 2 * 24 * 3600 * 1000;
    e.go();
    expect(e.node?.id).toBe(one);
    expect(e.share).toBe(0);
    await e.speak();
    await flush();
    await e.nextCard();
    await flush();
    expect(state(e, one)).toMatchObject({ next: 0.03, streak: 0 });
  });

  test("online, Peek counts by the time held: half a second scores at most 95, three seconds at most 70", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string;
    e.start();
    await flush();
    e.peek(true);
    clock += 500;
    e.peek(false);
    await e.nextCard();
    await flush();
    // 95: still recalled well
    expect(state(e, one)).toMatchObject({ next: 0, streak: 1 });
    expect(entries(e)[0]).toMatchObject({ peeks: 1, peekMs: 500, points: 95 });
    // slide 2 held for 3 s: 70, under the bar, so it comes back
    e.peek(true);
    clock += 3000;
    e.peek(false);
    await e.nextCard();
    await flush();
    expect(entries(e)[1]).toMatchObject({ peekMs: 3000, points: 70 });
  });

  test("the keys' engine side: Right arrow goes on after a verdict; offline at the gist, Next counts from Peek", async () => {
    const e = make();
    e.setAim("gist");
    e.start();
    await say(e);
    expect(e.phase).toBe("judged");
    e.advance();
    expect(e.phase).toBe("ready");
    e.advance();
    expect(e.phase).toBe("ready");
    e.peek(true);
    e.peek(true);
    expect(e.peeking).toBe(true);
    e.peek(false);
    e.setOffline(true);
    expect([e.offline, e.flow]).toEqual([true, false]);
    const before = e.log().length;
    clock += 1000;
    e.advance();
    expect(e.log().at(-1)).toMatchObject({ why: "offline", points: 100, peeks: 1 });
    expect(e.log().length).toBe(before + 1);
    e.nextOffline();
    e.show("home");
    e.peek(true);
    e.advance();
    expect(e.peeking).toBe(false);
  });

  test("the other modes still judge each card and show the verdict", async () => {
    const e = make();
    e.setAim("gist");
    e.start();
    expect(e.flow).toBe(false);
    await say(e);
    expect([e.phase, grade()[0].mode]).toEqual(["judged", "card"]);
  });
});

describe("looking counts", () => {
  test("Show me, then said off the screen, counts as missed; Peek caps the attempt by the time held", async () => {
    const e = make();
    e.setAim("gist");
    const one = e.tree.roots.get(1) as string;
    const all: State = { s: 0.6, at: clock, interval: 600000, n: 3, passes: 3, lastPass: clock, run: 0, hid: 0.5 };
    e.tree.order.filter((id) => id !== "t").forEach((id) => e.set(nodeKey(id), all));
    e.go();
    e.screen = "session";
    expect(e.node?.id).toBe(one);
    e.showMe();
    await say(e);
    // the judge heard it all, but it was read: missed
    expect([e.points, e.counted, state(e, one)?.run]).toEqual([50, false, 1]);
    e.go();
    e.peek(true);
    clock += 2000;
    e.peek(false);
    await say(e);
    expect(e.points).toBe(80);
  });
});

describe("from one mode to the next", () => {
  test("the log keeps the mode; the gist starts on the slides getting familiar found hard, then forgets them once tried", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    e.start();
    await flush();
    grades.push({ body: { heard: "Good morning, and thank you for coming. Today we bake bread.", meaning_ok: true, problems: [],
      clarity: 3, fluency: 3, pace: "good", tip: "Pause." } });
    await e.nextCard();
    await flush();
    await e.nextCard();
    await flush();
    expect(e.log().map((x) => [x.slide, x.aim, x.offline, x.points])).toEqual([[1, "familiar", false, 80], [2, "familiar", false, 100]]);
    expect(e.weak()).toEqual([]);
    e.setAim("gist");
    // slide 1 read at 80: hard; slide 2 at 100: not
    expect(e.weak()).toEqual([1]);
    e.go();
    expect(e.node?.slides).toEqual([1]);
    expect(e.node?.id).not.toBe(one);
    await say(e);
    expect(e.log().at(-1)).toMatchObject({ aim: "gist", offline: false });
    // tried at the gist since: no longer first
    expect(e.weak()).toEqual([]);
    expect(two).toBeTruthy();
  });

  test("the gist after getting familiar hides 20% on the first whole-slide attempt, then 40% after a good one", async () => {
    const e = make();
    e.setAim("familiar");
    e.setRange([[1, 1]]);
    const one = e.tree.roots.get(1) as string;
    e.start();
    await flush();
    await e.nextCard();
    await flush();
    e.setAim("gist");
    e.start();
    expect([e.node?.id, e.share]).toEqual([one, 0.2]);
    clock += 1000;
    await say(e);
    expect(state(e, one)?.peak).toBe(0.2);
    // read off the screen with Show me: no new peak
    e.go();
    expect(e.share).toBe(0.4);
    e.showMe();
    clock += 1000;
    await say(e);
    expect(state(e, one)?.peak).toBe(0.2);
  });

  test("given up, or peeked for more than 3 s, also counts as hard; an older entry with no mode is read as familiar", () => {
    const e = make();
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    const entry = (slide: number, node: string, over: Record<string, unknown>) => ({ id: `${slide}${JSON.stringify(over)}`, at: clock,
      node, slide, kind: "slide", height: 1, words: 5, before: 0, bar: 0.6, after: 0.5, hidden: 0, points: 100, pass: true, ms: 0,
      gap: null, why: "new", m: clock, ...over });
    e.set(`learn:log:2026-11-10`, { at: clock, list: [entry(1, one, { aim: "familiar", why: "gave up", points: 0 }),
      entry(2, two, { read: { meaning: 100, delivery: 100 }, peekMs: 4000 })] });
    e.setAim("verbatim");
    expect(e.weak()).toEqual([1, 2]);
  });
});

describe("back", () => {
  test("getting familiar: the Left arrow goes back to the slide before, recording again; not past the start", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    e.start();
    await flush();
    expect(e.canGoBack).toBe(false);
    await e.back();
    expect(e.node?.id).toBe(one);
    await e.nextCard();
    await flush();
    expect([e.node?.id, e.canGoBack]).toEqual([two, true]);
    await e.back();
    await flush();
    expect([e.node?.id, e.phase, e.recording, e.canGoBack]).toEqual([one, "listening", true, false]);
    // a new session starts with nothing to go back to
    e.start();
    expect(e.canGoBack).toBe(false);
  });

  test("at the gist: back to the card before, ready to speak", async () => {
    const e = make();
    e.setAim("gist");
    e.start();
    const first = e.node?.id;
    await say(e);
    e.advance();
    expect([e.phase, e.canGoBack]).toEqual(["ready", true]);
    await e.back();
    expect([e.node?.id, e.phase, e.canGoBack]).toEqual([first, "ready", false]);
  });
});

describe("pause", () => {
  test("getting familiar: Pause throws the recording away and keeps the slide; Resume records it again", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string;
    e.start();
    await flush();
    e.pause();
    e.pause();
    expect([e.paused, e.phase, e.recording, e.node?.id]).toEqual([true, "ready", false, one]);
    // the Right arrow resumes rather than moving on
    e.advance();
    await flush();
    expect([e.paused, e.phase, e.recording, e.node?.id]).toEqual([false, "listening", true, one]);
    await e.resume();
    expect(e.log()).toEqual([]);
    // only in getting familiar, during a session
    e.setAim("gist");
    e.pause();
    expect(e.paused).toBe(false);
  });

  test("offline: Resume without recording; moving on clears the pause", async () => {
    const e = new Engine(SCRIPT, { ...deps(), canRecord: false });
    e.setAim("familiar");
    e.start();
    e.pause();
    await e.resume();
    expect([e.paused, e.phase]).toEqual([false, "ready"]);
    e.pause();
    e.go();
    expect(e.paused).toBe(false);
  });
});

describe("give up", () => {
  test("getting familiar: 0, nothing sent, and the slide comes back after the next one", async () => {
    const e = make();
    e.setAim("familiar");
    const one = e.tree.roots.get(1) as string, two = e.tree.roots.get(2) as string;
    e.start();
    await flush();
    expect([e.node?.id, e.phase]).toEqual([one, "listening"]);
    await e.giveUp();
    await flush();
    // a miss: no more hidden next time (the step down is in the staircase tests)
    expect(state(e, one)).toMatchObject({ next: 0, streak: 0, run: 1 });
    expect(e.log()[0]).toMatchObject({ node: one, points: 0, why: "gave up" });
    expect([e.node?.id, e.phase]).toEqual([two, "listening"]);
    await e.nextCard();
    await flush();
    expect([e.node?.id, e.item?.why]).toEqual([one, "due"]);
    expect(sent.filter((x) => x.url === "/api/grade")).toHaveLength(1);
  });

  test("at the gist: a miss, so the next card goes down; not once judged, and not in a run-through", async () => {
    const e = make();
    e.setAim("gist");
    const one = e.tree.roots.get(1) as string;
    e.start();
    expect(e.node?.id).toBe(one);
    await e.giveUp();
    expect(e.log()[0]).toMatchObject({ node: one, points: 0, why: "gave up" });
    expect(e.node?.id).not.toBe(one);
    expect(e.node?.slides).toEqual([1]);
    await say(e);
    expect(e.phase).toBe("judged");
    const n = e.log().length;
    await e.giveUp();
    expect(e.log().length).toBe(n);
    e.show("home");
    await e.giveUp();
    expect(e.log().length).toBe(n);
  });
});

describe("settings, sync and migration", () => {
  test("the old trainer's settings until set here; its goal becomes a range from slide 1, kept within the talk", () => {
    storage.setItem(`${P}train:aim`, JSON.stringify("verbatim"));
    storage.setItem(`${P}train:goal`, JSON.stringify(1));
    const e = make();
    expect([e.aim, e.range, e.micOn]).toEqual(["verbatim", [[1, 1]], true]);
    e.setAim("gist");
    e.setRange([[40, 2]]);
    e.setMic(false);
    expect([e.aim, e.range, e.micOn]).toEqual(["gist", [[2, 2]], false]);
    expect(e.next?.n).toBe(2);
    // not a number: the whole talk
    e.setRange([[Number.NaN, 1]]);
    expect(e.range).toEqual([[1, 2]]);
    expect(JSON.parse(storage.getItem(`${P}learn:set:aim`)!)).toEqual({ v: "gist", at: clock });
    // the goal set in the new trainer before ranges
    storage.removeItem(`${P}learn:set:range`);
    storage.setItem(`${P}learn:set:goal`, JSON.stringify({ v: 2, at: 1 }));
    expect(e.range).toEqual([[1, 2]]);
  });

  test("only the slides in the range: a due node outside it waits; sections and the opening and close", () => {
    const e = make();
    expect([e.sections, e.ends]).toEqual([[], null]);
    e.setRange([[2, 2]]);
    e.start();
    expect(e.node?.slides).toEqual([2]);
    // slide 1 known, then faded: not picked while the range is slide 2
    e.tree.order.filter((id) => e.tree.nodes.get(id)!.slides[0] === 1).forEach((id) => e.set(nodeKey(id),
      { s: 0.9, at: clock - 30 * 3600000, interval: 600000, n: 3, passes: 3, lastPass: clock, run: 0, hid: 1 }));
    e.go();
    expect(e.node?.slides).toEqual([2]);
    e.setRange([[1, 2]]);
    e.go();
    expect([e.node?.slides, e.item?.why]).toEqual([[1], "due"]);
    const four = new Engine({ ...SCRIPT, slides: [1, 2, 3, 4].map((n) => ({ n, title: `S${n}`, image: null, section: n < 3 ? "Start" : n === 3 ? "Middle" : "End",
      sentences: [sentence(1, `Slide ${n} says this.`)] })) }, deps());
    expect(four.sections).toEqual([{ name: "Start", from: 1, to: 2 }, { name: "Middle", from: 3, to: 3 }, { name: "End", from: 4, to: 4 }]);
    expect(four.ends).toEqual([[1, 2], [4, 4]]);
    four.setRange(four.ends!);
    four.start();
    expect(four.node?.slides).toEqual([1]);
  });

  test("pull: merged with the online copy (the newer wins), the old scores carried over once, then saved", async () => {
    const [h1] = [SCRIPT.slides[0].sentences[0].hash];
    storage.setItem(`${P}flow:s:1:1:${h1}`, JSON.stringify({ m: 0.8, at: clock - 1000, passes: 2, n: 3, focus: [], full: 0 }));
    const e = make();
    const [a] = e.tree.order;
    server[nodeKey("s:2:0-0:x")] = { s: 0.5, at: clock };
    await e.pull();
    expect(state(e, a)).toMatchObject({ s: 0.8, passes: 2 });
    expect(e.get("learn:set:migrated", null)).toEqual({ v: true, at: clock });
    expect(server[nodeKey(a)]).toMatchObject({ s: 0.8 });
    expect(e.get(nodeKey("s:2:0-0:x"), null)).toEqual({ s: 0.5, at: clock });
    expect(e.sync.state).toBe("on");
    // not again
    e.set(nodeKey(a), { ...state(e, a)!, s: 0.3 });
    await e.pull();
    expect(state(e, a)!.s).toBe(0.3);
  });

  test("offline: kept in this browser, and the save tried again later", async () => {
    const e = new Engine(SCRIPT, { ...deps(), fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
    await e.pull();
    expect(e.sync.state).toBe("error");
    await e.push();
    expect(e.sync.state).toBe("error");
    const bad = new Engine(SCRIPT, { ...deps(), fetch: (async () => new Response("{}", { status: 500 })) as typeof fetch });
    await bad.push();
    expect(bad.sync.state).toBe("error");
    e.pagehide();
    e.pushSoon();
    e.pagehide();
    await flush();
  });

  test("the home and Progress figures", async () => {
    const e = make();
    expect(e.summary()).toEqual({ at: 0, total: 2, due: 0 });
    e.start();
    await say(e);
    expect(e.progress().session).toMatchObject({ n: 1, passed: 1 });
    expect(e.days).toBe(1);
    e.show("progress");
    expect(e.screen).toBe("progress");
  });
});

const base64Of = (s: string) => Buffer.from(s).toString("base64");
test("base64 of a recording", async () => {
  expect(await base64(new Blob(["sound"]))).toBe(base64Of("sound"));
  const big = new Uint8Array(100000).fill(65);
  expect((await base64(new Blob([big]))).length).toBe(Math.ceil(100000 / 3) * 4);
});
