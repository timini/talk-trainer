// A tiny .pptx built from XML strings, for tests: only the parts the parser and the renderer need.
import { strToU8, zipSync } from "fflate";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (text) => `<a:p><a:r><a:rPr lang="en-GB"/><a:t>${esc(text)}</a:t></a:r></a:p>`;
const shape = (type, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${type}"/><p:cNvSpPr/><p:nvPr>`
  + `${type ? `<p:ph type="${type}"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>`
  + `${paras.map(para).join("")}</p:txBody></p:sp>`;
const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")
  + "</Relationships>";

/**
 * Builds a deck. Each slide: { title?, notes?: string[] (paragraphs), body?: string[], hidden?: boolean }.
 * @param {{ title?: string, notes?: string[], body?: string[], hidden?: boolean }[]} slides
 * @returns {Uint8Array}
 */
export function deck(slides) {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`
      + slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")
      + slides.map((s, i) => (s.notes ? `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>` : "")).join("")
      + "</Types>",
    "_rels/.rels": rels([["rId1", "officeDocument", "ppt/presentation.xml"]]),
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst>`
      + slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")
      + `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(slides.map((_, i) => [`rId${i + 2}`, "slide", `slides/slide${i + 1}.xml`])),
  };
  slides.forEach((s, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}${s.hidden ? ' show="0"' : ""}>`
      + `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`
      + (s.title ? shape("title", [s.title]) : "") + (s.body ? shape("", s.body) : "")
      + "</p:spTree></p:cSld></p:sld>";
    if (s.notes) {
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels([["rId1", "notesSlide", `../notesSlides/notesSlide${n}.xml`]]);
      files[`ppt/notesSlides/notesSlide${n}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}><p:cSld><p:spTree>`
        + `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>`
        + shape("sldImg", []) + shape("body", s.notes) + "</p:spTree></p:cSld></p:notes>";
    }
  });
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}
