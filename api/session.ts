import fs from "fs";
import path from "path";

export const config = { runtime: "edge" };

export default async function handler() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return new Response("Missing OPENAI_API_KEY", { status: 500 });
  }

  const instructions = fs.readFileSync(
    path.join(process.cwd(), "prompt/system.txt"),
    "utf8"
  );

  const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      // Use the latest Realtime model available to you.
      // You can swap to a newer snapshot later.
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
