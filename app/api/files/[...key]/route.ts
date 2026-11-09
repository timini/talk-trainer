import { file } from "@/lib/api";
import { cloudflare } from "../../env";

export async function GET(request: Request, { params }: RouteContext<"/api/files/[...key]">) {
  return file(request, cloudflare().env, (await params).key.join("/"));
}
