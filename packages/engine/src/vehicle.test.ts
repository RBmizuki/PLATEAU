import { describe, expect, it } from 'vitest';
import { classifyVehicle, effectiveRoadWidth, estimateWidthFromPolygons, nearestRoad } from './vehicle.js';
import { localProjector } from './geometry.js';
import type { LngLat, RateTable, Road } from './types.js';

const rt = {
  vehicle: {
    minRoadWidth: { kei: 0, '2t': 3.0, '4t': 4.0 },
    slopePercentDowngrade: 10,
  },
} as unknown as RateTable;

const origin: LngLat = [140.05, 35.65];
const { toLngLat } = localProjector(origin);
const strip = (x: number, y: number, w: number, len: number): LngLat[] => [
  toLngLat([x, y]),
  toLngLat([x + len, y]),
  toLngLat([x + len, y + w]),
  toLngLat([x, y + w]),
  toLngLat([x, y]),
];

describe('vehicle class from PLATEAU roads', () => {
  it('prefers uro:width, then widthType, then geometry', () => {
    expect(effectiveRoadWidth({ id: 'r', polygons: [strip(0, 0, 4, 100)], width: 6 })).toEqual({ width: 6, source: 'uro:width' });
    expect(effectiveRoadWidth({ id: 'r', polygons: [strip(0, 0, 4, 100)], widthType: '2' })).toEqual({ width: 4, source: 'uro:widthType' });
    const g = effectiveRoadWidth({ id: 'r', polygons: [strip(0, 0, 4, 100)] });
    expect(g.source).toBe('lod1-geometry');
    expect(g.width).toBeGreaterThan(3.5);
    expect(g.width).toBeLessThan(4.1);
  });

  it('estimates width of a long strip as ~2A/P', () => {
    expect(estimateWidthFromPolygons([strip(0, 0, 6, 200)])).toBeCloseTo(5.8, 0);
  });

  it('classifies by thresholds and downgrades on slopes', () => {
    expect(classifyVehicle(6, 0, rt).vehicleClass).toBe('4t');
    expect(classifyVehicle(3.5, 0, rt).vehicleClass).toBe('2t');
    expect(classifyVehicle(2.7, 0, rt).vehicleClass).toBe('kei');
    expect(classifyVehicle(6, 12, rt).vehicleClass).toBe('2t');
    expect(classifyVehicle(undefined, 0, rt).vehicleClass).toBe('kei');
  });

  it('finds the nearest road', () => {
    const roads: Road[] = [
      { id: 'near', polygons: [strip(0, -10, 4, 100)], width: 4.5 },
      { id: 'far', polygons: [strip(0, 60, 6, 100)], width: 6 },
    ];
    const r = nearestRoad(toLngLat([50, 0]), roads)!;
    expect(r.road.id).toBe('near');
    expect(r.distanceMeters).toBeCloseTo(6, 0);
  });
});

describe('localRoadWidth (chord through the road polygon in front of the house)', () => {
  it('measures the width of the road facing the house, ignoring a wide plaza', async () => {
    const { localRoadWidth } = await import('./vehicle.js');
    const { normalizeBuilding } = await import('./normalize.js');
    const house = normalizeBuilding({ id: 'h', footprint: [toLngLat([0, 0]), toLngLat([8, 0]), toLngLat([8, 9]), toLngLat([0, 9]), toLngLat([0, 0])] });
    const roads: Road[] = [
      { id: 'front', polygons: [strip(-50, -6.5, 4, 120)] }, // 家の南 2.5m 先、幅 4m
      { id: 'plaza', polygons: [strip(-50, 20, 60, 120)] }, // 北側の広場(幅 60m → 棄却)
    ];
    const r = localRoadWidth(house, roads)!;
    expect(r.roadId).toBe('front');
    expect(r.width).toBeGreaterThan(3.7);
    expect(r.width).toBeLessThan(4.3);
    expect(r.distance).toBeGreaterThan(2);
    expect(r.distance).toBeLessThan(3);
  });
});
