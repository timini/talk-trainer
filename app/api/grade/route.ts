import { judge } from "@/lib/judgeApi";

export async function POST(request: Request) {
  return judge(request, { GEMINI_KEY: process.env.GEMINI_KEY, GEMINI_MODEL: process.env.GEMINI_MODEL, STANDINS: process.env.STANDINS });
}
