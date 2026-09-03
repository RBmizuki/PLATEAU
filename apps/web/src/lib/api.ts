import type { Building, Neighbor, YearCluster } from '@ashiba/engine';

export type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, Record<string, unknown>>;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export interface DatasetInfo {
  source: string;
  bounds: [number, number, number, number];
  meta: Record<string, unknown>;
  counts: { buildings: number; roads: number; clusters: number };
}

export interface GeocodeHit {
  id: string;
  address: string | null;
  centroid: [number, number];
  method: string;
  score: number;
}

export const api = {
  dataset: () => getJson<DatasetInfo>('/api/dataset'),
  buildingsGeoJSON: () => getJson<FeatureCollection>('/api/buildings.geojson'),
  roadsGeoJSON: () => getJson<FeatureCollection>('/api/roads.geojson'),
  building: (id: string) => getJson<{ building: Building; neighbors: Neighbor[]; clusterId: string | null }>(`/api/buildings/${encodeURIComponent(id)}`),
  geocode: (q: string) => getJson<{ query: string; hits: GeocodeHit[] }>(`/api/geocode?q=${encodeURIComponent(q)}`),
  clustersNear: (installYear: number, lon: number, lat: number) =>
    getJson<{ clusters: YearCluster[] }>(`/api/clusters?installYear=${installYear}&lon=${lon}&lat=${lat}`),
  clusters: () => getJson<{ clusters: YearCluster[] }>('/api/clusters'),
};
