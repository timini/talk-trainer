// Stand-ins for the renderer and the voice, for tests and for local development without a container or a Gemini
// key (set STANDINS=1): a blank image for each slide, and a short silence for each sentence.

import { zipSync } from "fflate";
import { parseDeck } from "./pptx";
import { wavOf } from "./tts";

// A 1 by 1 white PNG.
export const PNG = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"), (c) => c.charCodeAt(0));

export const render = async (deck: ReadableStream): Promise<Uint8Array> => {
  const slides = parseDeck(new Uint8Array(await new Response(deck).arrayBuffer()));
  return zipSync(Object.fromEntries(slides.map((s) => [`slide-${s.n}.png`, PNG])));
};

// A tenth of a second of silence a word.
export const speak = async (text: string): Promise<Uint8Array> =>
  wavOf(new Uint8Array(4800 * text.split(/\s+/).filter(Boolean).length));
