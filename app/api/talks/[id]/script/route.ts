import { script } from "@/lib/api";
import { cloudflare } from "../../../env";

export async function GET(_: Request, { params }: RouteContext<"/api/talks/[id]/script">) {
  return script(cloudflare().env, (await params).id);
}
