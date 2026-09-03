import { describe, expect, it } from 'vitest';
import { buildAdjacencyGraph } from './adjacency.js';
import { localProjector } from './geometry.js';
import { normalizeBuilding } from './normalize.js';
import { buildStaircase, panelsFor, planVehicles, quoteBundle } from './pricing.js';
import { DEFAULT_RATE_TABLE as rt } from './rates.js';
import type { Building, BundleMember, LngLat } from './types.js';

const { toLngLat } = localProjector([140.05, 35.65]);

/** 7.6m × 9m の 2 階建てを x に置く。 */
function house(id: string, x: number, storeys = 2): Building {
  const w = 7.6;
  const d = 9;
  const ring: LngLat[] = [toLngLat([x, 0]), toLngLat([x + w, 0]), toLngLat([x + w, d]), toLngLat([x, d])];
  return normalizeBuilding({ id, footprint: ring, storeysAboveGround: storeys, measuredHeight: storeys === 3 ? 9.8 : 6.9, yearOfConstruction: 2013 });
}

function row(n: number, gap: number): BundleMember[] {
  const out: BundleMember[] = [];
  for (let i = 0; i < n; i++) {
    const b = house(`h${i}`, i * (7.6 + gap));
    out.push({ building: b, installation: { buildingId: b.id, installYear: 2013, capacityKw: 4 } });
  }
  return out;
}

describe('pricing primitives', () => {
  it('converts kW to panels', () => {
    expect(panelsFor(4, rt)).toBe(16);
    expect(panelsFor(undefined, rt)).toBe(16);
    expect(panelsFor(3.9, rt)).toBe(16);
    expect(panelsFor(4.1, rt)).toBe(17);
  });

  it('bin-packs panels into the cheapest vehicle at or below the street limit', () => {
    expect(planVehicles(16, '2t', rt)).toEqual({ vehicleClass: 'kei', trucks: 1, cost: rt.vehicle.dayCost.kei + rt.disposal.transportPerTrip });
    expect(planVehicles(192, '2t', rt).trucks).toBe(3);
    expect(planVehicles(208, '2t', rt).trucks).toBe(4);
    expect(planVehicles(192, 'kei', rt).trucks).toBe(8);
  });
});

describe('staircase', () => {
  const urban = row(16, 1.2);
  const urbanSite = { vehicleClass: '2t' as const, vehicleReason: 'test', adjacency: buildAdjacencyGraph(urban.map((m) => m.building), { maxGapMeters: 12 }) };
  const suburban = row(16, 6);
  const suburbanSite = { vehicleClass: '4t' as const, vehicleReason: 'test', adjacency: buildAdjacencyGraph(suburban.map((m) => m.building), { maxGapMeters: 12 }) };

  it('single house has no relocation and one truck', () => {
    const q = quoteBundle(urban.slice(0, 1), urbanSite, rt);
    expect(q.size).toBe(1);
    expect(q.relocatedHouses).toBe(0);
    expect(q.trucks).toBe(1);
    expect(q.perHouseAverage).toBeGreaterThan(250_000);
    expect(q.perHouseAverage).toBeLessThan(400_000);
  });

  it('relocation applies only inside the bundle', () => {
    const q2 = quoteBundle(urban.slice(0, 2), urbanSite, rt);
    expect(q2.relocatedHouses).toBe(2);
    const apart = quoteBundle([urban[0]!, urban[5]!], urbanSite, rt);
    expect(apart.relocatedHouses).toBe(0);
    expect(quoteBundle(suburban.slice(0, 2), suburbanSite, rt).relocatedHouses).toBe(0);
  });

  it('per-house price falls with size and honestly rises when a truck is added', () => {
    const s = buildStaircase(urban, urbanSite, rt);
    expect(s.steps).toHaveLength(16);
    expect(s.steps[0]!.perHouseAverage).toBe(s.singlePrice);
    const truckSteps = s.steps.filter((st) => st.truckAdded).map((st) => st.size);
    expect(truckSteps.length).toBeGreaterThan(0);
    for (const st of s.steps.slice(1)) {
      if (st.truckAdded) expect(st.deltaFromPrevious).toBeGreaterThan(0);
    }
    expect(s.best.perHouseAverage).toBeLessThan(s.singlePrice * 0.7);
    // 束の合計 = 1 軒あたり × 軒数(端数を除く)
    const q12 = quoteBundle(urban.slice(0, 12), urbanSite, rt);
    expect(Math.abs(q12.bundleTotal - q12.perHouse.reduce((a, h) => a + h.total, 0))).toBeLessThanOrEqual(1);
  });

  it('suburban bundles save less than urban ones at the same size', () => {
    const u = buildStaircase(urban, urbanSite, rt).steps[11]!;
    const s = buildStaircase(suburban, suburbanSite, rt).steps[11]!;
    expect(s.savingsRate).toBeLessThan(u.savingsRate);
    expect(s.savingsRate).toBeGreaterThan(0.1);
  });

  it('allocation by panels shifts shared costs to bigger systems', () => {
    const mixed = row(4, 1.2);
    mixed[0]!.installation.capacityKw = 8;
    const eq = quoteBundle(mixed, urbanSite, rt, { sharedCostAllocation: 'equal' });
    const pp = quoteBundle(mixed, urbanSite, rt, { sharedCostAllocation: 'panels' });
    expect(pp.perHouse[0]!.total).toBeGreaterThan(eq.perHouse[0]!.total);
    expect(Math.abs(pp.bundleTotal - eq.bundleTotal)).toBeLessThanOrEqual(2);
  });
});
