import './env.js';
import { serve } from '@hono/node-server';
import { hasOpenAI } from './openai.js';
import { app } from './app.js';

const port = Number(process.env.PORT || 4040);
const hostname = process.env.HOST || '0.0.0.0';

serve({ fetch: app.fetch, port, hostname }, info => {
  console.log(`AI Document Intelligence API listening on http://${hostname}:${info.port}`);
  console.log(
    `OpenAI: ${hasOpenAI() ? `enabled (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})` : 'disabled — heuristic fallback'}`,
  );
  console.log(`Demo API key: ${process.env.AI_DOC_DEMO_API_KEY || 'aidoc_demo_haewon_dev_key_change_me'}`);
});
