// Times are in London (vitest.config.ts sets TZ); the talk here is 2026-11-14 19:00 UTC, so the cut-off for new
// sentences is 2026-11-11 19:00.
import { describe, expect, test } from "vitest";
import {
  ago, countdown, dayStart, days, logged, merge, minutes, plan, type Planned, progress, review, streak, tally, target,
  wait, ymd,
} from "@/lib/schedule";

const TALK = Date.parse("2026-11-14T11:00:00-08:00");
const at = Date.parse;
const SUNDAY = 1794139200000; // 2026-11-08 12:00 UTC
const HOUR = 3600000;

describe("the scheduler", () => {
  test("waits longer at each level and compresses to the talk", () => {
    const full = [1, 2, 3, 4].map((l) => wait(l, at("2026-11-08T12:00:00Z"), TALK));
    expect(full).toEqual([10 * 60000, HOUR, 8 * HOUR, 24 * HOUR]);
    // on Friday at noon, 31 hours before the talk, every wait shrinks so the rest of the ladder fits in half of it
    const left = 31 * HOUR, ladder = [10 * 60000, HOUR, 8 * HOUR, 24 * HOUR];
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const want = ladder.map((w, i) => Math.round(w * Math.min(1, left / (2 * sum(ladder.slice(i))))));
    expect([1, 2, 3, 4].map((l) => wait(l, at("2026-11-13T12:00:00Z"), TALK))).toEqual(want);
    expect(want[0]).toBeLessThan(full[0]);
    expect(want[3]).toBeLessThan(full[3]);
    // after the talk there is nothing to wait for
    expect(wait(2, TALK + 1, TALK)).toBe(0);
  });

  test("a pass moves a card up and a fail down with a lapse", () => {
    const t = SUNDAY;
    expect(review(null, true, t, TALK, 0.95)).toEqual(
      { level: 1, due: t + 600000, streak: 1, lapses: 0, intro: t, acc: 0.95, last: t });
    const card = { level: 3, due: 0, streak: 4, lapses: 1, intro: 5, acc: 1, last: 5 };
    expect(review(card, false, t, TALK, null)).toEqual(
      { level: 2, due: t, streak: 0, lapses: 2, intro: 5, acc: null, last: t });
    expect(review({ ...card, level: 4 }, true, t, TALK, 1).level).toBe(4);
    expect(review(null, false, t, TALK, 0.5).level).toBe(0);
  });

  test("the daily target introduces every sentence by the cut-off", () => {
    // Sunday noon: today and three more days, so 300 sentences are 75 a day
    expect(target(300, 0, at("2026-11-08T12:00:00Z"), TALK)).toBe(75);
    // 40 done today already: the rest of today's share is counted in
    expect(target(260, 40, at("2026-11-08T20:00:00Z"), TALK)).toBe(75);
    expect(target(7, 0, at("2026-11-10T09:00:00Z"), TALK)).toBe(4);
    // on the cut-off day, and after, everything left is due today
    expect([target(30, 5, at("2026-11-11T08:00:00Z"), TALK), target(30, 0, at("2026-11-12T08:00:00Z"), TALK)])
      .toEqual([35, 30]);
  });
});

type Plain = Planned<object>;
const keys = (p: ReturnType<typeof plan<object>>) =>
  ({ ...p, due: p.due.map((c) => c.key), news: p.news.map((c) => c.key), queue: p.queue.map((c) => c.key) });

