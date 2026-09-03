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
