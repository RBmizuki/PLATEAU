#!/usr/bin/env node
/**
 * 3 分動画の見せ場を Playwright で自動再生し、webm に録画する。
 *
 *   pnpm dev            # 別ターミナルで API + Web を起動
 *   node scripts/record-demo.mjs [出力ディレクトリ]
 *
 * 場面(報告書「3 分動画の見せ場」):
 *   老夫婦の画面 → 32 万円の見積バーの横に街区バッジ → 登録済み 6 軒が濃く灯り、バーが階段を降りる
 *   → 12 軒の線 → 招待状を印刷 → 13 軒目でトラックが増えて正直に少し戻る → 事業者側で束を受け取る。
 */
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// playwright はリポジトリの依存に含めない(重い)。ローカル or グローバル(PLAYWRIGHT_MODULE)から探す。
const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node22/lib/node_modules/playwright', '/usr/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error('playwright が見つかりません: npm i -g playwright するか PLAYWRIGHT_MODULE=/path/to/playwright を指定してください');
}
const { chromium } = loadPlaywright();

const out = resolve(process.argv[2] ?? 'demo-recording');
mkdirSync(out, { recursive: true });
const base = process.env.WEB_URL ?? 'http://127.0.0.1:5173';
const api = process.env.API_URL ?? 'http://127.0.0.1:8787';

await fetch(`${api}/api/demo/reset`, { method: 'POST' }).catch(() => undefined);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, recordVideo: { dir: out, size: { width: 1400, height: 900 } } });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const scrollPanel = (y) => page.evaluate((v) => { const p = document.querySelector('.panel'); if (p) p.scrollTop = v; }, y);

// 1. 住所 → 自分の家が 3D で立つ
await page.goto(base, { waitUntil: 'networkidle' });
await pause(2000);
await page.click('text=この住所で探す');
await pause(2500);

// 2. 設置年 → 街区バッジ「候補あと N 軒」
await page.click('text=ご近所の候補を探す');
await pause(2500);
await scrollPanel(520);
await pause(2000);

// 3. 単独 32 万円 → 段差価格
await scrollPanel(900);
await pause(2500);

// 4. 登録済み 6 軒が濃く灯る → バーが階段を降りる
await page.click('text=ご近所 6 軒を登録済みにする');
await pause(3000);

// 5. 自分も登録 → 「12 軒そろえば」
await page.click('text=この週の枠に登録する');
await pause(2500);
await scrollPanel(1400);
await pause(2000);

// 6. 招待状
const link = await page.getAttribute('a[href^="/invite/"]', 'href');
await page.goto(base + link, { waitUntil: 'networkidle' });
await pause(4000);

// 7. 事業者側: 束を受け取る(12 軒にしてから)
const bundleId = decodeURIComponent(link.split('/')[2].split('?')[0]);
const clusterId = bundleId.replace(/^bundle-/, '').replace(/-\d{4}-W\d{2}-\d+$/, '');
await fetch(`${api}/api/demo/seed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clusterId, count: 12 }) });
await page.goto(`${base}/contractor`, { waitUntil: 'networkidle' });
await pause(2500);
await page.click('button:has-text("発注仕様")');
await pause(2500);
await page.evaluate(() => { const p = document.querySelector('.panel'); p.scrollTop = p.scrollHeight; });
await pause(2500);
const handover = page.locator('button:has-text("リードを受け取る")');
if (await handover.count()) {
  await page.evaluate(() => { const p = document.querySelector('.panel'); p.scrollTop = 0; });
  await pause(800);
  await handover.first().click();
  await pause(3000);
}

await context.close();
await browser.close();
console.log(`recorded to ${out}`);
