import type { AdjacencyGraph, Building, LngLat, Neighbor } from './types.js';
import { bbox, bboxDistance, localProjector, ringRingDistance, type XY } from './geometry.js';

export interface AdjacencyOptions {
  /** この距離 [m] 以内の建物だけを隣棟として記録する。 */
  maxGapMeters?: number;
  /** 1 建物あたりに保持する隣棟の最大数(近い順)。 */
  maxNeighbors?: number;
}

/**
 * LOD1 輪郭の実寸から隣棟間隔を計算し、隣接グラフを作る。
 * グリッド索引で候補を絞り、bbox 距離で早期に打ち切る。
 */
export function buildAdjacencyGraph(
  buildings: readonly Building[],
  options: AdjacencyOptions = {},
): AdjacencyGraph {
  const maxGap = options.maxGapMeters ?? 12;
  const maxNeighbors = options.maxNeighbors ?? 8;
  const neighbors: Record<string, Neighbor[]> = {};
  if (buildings.length === 0) return { neighbors };

  const origin: LngLat = buildings[0]!.centroid;
  const { toXY } = localProjector(origin);
  const rings: XY[][] = buildings.map((b) => b.footprint.map(toXY));
  const boxes = rings.map((r) => bbox(r));

  // グリッド索引(セル幅 = maxGap + 代表的な建物幅)
  const cell = maxGap + 20;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  boxes.forEach((bx, i) => {
    const x0 = Math.floor(bx.minX / cell);
    const x1 = Math.floor(bx.maxX / cell);
    const y0 = Math.floor(bx.minY / cell);
    const y1 = Math.floor(bx.maxY / cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx}:${gy}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  });

  const pairDistance = new Map<string, number>();
  const pairKey = (i: number, j: number) => (i < j ? `${i}-${j}` : `${j}-${i}`);

  for (let i = 0; i < buildings.length; i++) {
    const bx = boxes[i]!;
    const candidates = new Set<number>();
    const x0 = Math.floor((bx.minX - maxGap) / cell);
    const x1 = Math.floor((bx.maxX + maxGap) / cell);
    const y0 = Math.floor((bx.minY - maxGap) / cell);
    const y1 = Math.floor((bx.maxY + maxGap) / cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (const j of grid.get(keyOf(gx * cell, gy * cell)) ?? []) {
          if (j !== i) candidates.add(j);
        }
      }
    }
    const found: Neighbor[] = [];
    for (const j of candidates) {
      if (bboxDistance(bx, boxes[j]!) > maxGap) continue;
      const k = pairKey(i, j);
      let d = pairDistance.get(k);
      if (d === undefined) {
        d = ringRingDistance(rings[i]!, rings[j]!);
        pairDistance.set(k, d);
      }
      if (d <= maxGap) found.push({ buildingId: buildings[j]!.id, gapMeters: round(d, 2) });
    }
    found.sort((a, b) => a.gapMeters - b.gapMeters);
    neighbors[buildings[i]!.id] = found.slice(0, maxNeighbors);
  }
  return { neighbors };
}

/**
 * 束の中で「連棟移設が効く」軒と、その根拠になった最も近い束内の隣家。
 * 束の外にいる隣家は数えない。n = 1 は必ず空。
 */
export function relocationPartners(
  bundleIds: ReadonlySet<string>,
  graph: AdjacencyGraph,
  maxGapMeters: number,
): Map<string, string> {
  const partners = new Map<string, string>();
  for (const id of bundleIds) {
    for (const n of graph.neighbors[id] ?? []) {
      if (n.gapMeters <= maxGapMeters && bundleIds.has(n.buildingId)) {
        partners.set(id, n.buildingId); // neighbors は近い順なので最初の一致が最も近い
        break;
      }
    }
  }
  return partners;
}

/** 束の中で「連棟移設が効く」軒を判定する。 */
export function relocationEligible(
  bundleIds: ReadonlySet<string>,
  graph: AdjacencyGraph,
  maxGapMeters: number,
): Set<string> {
  const eligible = new Set<string>();
  for (const id of bundleIds) {
    for (const n of graph.neighbors[id] ?? []) {
      if (n.gapMeters <= maxGapMeters && bundleIds.has(n.buildingId)) {
        eligible.add(id);
        break;
      }
    }
  }
  return eligible;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
