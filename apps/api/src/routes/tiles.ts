import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Hono } from 'hono';

/**
 * 地理院タイルの中継(同一オリジンで下地を出す)。
 *   /api/tiles/photo/{z}/{x}/{y}  全国最新写真(シームレス) jpg
 *   /api/tiles/pale/{z}/{x}/{y}   淡色地図 png
 * ブラウザから直接 cyberjapandata.gsi.go.jp を取れる環境ならこの中継は不要。
 * 出典: 国土地理院(地理院タイル)。ディスクにキャッシュする。
 */
const KINDS: Record<string, { url: (z: string, x: string, y: string) => string; type: string }> = {
  photo: { url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`, type: 'image/jpeg' },
  pale: { url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`, type: 'image/png' },
  std: { url: (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`, type: 'image/png' },
};

export function tileRoutes(cacheDir = resolve(process.cwd(), 'data/tiles')): Hono {
  const app = new Hono();
  app.get('/:kind/:z/:x/:y', async (c) => {
    const { kind, z, x, y } = c.req.param();
    const k = KINDS[kind];
    if (!k || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) return c.text('not found', 404);
    if (Number(z) > 18) return c.text('zoom too high', 404);
    const file = resolve(cacheDir, kind, z, x, `${y}.${kind === 'photo' ? 'jpg' : 'png'}`);
    if (existsSync(file)) return new Response(readFileSync(file), { headers: { 'content-type': k.type, 'cache-control': 'public, max-age=86400' } });
    try {
      const r = await fetch(k.url(z, x, y), { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return c.text('upstream ' + r.status, 502);
      const buf = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, buf);
      return new Response(buf, { headers: { 'content-type': k.type, 'cache-control': 'public, max-age=86400' } });
    } catch (e) {
      return c.text('upstream error: ' + (e as Error).message, 502);
    }
  });
  return app;
}
