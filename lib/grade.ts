// Grading what was heard against a sentence. The words of a text become tokens to compare, each with the display
// words (split on spaces) it came from. Case, punctuation and apostrophes are ignored; number words become digits
// ("nine" and 9, "zero point nine five" and 0.95, "two hundred thousand" and 200,000) and % is "percent". How speech
// recognition splits or joins words (Splice AI, B R C A 1, example dot io) is left to the alignment below.

export type Token = { t: string; o: number[]; stop?: boolean };
export type Said = "ok" | "close" | false;
export type Mark = { w: string; ok: boolean; crit: boolean; close: boolean };
export type Part = { acc: number; pass: boolean; critWrong: number; words: Mark[] };
export type Result = { parts: Part[]; pass: boolean; acc: number; at: number; left: number };

const NUM: Record<string, number> = {};
["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"].forEach((w, i) => { NUM[w] = i; });
["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].forEach((w, i) => { NUM[w] = 20 + 10 * i; });
const digit = (t: string | undefined): boolean => t !== undefined && NUM[t] !== undefined && NUM[t] < 10;

type Run = { total: number; cur: number; last: number | null; o: number[]; frac: string };

const numbers = (raw: Token[]): Token[] => {
  const out: Token[] = [];
  let run: Run | null = null;
  const flush = () => {
    if (run) out.push({ t: String(run.total + run.cur) + (run.frac ? `.${run.frac}` : ""), o: run.o });
    run = null;
  };
  // Whether a number word can carry on the number so far: "twenty one" is 21, "one two" is 1 then 2.
  const fits = (last: number | null, v: number) =>
    last === null || last >= 100 || (last >= 20 && last % 10 === 0 && v > 0 && v < 10);
  for (let i = 0; i < raw.length; i += 1) {
    const { t, o } = raw[i];
    const v = NUM[t];
    // A local copy, so the checks below narrow it; flush() clears the shared one.
    const r = run as Run | null;
    if (v !== undefined) {
      if (r && !fits(r.last, v)) flush();
      const cur: Run = run ?? { total: 0, cur: 0, last: null, o: [], frac: "" };
      run = cur;
      cur.cur += v;
      cur.last = v;
      cur.o = cur.o.concat(o);
    } else if (r && t === "hundred") {
      r.cur = (r.cur || 1) * 100;
      r.last = 100;
      r.o = r.o.concat(o);
    } else if (r && t === "thousand") {
      r.total += (r.cur || 1) * 1000;
      r.cur = 0;
      r.last = 1000;
      r.o = r.o.concat(o);
    } else if (r && t === "point" && digit(raw[i + 1]?.t)) {
      r.o = r.o.concat(o);
      while (digit(raw[i + 1]?.t) && !raw[i].stop) {
        i += 1;
        r.frac += NUM[raw[i].t];
        r.o = r.o.concat(raw[i].o);
      }
      flush();
    } else {
      flush();
      out.push(raw[i]);
    }
    if (raw[i].stop) flush();
  }
  flush();
  return out;
};

export const tokens = (text: string): Token[] => {
  const raw: Token[] = [];
  text.split(/\s+/).filter(Boolean).forEach((word, o) => {
    const w = word.toLowerCase().replace(/[’‘]/g, "'").replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
      .replace(/^\$(\d[\d.]*)/, "$1 dollars").replace(/^-(?=\d)/, "minus ").replace(/(\d)'$/, "$1 prime")
      .replace(/%/g, " percent ").replace(/&/g, " and ");
    (w.match(/[\p{L}\p{N}]+(?:['.][\p{L}\p{N}]+)*/gu) || []).forEach((t) => {
      const plain = t.replace(/'/g, "");
      // a dot inside a word is said "dot": example.io is example dot io; 0.95 stays a number
      const bits = /^\d+(\.\d+)+$/.test(plain) ? [plain] : plain.split(".").flatMap((p, k) => (k ? ["dot", p] : [p]));
      bits.forEach((p) => raw.push({ t: p, o: [o] }));
    });
    // A comma or full stop after a word ends a number: "nine, two" is 9 then 2.
    if (raw.length && /[,.;:!?]["”’)]?$/.test(word)) raw[raw.length - 1].stop = true;
  });
  return numbers(raw);
};

export const normalise = (text: string): string[] => tokens(text).map((x) => x.t);

export const edits = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next.push(Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    row = next;
  }
  return row[b.length];
};

// A word with a simple ending taken off (learned, models, ranking), and with a final e dropped (making, make).
const ENDINGS = ["ing", "ed", "es", "er", "s", "d"];
const forms = (w: string): string[] => {
  const out = [w, ...ENDINGS.filter((e) => w.endsWith(e) && w.length - e.length >= 3).map((e) => w.slice(0, -e.length))];
  return out.concat(out.filter((x) => x.length > 3 && x.endsWith("e")).map((x) => x.slice(0, -1)));
};

// A sound key, so names come out alike however the recogniser spells them: ph is f, ck and q are k, z is s, c is s
// before e, i or y and k otherwise, vowels after the first letter go, and doubled letters are one. AlphaMissense
// and "alpha Ms sense" are both alfmsns; CADD and "cad" are both kd.
export const phon = (w: string): string => {
  const k = w.replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/ck/g, "k").replace(/q/g, "k").replace(/z/g, "s")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
  return (k.slice(0, 1) + k.slice(1).replace(/[aeiou]/g, "")).replace(/(.)\1+/g, "$1");
};

// How well a spoken word matches a written one: 0 the same, 1 close, null not at all. Numbers must be the same.
// Close: a simple ending apart (learn and learned, model and models, rank and ranking); for a name (name: true)
// or a word of 8 letters or more, the same sound key, or keys of 5 letters or more one apart; for words of 8
// letters or more, up to a quarter of the letters different; for words of 6 or 7, one letter. A close word
// counts as said.
export const match = (a: string, b: string, name = false): 0 | 1 | null => {
  if (a === b) return 0;
  if (!a || !b || /\d/.test(a + b)) return null;
  const fa = forms(a);
  if (forms(b).some((x) => fa.includes(x))) return 1;
  const most = Math.max(a.length, b.length);
  if (name || most >= 8) {
    const ka = phon(a), kb = phon(b);
    if (ka === kb || (Math.min(ka.length, kb.length) >= 5 && edits(ka, kb) <= 1)) return 1;
  }
  const slack = most >= 8 ? Math.floor(most / 4) : 1;
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > slack) return null;
  return edits(a, b) <= slack ? 1 : null;
};

// Number words said as their sound-alikes, counted only straight after a name: "evo to" for Evo 2.
const SOUNDS: Record<string, string[]> = { 2: ["to", "too"], 4: ["for"] };
// Words run together, as speech recognition may split or join them; "dot" may be left out.
const glue = (ts: string[]): string => ts.filter((t) => t !== "dot").join("");

// A word-level edit distance between what should be said (ref) and what was heard (hyp). Up to 5 spoken words
// may make one written word (example dot io, B R C A 1 and BRCA1, Splice AI and SpliceAI), and one spoken word up
// to 3 written ones (evo2 and Evo 2). named: which written words are names or long words, which may match by
// sound. For each written word: "ok", "close" or false. On a tie a written word counts as left out, so a part said
// so far lines up with the start.
const MISS = 100;
type Step = [number, number, 0 | 1 | null];
export const align = (ref: string[], hyp: string[], named: boolean[] = []): Said[] => {
  const n = ref.length, m = hyp.length, d: number[][] = [], how: Step[][] = [];
  for (let i = 0; i <= n; i += 1) {
    d.push([]);
    how.push([]);
    for (let j = 0; j <= m; j += 1) {
      if (!i || !j) { d[i][j] = (i + j) * MISS; how[i][j] = [i ? 1 : 0, i ? 0 : 1, null]; continue; }
      let top: [number, number, 0 | 1 | null, number] = [1, 0, null, d[i - 1][j] + MISS];
      const take = (a: number, b: number, q: 0 | 1 | null, cost: number) => { if (cost < top[3]) top = [a, b, q, cost]; };
      for (let a = 1; a <= Math.min(3, i); a += 1) {
        for (let b = 1; b <= Math.min(a > 1 ? 1 : 5, j); b += 1) {
          let q = a === 1 && b === 1 ? match(ref[i - 1], hyp[j - 1], !!named[i - 1])
            : match(glue(ref.slice(i - a, i)), glue(hyp.slice(j - b, j)), named.slice(i - a, i).some(Boolean));
          if (q === null && a === 1 && b === 1 && i > 1 && named[i - 2] && (SOUNDS[ref[i - 1]] || []).includes(hyp[j - 1])) q = 1;
          if (q !== null) take(a, b, q, d[i - a][j - b] + q);
        }
      }
      take(1, 1, null, d[i - 1][j - 1] + MISS);
      take(0, 1, null, d[i][j - 1] + MISS);
      d[i][j] = top[3];
      how[i][j] = [top[0], top[1], top[2]];
    }
  }
  const ok: Said[] = ref.map(() => false);
  for (let i = n, j = m; i > 0 || j > 0;) {
    const [a, b, q] = how[i][j];
    for (let k = i - a; k < i; k += 1) ok[k] = q === null ? false : q ? "close" : "ok";
    i -= a;
    j -= b;
  }
  return ok;
};

// A must-say item is said when its words run together are a run of the spoken words run together: example.io in
// "example dot io", 9 cases in 10 in "nine cases in ten".
export const said = (item: string, hyp: string[]): boolean => {
  const want = glue(normalise(item));
  for (let i = 0; i < hyp.length; i += 1) {
    let got = "";
    for (let j = i; j < hyp.length && got.length < want.length; j += 1) got += hyp[j] === "dot" ? "" : hyp[j];
    if (got === want) return true;
  }
  return !want;
};

// A sentence passes with at least 85% of its words said (close counts) and no number or must-say item wrong.
export const PASS = 0.85;
// Small words: left out, they do not count against the 85%. Added words never count.
const SMALL = new Set(["a", "an", "the", "and", "so", "i", "we", "it", "that", "of", "to", "is", "are", "have", "has"]);

// A name: a capital after the first letter of a sentence (CADD, SpliceAI, Evo), a digit, or 8 letters or more.
const isName = (w: string, first: boolean): boolean => {
  const bare = w.replace(/[^\p{L}\p{N}]/gu, "");
  return /\d/.test(bare) || /\p{Lu}/u.test(first ? bare.slice(1) : bare) || bare.length >= 8;
};

type Ref = Token & { p: number; crit: boolean; name: boolean };

// Grade what was heard against one or more sentences said in a row: the page's own grade, used only when the judge
// cannot answer. A sentence passes with at least 85% of its words said (close counts, small words left out and
// words added do not count) and no number (a word written with a digit) or must-say item wrong; a chain passes if
// all of them do. Each sentence's display words come back marked (ok, close, crit), with at (the first display
// word, counted across all the sentences, after the last one said) and left (the words still to say), which a
// run-through follows.
export const grade = (parts: string[], heard: string, must: string[]): Result => {
  const words = parts.map((t) => t.split(/\s+/).filter(Boolean));
  const ref: Ref[] = [];
  parts.forEach((t, p) => tokens(t).forEach((x) => ref.push({ ...x, p, crit: x.o.some((o) => /\d/.test(words[p][o])),
    name: x.o.some((o) => isName(words[p][o], o === 0)) })));
  const hyp = normalise(heard);
  const ok = align(ref.map((x) => x.t), hyp, ref.map((x) => x.name));
  // A must-say item is said when each of its words was said, closely or by sound (dotted), or when it is a run of
  // the spoken words exactly; otherwise all of it is wrong.
  must.forEach((item) => {
    const seq = normalise(item), exact = said(item, hyp);
    for (let i = 0; seq.length && i + seq.length <= ref.length; i += 1) {
      if (!seq.every((t, k) => ref[i + k].t === t)) continue;
      const yes = exact || seq.every((_, k) => ok[i + k]);
      seq.forEach((_, k) => { ref[i + k].crit = true; ok[i + k] = yes && (ok[i + k] || "ok"); });
    }
  });
  const marks: Mark[][] = words.map((ws) => ws.map((w) => ({ w, ok: true, crit: false, close: false })));
  const tally = parts.map(() => ({ right: 0, total: 0, crit: 0 }));
  ref.forEach((x, k) => {
    const t = tally[x.p];
    // a small word left out does not count against the sentence, and is not marked
    if (!ok[k] && !x.crit && SMALL.has(x.t)) return;
    t.total += 1;
    x.o.forEach((o) => { marks[x.p][o].crit = marks[x.p][o].crit || x.crit; });
    if (ok[k]) {
      t.right += 1;
      if (ok[k] === "close") x.o.forEach((o) => { marks[x.p][o].close = true; });
      return;
    }
    if (x.crit) t.crit += 1;
    x.o.forEach((o) => { marks[x.p][o].ok = false; });
  });
  const out = tally.map((t, p) => {
    const acc = t.total ? t.right / t.total : 1;
    return { acc, pass: acc >= PASS && !t.crit, critWrong: t.crit, words: marks[p] };
  });
  let last = ref.length - 1;
  while (last >= 0 && !ok[last]) last -= 1;
  const offset = (p: number) => words.slice(0, p).reduce((a, w) => a + w.length, 0);
  const right = tally.reduce((a, t) => a + t.right, 0), total = tally.reduce((a, t) => a + t.total, 0);
  return {
    parts: out, pass: out.every((x) => x.pass), acc: total ? right / total : 1,
    at: last + 1 < ref.length ? offset(ref[last + 1].p) + ref[last + 1].o[0] : offset(parts.length),
    left: ref.length - last - 1,
  };
};

// The best reading of what was heard. Speech recognition gives up to 5 guesses for each stretch of speech (alts:
// one list of guesses per stretch); try each guess in turn, keep it if the card grades better, and return the
// grade, the text it came from and which guess was kept for each stretch.
export const best = (parts: string[], alts: string[][], must: string[]) => {
  const pick = alts.map(() => 0);
  const text = () => alts.map((a, i) => a[pick[i]]).join(" ").trim();
  const score = (g: Result) => (g.pass ? 2 : 0) + g.acc;
  let top = grade(parts, text(), must);
  alts.forEach((a, i) => a.forEach((_, k) => {
    if (!k) return;
    const was = pick[i];
    pick[i] = k;
    const g = grade(parts, text(), must);
    if (score(g) > score(top)) top = g;
    else pick[i] = was;
  }));
  return { result: top, heard: text(), pick };
};

// The display words across sentences, each with its sentence.
export const flat = (parts: string[]) => parts.flatMap((t, p) => t.split(/\s+/).filter(Boolean).map((w) => ({ w, p })));
