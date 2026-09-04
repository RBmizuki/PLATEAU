/**
 * データセットの読み込みと派生物(隣接グラフ・築年クラスタ・GeoJSON)のキャッシュ。
 * DATA_FILE 環境変数で PLATEAU 取り込み結果(cli ingest の出力)に差し替えられる。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildAdjacencyGraph,
  detectGeometryCohorts,
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
  /** 'year' = 築年クラスタ / 'geometry' = 形状コホート(築年充足率 30% 未満の都市の退避)。 */
  clusterBasis: 'year' | 'geometry';
  yearCoverage: number;
  hasAddresses: boolean;
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
  // 連棟移設の判定用(外壁間 12m まで)と、街区連結用(背中合わせ・道路越しを含む 35m まで)は別のグラフ
  const adjacency = buildAdjacencyGraph(buildings, { maxGapMeters: 12 });
  const withYear = buildings.filter((b) => b.yearOfConstruction !== undefined && b.yearOfConstruction >= 1800).length;
  const yearCoverage = buildings.length > 0 ? withYear / buildings.length : 0;
  // 築年が 30% 以上入っていれば築年クラスタ、無ければ形状コホート(docs/plateau-data.md §4.4 の方針)
  const clusterBasis: 'year' | 'geometry' = yearCoverage >= 0.3 ? 'year' : 'geometry';
  const clusters =
    clusterBasis === 'year'
      ? detectYearClusters(buildings, buildAdjacencyGraph(buildings, { maxGapMeters: 35, maxNeighbors: 24 }), {
          yearWindow: 2,
          linkGapMeters: 35,
          minSize: 3,
          roadBarriers: roads,
          // 用途があれば専用住宅・店舗併用住宅(411/413)に、無ければ規模と高さで戸建て相当に絞る
          residentialUsageCodes: buildings.some((b) => b.usage) ? ['411', '413'] : undefined,
          houseFilter: { areaRange: [35, 220], maxHeightMeters: 13 },
        })
      : detectGeometryCohorts(buildings, adjacency, { minSize: 4 });
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
    clusterBasis,
    yearCoverage,
    hasAddresses: buildings.some((b) => b.address),
    clusterById: new Map(clusters.map((c) => [c.id, c])),
    clusterOfBuilding,
    buildingsGeoJSON: buildingsToGeoJSON(buildings),
    roadsGeoJSON: roadsToGeoJSON(roads),
    bounds: [minLon, minLat, maxLon, maxLat],
    meta: raw.meta ?? {},
  };
}
