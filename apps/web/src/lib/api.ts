import type { Building, BundleQuote, HouseBreakdown, LeadSpec, Neighbor, RateTable, Staircase, VehicleClass, YearCluster } from '@ashiba/engine';

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
  clusterBasis?: 'year' | 'geometry';
  yearCoverage?: number;
  counts: { buildings: number; roads: number; clusters: number };
}

export interface GeocodeHit {
  id: string;
  address: string | null;
  centroid: [number, number];
  method: string;
  score: number;
}

export interface ResidentQuote {
  rateTableId: string;
  clusterId: string;
  vehicleClass: VehicleClass;
  vehicleReason: string;
  roadWidth: number | null;
  threshold: number;
  single: number;
  current: { size: number; perHouseAverage: number; trucks: number };
  atThreshold: { size: number; perHouseAverage: number; trucks: number };
  mine: HouseBreakdown;
  staircase: Staircase;
  order: Array<{ buildingId: string; registered: boolean; self: boolean }>;
}

export interface QuoteResponse {
  quote: ResidentQuote;
  bundleId: string | null;
  week: string | null;
  registeredIds: string[];
}

export interface BundleSummary {
  id: string;
  clusterId: string;
  week: string;
  status: 'forming' | 'threshold_met' | 'handed_to_contractor' | 'cancelled';
  threshold: number;
  registered: number;
  remaining: number;
  candidateCount: number | null;
  members: Array<{ buildingId: string; installYear: number; capacityKw: number; address: string | null; registeredAt: string }>;
  createdAt: string;
  updatedAt: string;
  handedOverAt: string | null;
  contractorId: string | null;
}

export const api = {
  dataset: () => getJson<DatasetInfo>('/api/dataset'),
  buildingsGeoJSON: () => getJson<FeatureCollection>('/api/buildings.geojson'),
  roadsGeoJSON: () => getJson<FeatureCollection>('/api/roads.geojson'),
  building: (id: string) => getJson<{ building: Building; neighbors: Neighbor[]; clusterId: string | null }>(`/api/buildings/${encodeURIComponent(id)}`),
  geocode: (q: string) => getJson<{ query: string; hits: GeocodeHit[] }>(`/api/geocode?q=${encodeURIComponent(q)}`),
  clustersNear: (installYear: number, lon: number, lat: number, buildingId?: string) =>
    getJson<{ clusters: YearCluster[] }>(`/api/clusters?installYear=${installYear}&lon=${lon}&lat=${lat}${buildingId ? `&buildingId=${encodeURIComponent(buildingId)}` : ''}`),
  clusters: () => getJson<{ clusters: YearCluster[] }>('/api/clusters'),
  rateTable: () => getJson<RateTable>('/api/rate-table'),
  quote: (p: { clusterId: string; buildingId: string; installYear: number; capacityKw?: number; week?: string }) => {
    const q = new URLSearchParams({ clusterId: p.clusterId, buildingId: p.buildingId, installYear: String(p.installYear) });
    if (p.capacityKw) q.set('capacityKw', String(p.capacityKw));
    if (p.week) q.set('week', p.week);
    return getJson<QuoteResponse>(`/api/quote?${q.toString()}`);
  },
  weeks: () => getJson<{ weeks: string[] }>('/api/bundles/weeks'),
  bundles: (clusterId?: string) => getJson<{ bundles: BundleSummary[] }>(`/api/bundles${clusterId ? `?clusterId=${encodeURIComponent(clusterId)}` : ''}`),
  bundle: (id: string) => getJson<{ bundle: BundleSummary; quote: BundleQuote | null }>(`/api/bundles/${encodeURIComponent(id)}`),
  join: (body: { clusterId: string; week?: string; buildingId: string; installYear: number; capacityKw?: number; contactName?: string }) =>
    postJson<{ bundle: BundleSummary; quote: BundleQuote | null }>('/api/bundles/join', body),
  leave: (id: string, buildingId: string) => postJson<{ bundle: BundleSummary }>(`/api/bundles/${encodeURIComponent(id)}/leave`, { buildingId }),
  handover: (id: string, contractorId: string) => postJson<{ bundle: BundleSummary; lead: LeadSpec | null }>(`/api/bundles/${encodeURIComponent(id)}/handover`, { contractorId }),
  lead: (id: string) => getJson<{ bundle: BundleSummary; lead: LeadSpec | null }>(`/api/bundles/${encodeURIComponent(id)}/lead`),
  demoSeed: (body: { clusterId: string; count: number; week?: string; excludeBuildingId?: string }) => postJson<{ bundleId: string; registered: number }>('/api/demo/seed', body),
  demoReset: () => postJson<{ ok: boolean }>('/api/demo/reset', {}),
};

export const yen = (v: number) => `${Math.round(v / 1000) / 10}万円`;
export const yenFull = (v: number) => `${v.toLocaleString('ja-JP')}円`;

/** 束の種のラベル(築年クラスタ / 形状コホート)。 */
export function clusterLabel(c: { basis?: 'year' | 'geometry'; medianYear: number; yearMin: number; yearMax: number; cohort?: { medianAreaSqm: number; medianHeightM: number; medianGapM: number } }): string {
  if (c.basis === 'geometry' || !c.medianYear) {
    const g = c.cohort;
    return g ? `同時期分譲の疑い(形状から推定・底面 ${Math.round(g.medianAreaSqm)} m²・隣棟 ${g.medianGapM} m)` : '同時期分譲の疑い(形状から推定)';
  }
  return `${c.medianYear} 年ごろ(${c.yearMin}〜${c.yearMax})`;
}
