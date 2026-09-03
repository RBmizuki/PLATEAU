/**
 * データセットの読み込みと派生物(隣接グラフ・築年クラスタ・GeoJSON)のキャッシュ。
 * DATA_FILE 環境変数で PLATEAU 取り込み結果(cli ingest の出力)に差し替えられる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAdjacencyGraph,
  detectYearClusters,
  normalizeBuilding,
  type AdjacencyGraph,
  type Building,
  type Road,
  type YearCluster,
} from '@ashiba/engine';
import { buildingsToGeoJSON, roadsToGeoJSON, type FeatureCollection } from '@ashiba/plateau';

export interface Dataset {
  source: string;
  buildings: Building[];
  buildingById: Map<string, Building>;
  roads: Road[];
  adjacency: AdjacencyGraph;
  clusters: YearCluster[];
  clusterById: Map<string, YearCluster>;
  clusterOfBuilding: Map<string, string>;
  buildingsGeoJSON: FeatureCollection;
  roadsGeoJSON: FeatureCollection;
  bounds: [number, number, number, number];
  meta: Record<string, unknown>;
}

export const DEFAULT_DATA_FILE = resolve(process.cwd(), '../../data/sample/masago.json');

export function loadDataset(file = process.env['DATA_FILE'] ?? DEFAULT_DATA_FILE): Dataset {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as {
    buildings: Building[];
    roads: Road[];
    meta?: Record<string, unknown>;
  };
  // 取り込み元によっては派生値が無いことがあるので再計算する
  const buildings = raw.buildings.map((b) => normalizeBuilding(b));
  const roads = raw.roads ?? [];
  const adjacency = buildAdjacencyGraph(buildings, { maxGapMeters: 12 });
  const clusters = detectYearClusters(buildings, adjacency, { yearWindow: 2, linkGapMeters: 30, minSize: 3 });
  const clusterOfBuilding = new Map<string, string>();
  for (const c of clusters) for (const id of c.buildingIds) clusterOfBuilding.set(id, c.id);
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const b of buildings) {
    for (const [lon, lat] of b.footprint) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return {
    source: file,
    buildings,
    buildingById: new Map(buildings.map((b) => [b.id, b])),
    roads,
    adjacency,
    clusters,
    clusterById: new Map(clusters.map((c) => [c.id, c])),
    clusterOfBuilding,
    buildingsGeoJSON: buildingsToGeoJSON(buildings),
    roadsGeoJSON: roadsToGeoJSON(roads),
    bounds: [minLon, minLat, maxLon, maxLat],
    meta: raw.meta ?? {},
  };
}
