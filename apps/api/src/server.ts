import { serve } from '@hono/node-server';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { createApp } from './app.js';

// HTTPS_PROXY / NO_PROXY が設定された環境(社内プロキシ・サンドボックス)では fetch をそれ経由にする
if (process.env['HTTPS_PROXY'] || process.env['HTTP_PROXY']) setGlobalDispatcher(new EnvHttpProxyAgent());

const port = Number(process.env['PORT'] ?? 8787);
const app = createApp();
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`足場の割り勘 API listening on http://localhost:${info.port}`);
});
