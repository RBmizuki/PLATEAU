import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadDataset } from './dataset.js';
import { BundleStore } from './store.js';

const ds = loadDataset(resolve(__dirname, '../../../data/sample/masago.json'));
const app = createApp({ dataset: ds });

describe('api', () => {
  it('serves health and geojson', async () => {
    const h = await app.request('/api/health');
    expect(h.status).toBe(200);
    const body = (await h.json()) as { buildings: number; clusters: number };
    expect(body.buildings).toBeGreaterThan(100);
    expect(body.clusters).toBeGreaterThanOrEqual(6);
    const g = await app.request('/api/buildings.geojson');
    const gj = (await g.json()) as { features: unknown[] };
    expect(gj.features.length).toBe(body.buildings);
  });

  it('geocodes an address from the dataset', async () => {
    const r = await app.request('/api/geocode?q=' + encodeURIComponent('千葉市美浜区真砂三丁目A-3'));
    const j = (await r.json()) as { hits: Array<{ id: string; method: string }> };
    expect(j.hits[0]!.method).toBe('address-match');
    expect(j.hits[0]!.id).toMatch(/^bldg-A-/);
  });

  it('finds clusters overlapping an install year near a building', async () => {
    const b = ds.buildings.find((x) => x.id.startsWith('bldg-A-'))!;
    const r = await app.request(`/api/clusters?installYear=2013&lon=${b.centroid[0]}&lat=${b.centroid[1]}`);
    const j = (await r.json()) as { clusters: Array<{ id: string; medianYear: number }> };
    expect(j.clusters.length).toBeGreaterThan(0);
    expect(Math.abs(j.clusters[0]!.medianYear - 2013)).toBeLessThanOrEqual(3);
  });
});

describe('bundles', () => {
  const app2 = createApp({ dataset: ds, store: new BundleStore(), now: () => new Date('2026-09-03T00:00:00Z'), threshold: 12, demo: true });
  const cluster = ds.clusters.find((c) => c.buildingIds[0]!.startsWith('bldg-A-'))!;

  it('registers houses into a cluster-week slot and reports remaining', async () => {
    const weeks = (await (await app2.request('/api/bundles/weeks')).json()) as { weeks: string[] };
    expect(weeks.weeks).toHaveLength(6);
    const first = cluster.buildingIds[0]!;
    const r = await app2.request('/api/bundles/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clusterId: cluster.id, buildingId: first, installYear: 2013, capacityKw: 4, week: weeks.weeks[0] }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { bundle: { registered: number; remaining: number; threshold: number; status: string } };
    expect(j.bundle.registered).toBe(1);
    expect(j.bundle.threshold).toBe(12);
    expect(j.bundle.remaining).toBe(11);
    expect(j.bundle.status).toBe('forming');
  });

  it('rejects a house outside the cluster', async () => {
    const other = ds.clusters.find((c) => c.id !== cluster.id)!.buildingIds[0]!;
    const r = await app2.request('/api/bundles/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clusterId: cluster.id, buildingId: other, installYear: 2013 }),
    });
    expect(r.status).toBe(400);
  });

  it('seeds a demo bundle to threshold and hands it over', async () => {
    const seed = await app2.request('/api/demo/seed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clusterId: cluster.id, count: 12, week: '2026-W47' }) });
    const s = (await seed.json()) as { bundleId: string; registered: number };
    expect(s.registered).toBe(12);
    const got = (await (await app2.request(`/api/bundles/${s.bundleId}`)).json()) as { bundle: { status: string } };
    expect(got.bundle.status).toBe('threshold_met');
    const h = await app2.request(`/api/bundles/${s.bundleId}/handover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractorId: 'c1' }) });
    expect(h.status).toBe(200);
    const hj = (await h.json()) as { bundle: { status: string; contractorId: string } };
    expect(hj.bundle.status).toBe('handed_to_contractor');
    expect(hj.bundle.contractorId).toBe('c1');
  });
});
