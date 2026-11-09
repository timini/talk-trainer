// The scheduler, planned to the talk, and the progress figures. Times are milliseconds; days are local days.

export type Card = { level: number; due: number; streak: number; lapses: number; intro: number; acc: number | null; last: number };

export const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// The wait after a pass, by the level reached: about 10 minutes at level 1, an hour at 2, 8 hours at 3, a day
// at 4. Compressed so the waits still ahead of the card fit in half the time left before the talk.
const WAIT = [0, 10 * MIN, HOUR, 8 * HOUR, DAY];
export const wait = (level: number, now: number, talk: number): number => {
  const ahead = WAIT.slice(level).reduce((a, b) => a + b, 0);
  return Math.round(WAIT[level] * Math.min(1, Math.max(0, talk - now) / (2 * ahead)));
};

// A pass moves a card up a level, a fail down one and makes it due now. Card: level, due, streak, lapses, last
// accuracy (null when the speaker marked themselves), when it was introduced and last reviewed.
export const review = (card: Card | null, pass: boolean, now: number, talk: number, acc: number | null): Card => {
  const c = card || { level: 0, streak: 0, lapses: 0, intro: now };
  const level = pass ? Math.min(4, c.level + 1) : Math.max(0, c.level - 1);
  return { ...c, level, due: now + (pass ? wait(level, now, talk) : 0), streak: pass ? c.streak + 1 : 0,
    lapses: c.lapses + (pass ? 0 : 1), acc, last: now };
};

export const dayStart = (t: number): number => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const days = (from: number, to: number): number => Math.round((dayStart(to) - dayStart(from)) / DAY);
const two = (n: number) => String(n).padStart(2, "0");
export const ymd = (t: number): string => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };

// Every sentence is introduced three days before the talk, leaving three days to reach level 4.
const introBy = (talk: number) => talk - 3 * DAY;

// New sentences a day: those not started, plus today's, spread over the days left to introduce them.
export const target = (fresh: number, today: number, now: number, talk: number): number => {
  const left = days(now, introBy(talk)) + 1;
  return left <= 1 ? fresh + today : Math.ceil((fresh + today) / left);
};

export type Planned<T> = { key: string; state: Pick<Card, "level" | "due" | "intro"> | null; pick: boolean } & T;

// Today's session. cards: [{key, state (null if new), pick (in the section filter)}], in talk order. Due reviews
// first, oldest first, then new sentences in talk order up to today's target, plus any extra asked for.
// Behind: the daily target has grown by more than a quarter since the first day, or the cut-off for new sentences
// has passed with sentences still new.
export const plan = <T>(cards: Planned<T>[], now: number, talk: number, extra = 0) => {
  const started = cards.filter((c) => c.state);
  const state = (c: Planned<T>) => c.state as NonNullable<Planned<T>["state"]>;
  const due = started.filter((c) => state(c).due <= now).sort((a, b) => state(a).due - state(b).due);
  const fresh = cards.filter((c) => !c.state);
  const today = started.filter((c) => state(c).intro >= dayStart(now)).length;
  const goal = target(fresh.length, today, now, talk);
  const news = fresh.filter((c) => c.pick).slice(0, Math.max(0, goal - today) + extra);
  const first = started.reduce((a, c) => Math.min(a, state(c).intro), now);
  const behind = (fresh.length > 0 && now >= introBy(talk)) || goal > 1.25 * target(cards.length, 0, first, talk);
  const later = started.filter((c) => state(c).due > now).reduce((a, c) => Math.min(a, state(c).due), Infinity);
  return { due, news, queue: due.concat(news), top: started.filter((c) => state(c).level >= 4).length,
    total: cards.length, behind, next: later === Infinity ? null : later };
};

// About how long a session takes: 10 seconds a card, and the time to say its words twice at 150 a minute.
export const minutes = (cards: { words: number }[]): number =>
  Math.max(1, Math.round(cards.reduce((a, c) => a + 10 + 0.8 * c.words, 0) / 60));

// Days to the talk, in words.
export const countdown = (now: number, talk: number): string => {
  const n = days(now, talk);
  if (now >= talk) return "The talk has been given";
  return n <= 0 ? "The talk is today" : n === 1 ? "The talk is tomorrow" : `${n} days to the talk`;
};

// Days in a row with practice, ending today (or yesterday, before today's first card).
export const streak = (dates: string[], now: number): number => {
  const have = new Set(dates);
  const d = new Date(dayStart(now));
  if (!have.has(ymd(d.getTime()))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (have.has(ymd(d.getTime()))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
};

// Sentences and words at each level (new, then 0 to 4), by section, in talk order.
export const tally = (cards: { section: string; words: number; level: number | null }[]) => {
  const rows: { section: string; sentences: number[]; words: number[] }[] = [];
  cards.forEach((c) => {
    let row = rows.find((r) => r.section === c.section);
    if (!row) { row = { section: c.section, sentences: [0, 0, 0, 0, 0, 0], words: [0, 0, 0, 0, 0, 0] }; rows.push(row); }
    const at = c.level === null ? 0 : c.level + 1;
    row.sentences[at] += 1;
    row.words[at] += c.words;
  });
  return rows;
};

// Imported progress: for each card (a sentence card, or a slide part of the flow) the newer review wins, practice
// days are joined, and other settings stay.
const CARD = /^(train:[^:]+:\d+:[0-9a-f]+|flow:\d+:\d+)$/;
export const merge = (mine: Record<string, unknown>, theirs: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...mine };
  Object.entries(theirs).forEach(([k, v]) => {
    if (CARD.test(k)) {
      const have = out[k] as { last: number } | undefined, got = v as { last: number } | null;
      if (!have || (got && got.last > have.last)) out[k] = v;
    } else if (k === "train:days") out[k] = [...new Set([...((out[k] as string[]) || []), ...(v as string[])])].sort();
    else if (!(k in out)) out[k] = v;
  });
  return out;
};

// Progress for the home screen. cards: [{s: {n, title}, state (null if new)}]. Sentences at each level (new, then
// 0 to 4), how many are started, and up to 3 slides to work on: those whose sentences below level 3 have been
// missed most, most misses first.
type Slide = { n: number; title: string };
export const progress = (cards: { s: Slide; state: { level: number; lapses: number } | null }[]) => {
  const levels = [0, 0, 0, 0, 0, 0], weak = new Map<Slide, Slide & { misses: number }>();
  cards.forEach((c) => {
    levels[c.state ? c.state.level + 1 : 0] += 1;
    if (!c.state || !c.state.lapses || c.state.level >= 3) return;
    const w = weak.get(c.s) || { n: c.s.n, title: c.s.title, misses: 0 };
    w.misses += c.state.lapses;
    weak.set(c.s, w);
  });
  return { levels, started: cards.length - levels[0],
    weak: [...weak.values()].sort((a, b) => b.misses - a.misses || a.n - b.n).slice(0, 3) };
};

// A day's count of cards marked and got, after one more.
export const logged = (day: { n: number; got: number } | null, pass: boolean) =>
  ({ n: (day ? day.n : 0) + 1, got: (day ? day.got : 0) + (pass ? 1 : 0) });

// When the progress was last saved online, in words.
export const ago = (then: number, now: number): string => {
  const m = Math.floor((now - then) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} days ago`;
};
