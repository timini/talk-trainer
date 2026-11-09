// The background build as a Cloudflare Workflow: each stage of lib/build.ts is a durable step, retried on its own
// with backoff, so a failed voice clip (a rate limit, say) is tried again without redoing the rest.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { build } from "@/lib/build";
import { live } from "./live";

const RETRY = { retries: { limit: 6, delay: "10 seconds" as const, backoff: "exponential" as const }, timeout: "10 minutes" as const };

export class BuildWorkflow extends WorkflowEntrypoint<CloudflareEnv, { talk: string }> {
  async run(event: WorkflowEvent<{ talk: string }>, step: WorkflowStep) {
    await build(live(this.env), event.payload.talk,
      (name, fn) => step.do(name, RETRY, fn as () => Promise<never>));
  }
}
