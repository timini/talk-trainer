// The Worker: the Next.js app built by OpenNext, plus the build Workflow and the render container class.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: written by `opennextjs-cloudflare build`, so absent until a build.
import { default as handler } from "./.open-next/worker.js";

export default { fetch: handler.fetch } satisfies ExportedHandler<CloudflareEnv>;

export { BuildWorkflow } from "./workers/build";
export { Render } from "./workers/render";
