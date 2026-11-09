import { change, rebuild, status } from "@/lib/api";
import { cloudflare } from "../../env";

export async function GET(_: Request, { params }: RouteContext<"/api/talks/[id]">) {
  return status(cloudflare().env, (await params).id);
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/talks/[id]">) {
  return change(request, cloudflare().env, (await params).id);
}

export async function POST(_: Request, { params }: RouteContext<"/api/talks/[id]">) {
  const { env, start } = cloudflare();
  return rebuild(env, (await params).id, start);
}
