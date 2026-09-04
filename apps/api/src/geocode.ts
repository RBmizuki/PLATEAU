/**
 * 住所 → 建物の解決。
 * 1. データセット内の bldg:address に対する部分一致(オフラインで必ず動く)
 * 2. GSI_GEOCODER=1 のときは国土地理院の住所検索 API を試し、最寄り建物を返す
 */
import { haversineMeters, type Building, type LngLat } from '@ashiba/engine';
import type { Dataset } from './dataset.js';

export interface GeocodeHit {
  building: Building;
  method: 'address-match' | 'gsi-nearest' | 'point-nearest';
  score: number;
}

function normalizeJa(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[‐-–—ー−]/g, '-')
    .replace(/丁目/g, '-')
    .replace(/番地?|号/g, '-')
    .replace(/-+$/g, '')
    .toLowerCase();
}

export function matchAddress(ds: Dataset, query: string, limit = 5): GeocodeHit[] {
  const q = normalizeJa(query);
  if (!q) return [];
  const hits: GeocodeHit[] = [];
  const byId = ds.buildingById.get(query.trim());
  if (byId) hits.push({ building: byId, method: 'address-match', score: 1 });
  for (const b of ds.buildings) {
    if (!b.address) continue;
    const a = normalizeJa(b.address);
    if (a === q) hits.push({ building: b, method: 'address-match', score: 1 });
    else if (a.includes(q) || q.includes(a)) hits.push({ building: b, method: 'address-match', score: Math.min(q.length, a.length) / Math.max(q.length, a.length) });
  }
  hits.sort((x, y) => y.score - x.score || x.building.id.localeCompare(y.building.id));
  return hits.slice(0, limit);
}

export function nearestBuilding(ds: Dataset, point: LngLat): GeocodeHit | undefined {
  let best: GeocodeHit | undefined;
  for (const b of ds.buildings) {
    const d = haversineMeters(b.centroid, point);
    if (!best || d < best.score) best = { building: b, method: 'point-nearest', score: d };
  }
  return best;
}

export async function gsiGeocode(query: string): Promise<LngLat | undefined> {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return undefined;
  const json = (await res.json()) as Array<{ geometry: { coordinates: [number, number] } }>;
  const first = json[0];
  return first ? first.geometry.coordinates : undefined;
}
