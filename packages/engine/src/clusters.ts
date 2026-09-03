import type { AdjacencyGraph, Building, LngLat, Road, YearCluster } from './types.js';
import { bbox, haversineMeters, localProjector, segmentsIntersect, type BBox, type XY } from './geometry.js';

export interface ClusterOptions {
  /** 同じクラスタとみなす築年差の上限(年)。 */
  yearWindow?: number;
  /** 隣棟間隔がこの距離 [m] 以内なら同じ街区として連結する。 */
  linkGapMeters?: number;
  /** クラスタとして採用する最小軒数。 */
  minSize?: number;
  /** 住宅用途コードのみを対象にする場合に指定(未指定なら全件)。 */
  residentialUsageCodes?: readonly string[];
  /**
   * 街区の境界として使う道路(PLATEAU tran:Road の LOD1 面)。
   * 2 棟の重心を結ぶ線分が道路面の辺を横切る場合は連結しない = 道路で区切られた区画を街区とする。
   */
  roadBarriers?: readonly Road[];
}

interface Barrier {
  ring: XY[];
  box: BBox;
}

function buildBarriers(roads: readonly Road[], toXY: (p: LngLat) => XY): Barrier[] {
  const out: Barrier[] = [];
  for (const r of roads) {
    for (const poly of r.polygons) {
      const ring = poly.map(toXY);
      if (ring.length < 4) continue;
      out.push({ ring, box: bbox(ring) });
    }
  }
  return out;
}

function segmentBox(a: XY, b: XY): BBox {
  return { minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]), maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]) };
}

function boxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** 線分 a-b が道路面の辺を横切るか。 */
export function crossesBarrier(a: XY, b: XY, barriers: readonly Barrier[]): boolean {
  const sb = segmentBox(a, b);
  for (const br of barriers) {
    if (!boxesOverlap(sb, br.box)) continue;
    const r = br.ring;
    for (let i = 0; i < r.length - 1; i++) {
      if (segmentsIntersect(a, b, r[i]!, r[i + 1]!)) return true;
    }
  }
  return false;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * 築年クラスタ検出。
 * 隣接グラフで近い建物同士のうち、築年差が yearWindow 以内のものを連結し、
 * 連結成分ごとに「同時期分譲・同時期搭載が疑われる束の種」を返す。
 * 築年が無い建物はクラスタに入れない(断定しない)。
 */
export function detectYearClusters(
  buildings: readonly Building[],
  graph: AdjacencyGraph,
  options: ClusterOptions = {},
): YearCluster[] {
  const yearWindow = options.yearWindow ?? 2;
  const linkGap = options.linkGapMeters ?? 30;
  const minSize = options.minSize ?? 3;
  const usageSet = options.residentialUsageCodes ? new Set(options.residentialUsageCodes) : null;

  const projector = buildings.length > 0 ? localProjector(buildings[0]!.centroid) : undefined;
  const barriers = options.roadBarriers && projector ? buildBarriers(options.roadBarriers, projector.toXY) : [];
  const xy: XY[] = projector ? buildings.map((b) => projector.toXY(b.centroid)) : [];

  const index = new Map<string, number>();
  const eligible: number[] = [];
  buildings.forEach((b, i) => {
    index.set(b.id, i);
    if (b.yearOfConstruction === undefined) return;
    if (usageSet && (!b.usage || !usageSet.has(b.usage))) return;
    eligible.push(i);
  });
  const eligibleSet = new Set(eligible);

  const uf = new UnionFind(buildings.length);
  for (const i of eligible) {
    const b = buildings[i]!;
    for (const n of graph.neighbors[b.id] ?? []) {
      if (n.gapMeters > linkGap) continue;
      const j = index.get(n.buildingId);
      if (j === undefined || !eligibleSet.has(j)) continue;
      const other = buildings[j]!;
      if (Math.abs(other.yearOfConstruction! - b.yearOfConstruction!) > yearWindow) continue;
      if (barriers.length > 0 && crossesBarrier(xy[i]!, xy[j]!, barriers)) continue;
      uf.union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (const i of eligible) {
    const r = uf.find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const clusters: YearCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < minSize) continue;
    const years = members.map((i) => buildings[i]!.yearOfConstruction!).sort((a, b) => a - b);
    const medianYear = years[Math.floor(years.length / 2)]!;
    const centroid = meanLngLat(members.map((i) => buildings[i]!.centroid));
    clusters.push({
      id: '',
      medianYear,
      yearMin: years[0]!,
      yearMax: years[years.length - 1]!,
      buildingIds: members.map((i) => buildings[i]!.id).sort(),
      centroid,
      candidateCount: members.length,
    });
  }
  // 大きい順・同数なら西→東で安定ソートし、決定的な ID を振る
  clusters.sort((a, b) => b.candidateCount - a.candidateCount || a.centroid[0] - b.centroid[0]);
  clusters.forEach((c, i) => {
    c.id = `yc-${c.medianYear}-${String(i + 1).padStart(3, '0')}`;
  });
  return clusters;
}

/** 設置年の申告から「寿命の窓が重なりうる」クラスタを探す(街区単位)。 */
export function clustersForInstallYear(
  clusters: readonly YearCluster[],
  installYear: number,
  near: LngLat,
  options: { yearWindow?: number; maxDistanceMeters?: number } = {},
): YearCluster[] {
  const yearWindow = options.yearWindow ?? 3;
  const maxDistance = options.maxDistanceMeters ?? 400;
  return clusters
    .filter((c) => Math.abs(c.medianYear - installYear) <= yearWindow)
    .filter((c) => haversineMeters(c.centroid, near) <= maxDistance)
    .sort((a, b) => haversineMeters(a.centroid, near) - haversineMeters(b.centroid, near));
}

function meanLngLat(points: readonly LngLat[]): LngLat {
  let lon = 0;
  let lat = 0;
  for (const [x, y] of points) {
    lon += x;
    lat += y;
  }
  return [lon / points.length, lat / points.length];
}
