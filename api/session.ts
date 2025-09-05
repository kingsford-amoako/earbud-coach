// Serverless Function: Node runtime (no Edge)
// Signature: VercelRequest => VercelResponse

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readFileSync } from 'fs';
import { join } from 'path';
import fetch from 'node-fetch';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      res.status(500).send('Missing OPENAI_API_KEY');
      return;
    }

    const instructions = readFileSync(join(process.cwd(), 'prompt', 'system.txt'), 'utf8');

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2025-06-03',
        voice: 'verse',
        instructions
      })
    });

    const text = await r.text();
    res.setHeader('content-type', 'application/json');
    res.status(r.ok ? 200 : 400).send(text);
  } catch (e: any) {
    res.status(500).send(`Server error: ${e?.message || e}`);
  }
}
