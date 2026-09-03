import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { clustersForInstallYear } from '@ashiba/engine';
import { resolve } from 'node:path';
import { loadDataset, type Dataset } from './dataset.js';
import { gsiGeocode, matchAddress, nearestBuilding } from './geocode.js';
import { BundleStore } from './store.js';
import { bundleRoutes } from './routes/bundles.js';
import { demoRoutes } from './routes/demo.js';

export interface AppOptions {
  dataset?: Dataset;
  store?: BundleStore;
  now?: () => Date;
  /** 束の成立閾値(既定 12 軒)。 */
  threshold?: number;
  demo?: boolean;
}

export const DEFAULT_STORE_FILE = resolve(process.cwd(), 'data/bundles.json');

export function createApp(options: AppOptions = {}): Hono {
  const ds = options.dataset ?? loadDataset();
  const store = options.store ?? new BundleStore(process.env['STORE_FILE'] ?? DEFAULT_STORE_FILE);
  const now = options.now ?? (() => new Date());
  const threshold = options.threshold ?? Number(process.env['BUNDLE_THRESHOLD'] ?? 12);
  const demo = options.demo ?? process.env['DEMO'] !== '0';
  const app = new Hono();
  app.use('/api/*', cors());

  app.get('/api/health', (c) =>
    c.json({ ok: true, source: ds.source, buildings: ds.buildings.length, roads: ds.roads.length, clusters: ds.clusters.length }),
  );

  app.get('/api/dataset', (c) => c.json({ source: ds.source, bounds: ds.bounds, meta: ds.meta, counts: { buildings: ds.buildings.length, roads: ds.roads.length, clusters: ds.clusters.length } }));

  app.get('/api/buildings.geojson', (c) => c.json(ds.buildingsGeoJSON));
  app.get('/api/roads.geojson', (c) => c.json(ds.roadsGeoJSON));

  app.get('/api/buildings/:id', (c) => {
    const b = ds.buildingById.get(c.req.param('id'));
    if (!b) return c.json({ error: 'not found' }, 404);
    return c.json({ building: b, neighbors: ds.adjacency.neighbors[b.id] ?? [], clusterId: ds.clusterOfBuilding.get(b.id) ?? null });
  });

  app.get('/api/clusters', (c) => {
    const year = c.req.query('installYear');
    const lon = c.req.query('lon');
    const lat = c.req.query('lat');
    if (year && lon && lat) {
      const found = clustersForInstallYear(ds.clusters, Number(year), [Number(lon), Number(lat)], {
        yearWindow: Number(c.req.query('yearWindow') ?? 3),
        maxDistanceMeters: Number(c.req.query('maxDistance') ?? 400),
      });
      return c.json({ clusters: found });
    }
    return c.json({ clusters: ds.clusters });
  });

  app.get('/api/clusters/:id', (c) => {
    const cl = ds.clusterById.get(c.req.param('id'));
    if (!cl) return c.json({ error: 'not found' }, 404);
    return c.json({ cluster: cl });
  });

  app.get('/api/geocode', async (c) => {
    const q = c.req.query('q') ?? '';
    const local = matchAddress(ds, q);
    if (local.length > 0) return c.json({ query: q, hits: local.map(hitJson) });
    if (process.env['GSI_GEOCODER'] === '1') {
      try {
        const p = await gsiGeocode(q);
        if (p) {
          const near = nearestBuilding(ds, p);
          if (near) return c.json({ query: q, point: p, hits: [hitJson(near)] });
        }
      } catch {
        /* オフラインなら黙って落とす */
      }
    }
    return c.json({ query: q, hits: [] });
  });

  app.route('/api/bundles', bundleRoutes({ ds, store, defaultThreshold: threshold, now }));
  if (demo) app.route('/api/demo', demoRoutes(ds, store, now, threshold));

  return app;
}

function hitJson(h: { building: { id: string; address?: string; centroid: [number, number] }; method: string; score: number }) {
  return { id: h.building.id, address: h.building.address ?? null, centroid: h.building.centroid, method: h.method, score: h.score };
}
