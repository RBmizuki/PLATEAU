import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { loadDataset } from './dataset.js';

const ds = loadDataset(resolve(__dirname, '../../../data/sample/masago.json'));
const app = createApp({ dataset: ds });

describe('api', () => {
  it('serves health and geojson', async () => {
    const h = await app.request('/api/health');
    expect(h.status).toBe(200);
    const body = (await h.json()) as { buildings: number; clusters: number };
    expect(body.buildings).toBeGreaterThan(100);
    expect(body.clusters).toBeGreaterThan(3);
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
