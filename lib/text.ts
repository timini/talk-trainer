// Splitting a script into sentences, and the cues that fade a sentence out level by level.

// The first letter of each word, punctuation and capitals kept: "Good morning, and welcome." is "G m, a w."
export const cue = (text: string): string => text.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (w) => w[0]);

// The help after a miss: the phrases missed are hidden as first letters and every other word is shown. With
// nothing missed, every word is first letters. A phrase is found as a run of words, case and punctuation aside; a
// repeated phrase is hidden where it first appears, and a phrase that is not found hides nothing.
const WORD = /[\p{L}\p{N}]+(?:['’.,][\p{L}\p{N}]+)*/gu;
const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const hide = (text: string, phrases: string[]): string => {
  if (!phrases.length) return cue(text);
  const found = [...text.matchAll(WORD)].map((m) => ({ at: m.index as number, w: m[0], b: bare(m[0]) }));
  const hidden = new Set<number>();
  for (const phrase of phrases) {
    const seq = [...phrase.matchAll(WORD)].map((m) => bare(m[0])).filter(Boolean);
    if (!seq.length) continue;
    for (let i = 0; i + seq.length <= found.length; i += 1) {
      if (seq.every((b, k) => found[i + k].b === b && !hidden.has(i + k))) { seq.forEach((_, k) => hidden.add(i + k)); break; }
    }
  }
  let out = "", last = 0;
  found.forEach((f, i) => { out += text.slice(last, f.at) + (hidden.has(i) ? f.w[0] : f.w); last = f.at + f.w.length; });
  return out + text.slice(last);
};

// A share of the words hidden, spread evenly and chosen afresh for each seed, as pieces to draw: text between words, a word shown, a
// word hidden (drawn as the word itself, invisible, over a line, so a gap is as long as the word it hides), or a word
// cued by its first letter. keep: words always shown (names, numbers, acronyms not yet known, the opening words).
// initial: words always cued (terms on their way to being hidden). cued: phrases missed last time, whose words, when
// hidden, are cued instead. One ladder in every mode (Tim, 13 Nov: first letters, then blanks, then just the slide):
// up to share 0.5, twice share of the words show their first letter only; from 0.5 every word is a first letter or a
// blank, twice (share - 0.5) of them blank; share 1 is every word blank.
export type Bit = { kind: "text" | "word" | "hidden" | "cue"; t: string };
export const redactBits = (text: string, share: number, keep: string[], cued: string[], seed: number, initial: string[] = []): Bit[] => {
  const found = [...text.matchAll(WORD)].map((m) => ({ at: m.index as number, w: m[0], b: bare(m[0]) }));
  const bares = (xs: string[]) => new Set(xs.flatMap((k) => [...k.matchAll(WORD)].map((m) => bare(m[0]))));
  const kept = bares(keep), firsts = bares(initial);
  const cue = new Set<number>();
  for (const phrase of cued) {
    const seq = [...phrase.matchAll(WORD)].map((m) => bare(m[0])).filter(Boolean);
    for (let i = 0; seq.length && i + seq.length <= found.length; i += 1) {
      if (seq.every((b, k) => found[i + k].b === b)) { seq.forEach((_, k) => cue.add(i + k)); break; }
    }
  }
  // the words that may be hidden, in order, cut into as many equal runs as words to hide, and one word hidden at random
  // (seeded, mulberry32) in each run: gaps spread evenly through the text instead of clumping by chance (Tim, 12 Nov;
  // on the talk's sentences at 30% hidden, runs of 3 or more gaps fell from 17% of sentences to none)
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const open = found.map((_, i) => i).filter((i) => !kept.has(found[i].b) && !firsts.has(found[i].b));
  // one of each equal run of xs, at random
  const even = (xs: number[], k: number) => {
    const run = (i: number) => Math.floor((i * xs.length) / k);
    return Array.from({ length: k }, (_, i) => xs[run(i) + Math.floor(rand() * (run(i + 1) - run(i)))]);
  };
  const s2 = 2 * Math.min(1, share), count = (x: number) => Math.round(Math.min(1, x) * found.length);
  const hidden = even(open, Math.min(open.length, count(s2)));
  const hide = new Set(hidden), blank = new Set(even(hidden, Math.min(hidden.length, count(Math.max(0, s2 - 1)))));
  const out: Bit[] = [];
  let last = 0;
  found.forEach((f, i) => {
    if (f.at > last) out.push({ kind: "text", t: text.slice(last, f.at) });
    out.push({ kind: firsts.has(f.b) || (hide.has(i) && (!blank.has(i) || cue.has(i))) ? "cue" : hide.has(i) ? "hidden" : "word", t: f.w });
    last = f.at + f.w.length;
  });
  if (last < text.length) out.push({ kind: "text", t: text.slice(last) });
  return out;
};

// The same as text, with underscores for the hidden letters. share 1 hides the whole text ("").
export const redact = (text: string, share: number, keep: string[], cued: string[], seed: number, initial: string[] = []): string =>
  (share >= 1 ? "" : redactBits(text, share, keep, cued, seed, initial).map((x) => (x.kind === "hidden" ? "_".repeat(x.t.length)
    : x.kind === "cue" ? x.t[0] + "_".repeat(x.t.length - 1) : x.t)).join(""));

// Sentences: split after . ! or ? (and a closing quote or bracket) and a space, so 0.95 stays whole.
export const sentences = (text: string): string[] =>
  text.split(/(?<=[.!?]["”’)]?)\s+/).map((s) => s.trim()).filter(Boolean);

// Vanishing text. Round 0: every word. 1: every 4th word blanked. 2: every other word. 3: first letters only.
// 4: nothing, one blank line for each sentence.
export const blank = (text: string, round: number): string => {
  if (round >= 4) return sentences(text).map(() => "________").join("\n");
  if (round === 3) return cue(text);
  const every = round === 2 ? 2 : round === 1 ? 4 : 0;
  let i = 0;
  // A number such as 0.95 or 13,000 is one word here.
  return text.replace(/[\p{L}\p{N}]+(?:['’.,][\p{L}\p{N}]+)*/gu,
    (w) => (every && ++i % every === 0 ? "_".repeat(w.length) : w));
};

// The cue for each level. 0: the full sentence. 1: every 4th word blanked. 2: every other word. 3: first letters.
// 4: nothing. A chain shows each sentence at its own level.
export const cues = (parts: string[], levels: number[]): string => parts.map((t, k) => blank(t, levels[k])).join(" ");

// Levels 0 to 2 also show the slide, its key point and the sentence before; level 3 the first letters alone; level
// 4 the slide alone.
export const shows = (level: number) => ({ image: level !== 3, point: level <= 2, before: level <= 2 });

// A new sentence is practised as the chain from the slide's start once every sentence before it is at level 2.
export const chainStart = (levels: (number | null)[], k: number): number =>
  (k > 0 && levels.slice(0, k).every((l) => l !== null && l >= 2) ? 0 : k);

// The words of a text without the punctuation around them or a possessive, each marked when it is a name: a
// capital after its first letter (CADD, SpliceAI), a digit beside letters (BRCA1, H100) or a dot inside it
// (example.io).
const words = (text: string) => text.split(/\s+/).filter(Boolean).map((word) => {
  const w = word.replace(/^[.,;:!?()"'“”‘’]+|[.,;:!?()"'“”‘’]+$/g, "").replace(/[’']s$/, "");
  const rest = [...w.slice(1)];
  const name = rest.some((c) => c !== c.toLowerCase() && c === c.toUpperCase())
    || (/\d/.test(w) && /\p{L}/u.test(w)) || /[a-z]\.[a-z]/.test(w);
  return { w, name };
});

// What must be said exactly in a sentence: its names and its numbers (any other word with a digit, such as 0.95 or
// 87%), each once, in order.
export const mustSay = (sentence: string): string[] =>
  [...new Set(words(sentence).filter(({ w, name }) => name || /\d/.test(w)).map(({ w }) => w))];

// The talk's names, for the judge: every name in the script (as words() finds them) and the must-say items that are
// terms (no digit, at most 3 words); sorted, each once.
export const glossary = (slides: { must_say: string[]; sentences: string[] }[]): string[] => {
  const names = new Set<string>();
  for (const d of slides) {
    d.must_say.filter((m) => !/\d/.test(m) && m.split(/\s+/).filter(Boolean).length <= 3).forEach((m) => names.add(m));
    for (const text of d.sentences) words(text).filter((x) => x.name).forEach(({ w }) => names.add(w));
  }
  const key = (n: string) => n.toLowerCase();
  return [...names].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : 1));
};
