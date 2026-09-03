import { describe, expect, it } from 'vitest';
import { buildAdjacencyGraph, detectYearClusters } from '@ashiba/engine';
import { parseCityGML } from './citygml.js';
import { writeCityGML } from './citygml-writer.js';
import { generateFixture } from './fixture.js';

describe('synthetic fixture', () => {
  const fx = generateFixture();

  it('is deterministic and has the expected shape', () => {
    const again = generateFixture();
    expect(again.buildings.map((b) => b.footprint)).toEqual(fx.buildings.map((b) => b.footprint));
    expect(fx.buildings.length).toBeGreaterThanOrEqual(100);
    expect(fx.roads.length).toBe(9);
    for (const b of fx.buildings) {
      expect(b.footprintArea).toBeGreaterThan(40);
      expect(b.footprintArea).toBeLessThan(120);
      expect(b.yearOfConstruction).toBeDefined();
    }
  });

  it('produces dense 2012-2015 clusters and keeps old blocks apart', () => {
    const graph = buildAdjacencyGraph(fx.buildings, { maxGapMeters: 12 });
    const a = fx.buildings.find((b) => b.id.startsWith('bldg-A-'))!;
    const gaps = graph.neighbors[a.id]!.map((n) => n.gapMeters);
    expect(Math.min(...gaps)).toBeLessThan(1.6);
    const clusters = detectYearClusters(fx.buildings, graph, { yearWindow: 2, minSize: 4 });
    const years = clusters.map((c) => c.medianYear);
    expect(years.some((y) => y >= 2012 && y <= 2015)).toBe(true);
    const oldCluster = clusters.find((c) => c.buildingIds.some((id) => id.startsWith('bldg-G-')));
    expect(oldCluster).toBeDefined();
    expect(oldCluster!.buildingIds.every((id) => id.startsWith('bldg-G-'))).toBe(true);
  });

  it('round-trips through CityGML writer and parser', () => {
    const xml = writeCityGML(fx.buildings, fx.roads);
    const parsed = parseCityGML(xml);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.buildings).toHaveLength(fx.buildings.length);
    expect(parsed.roads).toHaveLength(fx.roads.length);
    const src = fx.buildings[0]!;
    const dst = parsed.buildings.find((b) => b.id === src.id)!;
    expect(dst.yearOfConstruction).toBe(src.yearOfConstruction);
    expect(dst.storeysAboveGround).toBe(src.storeysAboveGround);
    expect(dst.address).toBe(src.address);
    expect(dst.footprintArea).toBeCloseTo(src.footprintArea, 0);
    const road = parsed.roads.find((r) => r.id === 'road-alley-d')!;
    expect(road.width).toBe(3);
  });
});