describe("today's session", () => {
  const card = (key: string, level: number, due: number, intro = SUNDAY - 30 * HOUR): Plain =>
    ({ key, pick: true, state: { level, due, intro } });

  test("due reviews first, oldest first, then new sentences in talk order", () => {
    const cards: Plain[] = [card("r1", 2, SUNDAY - HOUR), card("r2", 4, SUNDAY - 2 * HOUR), card("later", 1, SUNDAY + HOUR),
      ...Array.from({ length: 8 }, (_, i) => ({ key: `n${i}`, pick: i % 2 === 0, state: null }))];
    const p = keys(plan(cards, SUNDAY, TALK));
    // new sentences within the section filter, up to today's target of 2
    expect([p.due, p.news, p.queue]).toEqual([["r2", "r1"], ["n0", "n2"], ["r2", "r1", "n0", "n2"]]);
    expect([p.top, p.total, p.behind, p.next]).toEqual([1, 11, false, SUNDAY + HOUR]);
    // sentences started today count against today's target: 8 new and 2 started today is 3 for today, 1 left
    cards.push(card("t1", 0, SUNDAY + HOUR, SUNDAY - HOUR), card("t2", 0, SUNDAY + HOUR, SUNDAY - HOUR));
    expect(keys(plan(cards, SUNDAY, TALK)).news).toEqual(["n0"]);
    // nothing started yet: on track, nothing due next
    const q = keys(plan([{ key: "n", pick: true, state: null }], SUNDAY, TALK));
    expect([q.news, q.behind, q.next]).toEqual([["n"], false, null]);
  });

  test("behind when the daily target has grown or the cut-off has passed", () => {
    const tuesday = 1794312000000, thursday = 1794484800000; // noon UTC on 10 and 12 November
    const started: Plain = { key: "s", pick: true, state: { level: 1, due: tuesday + 1, intro: SUNDAY } };
    const fresh: Plain[] = Array.from({ length: 7 }, (_, i) => ({ key: `n${i}`, pick: true, state: null }));
    // planned on Sunday at 2 a day (8 over 4 days); on Tuesday 7 are left over 2 days, 4 a day
    expect(plan([started, ...fresh], SUNDAY, TALK).behind).toBe(false);
    expect(plan([started, ...fresh], tuesday, TALK).behind).toBe(true);
    // after the cut-off, any sentence not started is behind
    const done: Plain = { ...started, state: { level: 1, due: tuesday + 1, intro: thursday - 1 } };
    expect(plan([done, ...fresh], thursday, TALK).behind).toBe(true);
    expect(plan([done], thursday, TALK).behind).toBe(false);
  });

  test("extra new sentences on request, the session length and the countdown", () => {
    const cards: Plain[] = Array.from({ length: 8 }, (_, i) => ({ key: `n${i}`, pick: true, state: null }));
    expect(plan(cards, SUNDAY, TALK).news.length).toBe(2);
    expect(plan(cards, SUNDAY, TALK, 3).news.length).toBe(5);
    // 10 seconds a card plus 0.8 seconds a word, at least a minute
    expect([minutes([]), minutes([{ words: 20 }]), minutes(Array(10).fill({ words: 25 }))]).toEqual([1, 1, 5]);
    expect(["2026-11-09T08:00:00Z", "2026-11-13T08:00:00Z", "2026-11-14T08:00:00Z", "2026-11-14T20:00:00Z"]
      .map((d) => countdown(at(d), TALK))).toEqual(
      ["5 days to the talk", "The talk is tomorrow", "The talk is today", "The talk has been given"]);
  });
});

