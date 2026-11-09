import { getProgress, putProgress } from "@/lib/api";
import { cloudflare } from "../../../env";

export async function GET(_: Request, { params }: RouteContext<"/api/talks/[id]/progress">) {
  return getProgress(cloudflare().env, (await params).id);
}

export async function PUT(request: Request, { params }: RouteContext<"/api/talks/[id]/progress">) {
  return putProgress(request, cloudflare().env, (await params).id);
}
