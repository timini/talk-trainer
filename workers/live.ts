// The build's dependencies in a deployed Worker: D1, R2, the render container and Gemini. With STANDINS=1, the
// renderer and the voice are stand-ins (lib/standins.ts).
import { getContainer } from "@cloudflare/containers";
import type { Deps } from "@/lib/build";
import * as standins from "@/lib/standins";
import { speak } from "@/lib/tts";

export const live = (env: CloudflareEnv & { GEMINI_KEY?: string; STANDINS?: string }): Deps => {
  if (env.STANDINS === "1") return { db: env.DB, files: env.FILES, render: standins.render, speak: standins.speak };
  return {
    db: env.DB,
    files: env.FILES,
    render: async (deck) => {
      const res = await getContainer(env.RENDER).fetch(new Request("http://render/render", { method: "POST", body: deck }));
      if (!res.ok) throw new Error(`The renderer answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    speak: (text) => {
      if (!env.GEMINI_KEY) throw new Error("GEMINI_KEY is not set.");
      return speak(env.GEMINI_KEY, text);
    },
  };
};
