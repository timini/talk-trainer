import { list, upload } from "@/lib/api";
import { cloudflare } from "../env";

export async function GET() {
  return list(cloudflare().env);
}

export async function POST(request: Request) {
  const { env, start } = cloudflare();
  return upload(request, env, start);
}
