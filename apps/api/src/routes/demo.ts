import { Hono } from 'hono';
import type { Dataset } from '../dataset.js';
import { BundleStore, upcomingWeeks } from '../store.js';

/**
 * デモ用: 指定クラスタに n 軒を登録済みにする(「登録済みの 6 軒が濃く灯る」場面の再現)。
 * DEMO=0 で無効化。
 */
export function demoRoutes(ds: Dataset, store: BundleStore, now: () => Date, defaultThreshold: number): Hono {
  const app = new Hono();
  app.post('/seed', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { clusterId?: string; count?: number; week?: string; excludeBuildingId?: string };
    const cluster = body.clusterId ? ds.clusterById.get(body.clusterId) : ds.clusters[0];
    if (!cluster) return c.json({ error: 'cluster not found' }, 404);
    const count = Math.max(0, Math.min(body.count ?? 6, cluster.candidateCount));
    const week = body.week ?? upcomingWeeks(now(), 1)[0]!;
    const bundle = store.openBundle(cluster.id, week, Math.min(defaultThreshold, cluster.candidateCount));
    const ids = cluster.buildingIds.filter((id) => id !== body.excludeBuildingId).slice(0, count);
    for (const id of ids) {
      const b = ds.buildingById.get(id)!;
      store.join(bundle.id, { buildingId: id, installYear: b.yearOfConstruction ?? 2013, capacityKw: 4 });
    }
    return c.json({ bundleId: bundle.id, registered: store.get(bundle.id)!.members.length });
  });
  app.post('/reset', (c) => {
    store.reset();
    return c.json({ ok: true });
  });
  return app;
}
