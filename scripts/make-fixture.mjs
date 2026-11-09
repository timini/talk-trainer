// Writes tests/fixtures/three-slides.pptx, the deck the end-to-end test uploads. The text is invented.
import { writeFileSync } from "node:fs";
import { deck } from "../tests/support/deck.mjs";

writeFileSync(new URL("../tests/fixtures/three-slides.pptx", import.meta.url), deck([
  { title: "Welcome", notes: ["Good morning, and thank you for coming.", "Today we bake bread."] },
  { title: "Flour and water", notes: ["Mix 500 grams of flour with 350 grams of water.", "Let it rest for an hour."] },
  { title: "Questions", body: ["Thank you"] },
]));
