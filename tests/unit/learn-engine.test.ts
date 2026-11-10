// The /learn engine with fakes for the browser: storage, fetch, the clock, the microphone and the audio.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { base64, type Deps, Engine, type Recording } from "@/app/talks/[id]/learn/engine";
import type { State } from "@/lib/learn/model";
import { nodeKey } from "@/lib/learn/store";
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
const deps = (): Deps => ({
  storage, now: () => clock, canRecord: true,
  fetch: (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    sent.push({ url, body });
    if (url === "/api/grade") {
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
    expect([e.phase, e.counted]).toEqual(["judged", true]);
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
    expect(state(e, a)!.hid).toBe(0);
    e.go();
    const b = e.node!.id;
    e.knowIt();
    expect(state(e, b)).toMatchObject({ s: 0.9, hid: 1 });
    expect(e.node?.id).not.toBe(b);
  });

  test("no trouble yet: every word 0; nothing on screen: none", () => {
    const e = make();
    expect(e.troubles()).toEqual([]);
    e.start();
    expect(e.troubles()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("Hear it plays the clips of what is to be said", () => {
    const e = make();
    e.hear();
    e.start();
    e.hear();
    e.hear();
    expect(played).toEqual([["/clip/39"], ["/clip/39"]]);
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

describe("settings, sync and migration", () => {
  test("the old trainer's settings until set here; the goal kept within the talk", () => {
    storage.setItem(`${P}train:aim`, JSON.stringify("verbatim"));
    storage.setItem(`${P}train:goal`, JSON.stringify(1));
    const e = make();
    expect([e.aim, e.goal, e.micOn]).toEqual(["verbatim", 1, true]);
    e.setAim("gist");
    e.setGoal(40);
    e.setGoal(Number.NaN);
    e.setMic(false);
    expect([e.aim, e.goal, e.micOn]).toEqual(["gist", 2, false]);
    expect(JSON.parse(storage.getItem(`${P}learn:set:aim`)!)).toEqual({ v: "gist", at: clock });
    expect(e.next?.n).toBe(1);
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
