// Reading a PowerPoint deck: a zip of XML parts. The slides come in presentation order (ppt/presentation.xml lists
// them, its relationships name their parts), each with its title and its speaker notes, which are the script.
// Hidden slides are left out, as they are not shown in the talk or in the rendered images.

import { strFromU8, unzipSync } from "fflate";

// section: the name of the PowerPoint section the slide is in, or null when the deck has no sections.
export type DeckSlide = { n: number; title: string; notes: string; section: string | null };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
  if (e[0] !== "#") return ENTITIES[e] ?? all;
  return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
});
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

// The relationships of a part: id to the part it points at, by type (the last segment of the type URI).
const rels = (files: Record<string, string>, part: string) => {
  const dir = part.slice(0, part.lastIndexOf("/") + 1);
  const xml = files[`${dir}_rels/${part.slice(dir.length)}.rels`] ?? "";
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => ({
    id: attr(tag, "Id"), type: (attr(tag, "Type") ?? "").split("/").pop(), target: resolve(dir, attr(tag, "Target") ?? ""),
  }));
};

// A relationship target relative to the folder of the part it is in, or from the root when it starts with /.
const resolve = (dir: string, target: string) => {
  const out = target.startsWith("/") ? [] : dir.split("/").filter(Boolean);
  for (const bit of target.split("/").filter(Boolean)) {
    if (bit === "..") out.pop();
    else if (bit !== ".") out.push(bit);
  }
  return out.join("/");
};

// The text of each paragraph of a shape, with line breaks as spaces.
const paragraphs = (shape: string) => [...shape.matchAll(/<a:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:p>)/g)]
  .map(([, body]) => decode((body ?? "").replace(/<a:br\b[^>]*\/>/g, "<a:t> </a:t>")
    .replace(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<[^>]+>|[^<]+/g, (_, t: string | undefined) => t ?? "")))
  .map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);

// The shapes of a part that are placeholders of one of these types, as text: paragraphs joined with join (a space
// for a title; a new line for the notes, so the learning engine can group the sentences by paragraph).
const placeholders = (xml: string, types: string[], join = " ") => [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)]
  .filter(([shape]) => {
    const ph = /<p:ph\b[^>]*>/.exec(shape)?.[0];
    return ph !== undefined && types.includes(attr(ph, "type") ?? "obj");
  })
  .map(([shape]) => paragraphs(shape).join(join)).filter(Boolean).join(join);

export const parseDeck = (data: Uint8Array): DeckSlide[] => {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(data, { filter: (f) => /\.(xml|rels)$/.test(f.name) });
  } catch {
    throw new Error("This file is not a .pptx deck.");
  }
  const files = Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, strFromU8(v)]));
  const main = files["ppt/presentation.xml"];
  if (!main) throw new Error("This file is not a .pptx deck.");
  const byId = new Map(rels(files, "ppt/presentation.xml").map((r) => [r.id, r.target]));
  // the deck's sections, in the extension list: each a name and the ids of its slides
  const section = new Map<string, string>();
  for (const [, tag, body] of main.matchAll(/<p14:section\b([^>]*)>([\s\S]*?)<\/p14:section>/g)) {
    for (const [id] of body.matchAll(/<p14:sldId\b[^>]*>/g)) section.set(attr(id, "id") as string, decode(attr(` ${tag}`, "name") ?? ""));
  }
  const out: DeckSlide[] = [];
  for (const [tag] of main.matchAll(/<p:sldId\b[^>]*>/g)) {
    const part = byId.get(attr(tag, "r:id"));
    const xml = part && files[part];
    if (!xml || /<p:sld\b[^>]*\sshow="(0|false)"/.test(xml)) continue;
    const notes = rels(files, part).find((r) => r.type === "notesSlide");
    out.push({
      n: out.length + 1,
      title: placeholders(xml, ["title", "ctrTitle"]),
      notes: notes && files[notes.target] ? placeholders(files[notes.target], ["body"], "\n") : "",
      section: section.get(attr(tag, "id") as string) ?? null,
    });
  }
  return out;
};