describe("progress", () => {
  test("the streak, local days and the progress table", () => {
    const dates = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-01"];
    expect(["2026-11-08T20:00:00Z", "2026-11-09T08:00:00Z", "2026-11-10T08:00:00Z"].map((d) => streak(dates, at(d))))
      .toEqual([3, 3, 0]);
    expect([ymd(at("2026-11-08T23:30:00Z")), dayStart(at("2026-11-08T23:30:00Z")),
      days(at("2026-11-08T23:00:00Z"), at("2026-11-09T01:00:00Z"))]).toEqual(["2026-11-08", 1794096000000, 1]);
    const cards = [{ section: "A", words: 5, level: null }, { section: "A", words: 3, level: 4 },
      { section: "B", words: 2, level: 0 }, { section: "A", words: 1, level: 4 }];
    expect(tally(cards)).toEqual([
      { section: "A", sentences: [1, 0, 0, 0, 0, 2], words: [5, 0, 0, 0, 0, 4] },
      { section: "B", sentences: [0, 1, 0, 0, 0, 0], words: [0, 2, 0, 0, 0, 0] },
    ]);
  });

  test("imported progress keeps the newer review of each card", () => {
    const mine = { "train:a:1:abc123": { level: 3, last: 20 }, "train:a:2:def456": { level: 1, last: 10 },
      "train:days": ["2026-11-08"], "train:mic": false };
    const theirs = { "train:a:1:abc123": { level: 1, last: 15 }, "train:a:2:def456": { level: 2, last: 30 },
      "train:b:1:0a0a0a": { level: 0, last: 5 }, "train:days": ["2026-11-07", "2026-11-08"], "train:mic": true,
      "train:view": "stats" };
    expect(merge(mine, theirs)).toEqual({
      "train:a:1:abc123": { level: 3, last: 20 }, "train:a:2:def456": { level: 2, last: 30 },
      "train:b:1:0a0a0a": { level: 0, last: 5 }, "train:days": ["2026-11-07", "2026-11-08"], "train:mic": false,
      "train:view": "stats" });
    // a card cleared on the other side does not wipe ours; days join an empty list
    expect(merge({ "train:a:1:ff": { last: 1 } }, { "train:a:1:ff": null, "train:days": ["2026-11-09"] }))
      .toEqual({ "train:a:1:ff": { last: 1 }, "train:days": ["2026-11-09"] });
  });

  test("the running scores of the flow and the learning engine: the newer at wins, whichever side it is on", () => {
    const mine = { "flow:s:1:1:aa": { m: 0.9, at: 20 }, "flow:s:1:2:bb": { m: 0.2, at: 10 }, "learn:n:x": { s: 0.5, at: 5 },
      "flow:w:1:0:1": { n: 3, done: true, at: 7 } };
    const theirs = { "flow:s:1:1:aa": { m: 0.1, at: 15 }, "flow:s:1:2:bb": { m: 0.8, at: 30 }, "learn:n:x": { s: 0.9, at: 6 },
      "learn:n:y": { s: 0.4, at: 1 }, "flow:w:1:0:1": { n: 1, done: false, at: 8 } };
    expect(merge(mine, theirs)).toEqual({ "flow:s:1:1:aa": { m: 0.9, at: 20 }, "flow:s:1:2:bb": { m: 0.8, at: 30 },
      "learn:n:x": { s: 0.9, at: 6 }, "learn:n:y": { s: 0.4, at: 1 }, "flow:w:1:0:1": { n: 1, done: false, at: 8 } });
  });

  test("progress on the home screen", () => {
    const s1 = { n: 3, title: "Three" }, s2 = { n: 7, title: "Seven" };
    const cards = [{ s: s1, state: null }, { s: s1, state: { level: 0, lapses: 2 } }, { s: s1, state: { level: 2, lapses: 1 } },
      { s: s2, state: { level: 4, lapses: 5 } }, { s: s2, state: { level: 1, lapses: 0 } },
      { s: s2, state: { level: 2, lapses: 3 } }];
    // levels: new, 0, 1, 2, 3, 4; a learned card's old misses do not count; the most misses first, then talk order
    expect(progress(cards)).toEqual({ levels: [1, 1, 1, 2, 0, 1], started: 5,
      weak: [{ n: 3, title: "Three", misses: 3 }, { n: 7, title: "Seven", misses: 3 }] });
    expect(progress([])).toEqual({ levels: [0, 0, 0, 0, 0, 0], started: 0, weak: [] });
    expect([logged(null, true), logged({ n: 4, got: 3 }, false)]).toEqual([{ n: 1, got: 1 }, { n: 5, got: 3 }]);
    expect([0, 59e3, 6e5, 7.2e6, 2.6e8].map((d) => ago(1e9, 1e9 + d))).toEqual(
      ["just now", "just now", "10 min ago", "2 h ago", "3 days ago"]);
  });
});
