import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { parseDeck } from "@/lib/pptx";
import { deck } from "../support/deck.mjs";

describe("parseDeck", () => {
  test("slides in presentation order, with titles and notes, the notes' paragraphs on lines of their own", () => {
    const slides = parseDeck(deck([
      { title: "Welcome", notes: ["Good morning.", "Today we bake bread & cake."] },
      { title: "No notes here", body: ["Some body text."] },
      { notes: ["A slide without a title says 3 < 4."] },
    ]));
    expect(slides).toEqual([
      { n: 1, title: "Welcome", notes: "Good morning.\nToday we bake bread & cake." },
      { n: 2, title: "No notes here", notes: "" },
      { n: 3, title: "", notes: "A slide without a title says 3 < 4." },
    ]);
  });

  test("hidden slides are left out and the rest numbered in order", () => {
    expect(parseDeck(deck([{ title: "One" }, { title: "Two", hidden: true }, { title: "Three" }])).map((s) => [s.n, s.title]))
      .toEqual([[1, "One"], [2, "Three"]]);
  });

  test("the order comes from the slide list, not the part names", () => {
    const zip = (files: Record<string, string>) =>
      zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    const sld = (title: string, extra = "") => `<p:sld${extra}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/>`
      + `</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r><a:br/><a:r><a:t xml:space="preserve">line</a:t></a:r></a:p>`
      + `<a:p/><a:p><a:fld><a:t>&#8364;&#x41;&nbsp;</a:t></a:fld></a:p></p:txBody></p:sp>`
      + `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Body</a:t></a:r></a:p></p:txBody></p:sp>`
      + `</p:spTree></p:cSld></p:sld>`;
    const slides = parseDeck(zip({
      "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="b"/><p:sldId id="2" r:id="a"/>'
        + '<p:sldId id="3" r:id="missing"/><p:sldId id="4" r:id="c"/></p:sldIdLst></p:presentation>',
      "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="a" Type="x/slide" Target="/ppt/slides/first.xml"/>'
        + '<Relationship Id="b" Type="x/slide" Target="./slides/second.xml"/><Relationship Id="c" Type="x/slide" Target="slides/gone.xml"/>'
        + "<Relationship/></Relationships>",
      "ppt/slides/first.xml": sld("First"),
      "ppt/slides/second.xml": sld("Second", ' show="1"'),
      "ppt/slides/_rels/second.xml.rels": '<Relationships><Relationship Id="n" Type="x/notesSlide" Target="../notesSlides/absent.xml"/></Relationships>',
    }));
    expect(slides).toEqual([{ n: 1, title: "Second line €A&nbsp;", notes: "" }, { n: 2, title: "First line €A&nbsp;", notes: "" }]);
  });

  test("a file that is not a deck is refused", () => {
    expect(() => parseDeck(strToU8("plain text"))).toThrow("This file is not a .pptx deck.");
    expect(() => parseDeck(zipSync({ "word/document.xml": strToU8("<w/>") }))).toThrow("This file is not a .pptx deck.");
  });
});
