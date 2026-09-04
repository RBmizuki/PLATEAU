import { describe, expect, it } from 'vitest';
import { buildAdjacencyGraph, relocationEligible } from './adjacency.js';
import { detectYearClusters, clustersForInstallYear } from './clusters.js';
import { localProjector } from './geometry.js';
import { normalizeBuilding } from './normalize.js';
import type { Building, LngLat } from './types.js';

const origin: LngLat = [140.05, 35.65];
const { toLngLat } = localProjector(origin);

/** 一辺 8m の家を (x, y) に置く。 */
function house(id: string, x: number, y: number, year?: number): Building {
  const s = 8;
  const ring: LngLat[] = [
    toLngLat([x, y]),
    toLngLat([x + s, y]),
    toLngLat([x + s, y + s]),
    toLngLat([x, y + s]),
  ];
  return normalizeBuilding({ id, footprint: ring, yearOfConstruction: year, storeysAboveGround: 2 });
}

describe('adjacency + clusters', () => {
  // 3 軒が 1.2m 間隔で並ぶ列と、30m 離れた孤立した家
  const row = [house('a', 0, 0, 2013), house('b', 9.2, 0, 2013), house('c', 18.4, 0, 2014)];
  const far = house('d', 60, 0, 2013);
  const old = house('e', 27.6, 0, 1995);
  const all = [...row, far, old];
  const graph = buildAdjacencyGraph(all, { maxGapMeters: 12 });

  it('measures gaps from the outline, not the centroid', () => {
    expect(graph.neighbors['a']![0]).toEqual({ buildingId: 'b', gapMeters: 1.2 });
    expect(graph.neighbors['b']!.map((n) => n.buildingId).sort()).toEqual(['a', 'c', 'e']);
    expect(graph.neighbors['b']!.find((n) => n.buildingId === 'e')!.gapMeters).toBeCloseTo(10.4, 1);
    expect(graph.neighbors['d']).toEqual([]);
  });

  it('normalizes area and perimeter in metres', () => {
    expect(row[0]!.footprintArea).toBeCloseTo(64, 0);
    expect(row[0]!.perimeter).toBeCloseTo(32, 0);
  });

  it('relocation eligibility requires a bundled neighbour within the gap', () => {
    const eligible = relocationEligible(new Set(['a', 'b', 'd']), graph, 1.5);
    expect([...eligible].sort()).toEqual(['a', 'b']);
    const alone = relocationEligible(new Set(['a', 'c']), graph, 1.5);
    expect(alone.size).toBe(0);
  });

  it('clusters by year window along the adjacency graph', () => {
    const clusters = detectYearClusters(all, graph, { yearWindow: 2, minSize: 2 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.buildingIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0]!.medianYear).toBe(2013);
    expect(clusters[0]!.id).toMatch(/^yc-2013-001$/);
  });

  it('finds clusters matching an install year near a point', () => {
    const clusters = detectYearClusters(all, graph, { yearWindow: 2, minSize: 2 });
    expect(clustersForInstallYear(clusters, 2013, far.centroid)).toHaveLength(1);
    expect(clustersForInstallYear(clusters, 2005, far.centroid)).toHaveLength(0);
  });
});

describe('road barriers split clusters into street blocks', () => {
  it('does not link houses across a road polygon', () => {
    // 2 軒が 10m 離れて並び、その間に幅 4m の道路がある
    const a = house('a', 0, 0, 2013);
    const b = house('b', 18, 0, 2013);
    const c = house('c', 27.2, 0, 2013);
    const road = {
      id: 'r',
      polygons: [[toLngLat([10, -50]), toLngLat([14, -50]), toLngLat([14, 50]), toLngLat([10, 50]), toLngLat([10, -50])] as LngLat[]],
      width: 4,
    };
    const graph = buildAdjacencyGraph([a, b, c], { maxGapMeters: 30 });
    const without = detectYearClusters([a, b, c], graph, { yearWindow: 2, minSize: 2 });
    expect(without).toHaveLength(1);
    const withRoad = detectYearClusters([a, b, c], graph, { yearWindow: 2, minSize: 2, roadBarriers: [road] });
    expect(withRoad).toHaveLength(1);
    expect(withRoad[0]!.buildingIds).toEqual(['b', 'c']);
  });
});

describe('fallbacks for cities without roads or years', () => {
  it('estimates street width from facing buildings', async () => {
    const { estimateStreetWidthFromBuildings } = await import('./vehicle.js');
    // 南側の列と北側の列が 8 m の街路(幅 6 m + 後退 1 m × 2)を挟んで向かい合い、裏には 4 m の隙間で別の家がある
    const south = [house('s0', 0, 0), house('s1', 9.2, 0), house('s2', 18.4, 0)];
    const north = [house('n0', 0, 16), house('n1', 9.2, 16), house('n2', 18.4, 16)];
    const back = [house('b0', 0, -12), house('b1', 9.2, -12), house('b2', 18.4, -12)];
    const est = estimateStreetWidthFromBuildings(south[1]!, [...south, ...north, ...back])!;
    expect(est.corridor).toBeCloseTo(8, 0);
    expect(est.width).toBeCloseTo(6, 0);
    expect(est.facingId).toBe('n1');
    // 裏の家との 4 m の隙間や隣家との 1.2 m は街路とみなさない
    const alone = estimateStreetWidthFromBuildings(back[1]!, [...back, ...south]);
    expect(alone).toBeUndefined();
  });

  it('detects geometry cohorts when years are missing', async () => {
    const { detectGeometryCohorts } = await import('./clusters.js');
    const rowA = [0, 1, 2, 3, 4].map((i) => house(`a${i}`, i * 9.2, 0));
    const big = normalizeBuilding({ id: 'big', footprint: [toLngLat([46, 0]), toLngLat([70, 0]), toLngLat([70, 9]), toLngLat([46, 9])], storeysAboveGround: 4, measuredHeight: 13 });
    const rowB = [0, 1, 2, 3].map((i) => house(`b${i}`, 72 + i * 9.2, 0));
    const all = [...rowA, big, ...rowB].map((b) => ({ ...b, yearOfConstruction: undefined }));
    const graph = buildAdjacencyGraph(all, { maxGapMeters: 12 });
    const cohorts = detectGeometryCohorts(all, graph, { minSize: 3 });
    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]!.basis).toBe('geometry');
    expect(cohorts[0]!.buildingIds).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(cohorts[1]!.buildingIds).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(cohorts[0]!.cohort!.medianGapM).toBeCloseTo(1.2, 1);
  });
});
