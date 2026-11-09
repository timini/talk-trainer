// A tiny .pptx built from XML strings, for tests: only the parts the parser and the renderer need.
import { strToU8, zipSync } from "fflate";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (text) => `<a:p><a:r><a:rPr lang="en-GB" sz="3600"/><a:t>${esc(text)}</a:t></a:r></a:p>`;
// Where each kind of shape sits (EMU), so the slides render with their text.
const BOX = { title: [838200, 365125, 10515600, 1325563], "": [838200, 1825625, 10515600, 4351338],
  body: [685800, 4400550, 5486400, 3600450], sldImg: [1143000, 685800, 4572000, 3429000] };
const shape = (type, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${type}"/><p:cNvSpPr/><p:nvPr>`
  + `${type ? `<p:ph type="${type}"/>` : ""}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${BOX[type][0]}" y="${BOX[type][1]}"/>`
  + `<a:ext cx="${BOX[type][2]}" cy="${BOX[type][3]}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/>`
  + `${paras.map(para).join("")}</p:txBody></p:sp>`;
const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join("")
  + "</Relationships>";

// The section list, as PowerPoint writes it in an extension: a section starts at each slide with a section name.
const sections = (slides) => {
  const list = [];
  slides.forEach((s, i) => {
    if (s.section !== undefined) list.push({ name: s.section, ids: [] });
    list.at(-1)?.ids.push(256 + i);
  });
  if (!list.length) return "";
  return `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">`
    + list.map((x, k) => `<p14:section name="${esc(x.name)}" id="{0000000${k}-0000-0000-0000-000000000000}"><p14:sldIdLst>`
      + x.ids.map((id) => `<p14:sldId id="${id}"/>`).join("") + "</p14:sldIdLst></p14:section>").join("")
    + "</p14:sectionLst></p:ext></p:extLst>";
};

/**
 * Builds a deck. Each slide: { title?, notes?: string[] (paragraphs), body?: string[], hidden?: boolean, section?: string
 * (the PowerPoint section that starts at this slide) }.
 * @param {{ title?: string, notes?: string[], body?: string[], hidden?: boolean, section?: string }[]} slides
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
      + `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>${sections(slides)}</p:presentation>`,
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
