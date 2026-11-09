// The background build as a Cloudflare Workflow: each stage of lib/build.ts is a durable step, retried on its own
// with backoff, so a failed voice clip (a rate limit, say) is tried again without redoing the rest. The sentences
// are voiced 8 at a time (lib/build.ts VOICE_BATCH), as parallel steps.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { build } from "@/lib/build";
import { live } from "./live";

const RETRY = { retries: { limit: 6, delay: "10 seconds" as const, backoff: "exponential" as const }, timeout: "10 minutes" as const };
// A voice clip: Gemini's rate limit (429) can need a minute or more, so it waits longer and tries more often.
const VOICE = { retries: { limit: 8, delay: "20 seconds" as const, backoff: "exponential" as const }, timeout: "5 minutes" as const };

export class BuildWorkflow extends WorkflowEntrypoint<CloudflareEnv, { talk: string }> {
  async run(event: WorkflowEvent<{ talk: string }>, step: WorkflowStep) {
    await build(live(this.env), event.payload.talk,
      (name, fn, kind) => step.do(name, kind === "voice" ? VOICE : RETRY, fn as () => Promise<never>));
  }
}
