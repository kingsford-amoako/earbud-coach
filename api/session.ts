import { readFileSync } from "fs";
import { join } from "path";

export default async function handler(req: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  // Read system prompt from the repo at runtime (Node runtime supports fs)
  const instructions = readFileSync(
    join(process.cwd(), "prompt", "system.txt"),
    "utf8"
  );

  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2025-06-03",
      voice: "verse",
      instructions
    })
  });

  const data = await r.json();
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" }
  });
}
