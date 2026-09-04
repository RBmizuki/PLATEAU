import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { clustersForInstallYear } from '@ashiba/engine';
import { resolve } from 'node:path';
import { loadDataset, type Dataset } from './dataset.js';
import { gsiGeocode, matchAddress, nearestBuilding } from './geocode.js';
import { BundleStore } from './store.js';
import { bundleRoutes } from './routes/bundles.js';
import { demoRoutes } from './routes/demo.js';
import { tileRoutes } from './routes/tiles.js';
import { createQuoteService } from './quote.js';
import { memberOf } from '@ashiba/engine';

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

  app.get('/api/dataset', (c) => c.json({ source: ds.source, bounds: ds.bounds, meta: ds.meta, clusterBasis: ds.clusterBasis, yearCoverage: ds.yearCoverage, hasAddresses: ds.hasAddresses, counts: { buildings: ds.buildings.length, roads: ds.roads.length, clusters: ds.clusters.length } }));

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
        buildingId: c.req.query('buildingId') ?? undefined,
        limit: Number(c.req.query('limit') ?? 6),
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

  const quotes = createQuoteService(ds);

  app.get('/api/rate-table', (c) => c.json(quotes.rateTable));

  /** 住民向け試算: 自分 + 登録済み + 残り候補の段差価格。 */
  app.get('/api/quote', (c) => {
    const clusterId = c.req.query('clusterId') ?? '';
    const buildingId = c.req.query('buildingId') ?? '';
    const installYear = Number(c.req.query('installYear') ?? 2013);
    const capacityKw = c.req.query('capacityKw') ? Number(c.req.query('capacityKw')) : undefined;
    const week = c.req.query('week');
    const cluster = ds.clusterById.get(clusterId);
    if (!cluster) return c.json({ error: `cluster ${clusterId} not found` }, 404);
    if (!ds.buildingById.has(buildingId)) return c.json({ error: `building ${buildingId} not found` }, 404);
    if (!cluster.buildingIds.includes(buildingId)) return c.json({ error: 'building is not in this cluster' }, 400);
    const forming = store.list({ clusterId }).filter((b) => b.status === 'forming' || b.status === 'threshold_met');
    const bundle = week ? forming.find((b) => b.week === week) : forming.sort((a, b) => b.members.length - a.members.length)[0];
    const registered = (bundle?.members ?? [])
      .map((m) => {
        const b = ds.buildingById.get(m.buildingId);
        return b ? memberOf(b, m.installYear, m.capacityKw) : undefined;
      })
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
    const th = bundle?.threshold ?? Math.min(threshold, cluster.candidateCount);
    const q = quotes.staircaseFor({ cluster, selfBuildingId: buildingId, installYear, capacityKw, registered, threshold: th });
    return c.json({ quote: q, bundleId: bundle?.id ?? null, week: bundle?.week ?? null, registeredIds: registered.map((m) => m.building.id) });
  });

  app.route('/api/bundles', bundleRoutes({ ds, store, defaultThreshold: threshold, now, quote: (b) => quotes.bundleQuote(b), lead: (b) => quotes.lead(b) }));
  if (demo) app.route('/api/demo', demoRoutes(ds, store, now, threshold));
  app.route('/api/tiles', tileRoutes());

  return app;
}

function hitJson(h: { building: { id: string; address?: string; centroid: [number, number] }; method: string; score: number }) {
  return { id: h.building.id, address: h.building.address ?? null, centroid: h.building.centroid, method: h.method, score: h.score };
}
