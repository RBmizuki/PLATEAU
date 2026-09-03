/**
 * docs/pricing-model.md §5 のテストケース(T1〜T10)。
 * 標準家屋: 8 m × 8 m(外周 32 m)・2 階建て・measuredHeight 無し → 高さ 6.0 m、外壁 192 m²、4kW = 16 枚。
 */
import { describe, expect, it } from 'vitest';
import { buildAdjacencyGraph } from './adjacency.js';
import { localProjector } from './geometry.js';
import { normalizeBuilding } from './normalize.js';
import { buildStaircase, panelsFor, planVehicles, quoteBundle } from './pricing.js';
import { DEFAULT_RATE_TABLE as rt } from './rates.js';
import { classifyVehicle } from './vehicle.js';
import type { Building, BundleMember, LngLat, SiteContext } from './types.js';

const { toLngLat } = localProjector([140.05, 35.65]);

function house(id: string, x: number, storeys = 2, measuredHeight?: number, size = 8): Building {
  const s = size;
  const ring: LngLat[] = [toLngLat([x, 0]), toLngLat([x + s, 0]), toLngLat([x + s, s]), toLngLat([x, s])];
  return normalizeBuilding({ id, footprint: ring, storeysAboveGround: storeys, measuredHeight, yearOfConstruction: 2013 });
}
function member(b: Building, kw = 4): BundleMember {
  return { building: b, installation: { buildingId: b.id, installYear: 2013, capacityKw: kw } };
}
function row(n: number, gap: number, kw = 4): BundleMember[] {
  return Array.from({ length: n }, (_, i) => member(house(`h${i}`, i * (8 + gap)), kw));
}
function site(members: readonly BundleMember[], width: number, slope = 0): SiteContext {
  const v = classifyVehicle(width, slope, rt, 'uro:width');
  return { vehicleClass: v.vehicleClass, vehicleReason: v.reason, adjacency: buildAdjacencyGraph(members.map((m) => m.building), { maxGapMeters: 12 }) };
}
const within = (actual: number, expected: number, tol = 0.05) => expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(tol);

const urban = row(24, 1.2);
const urbanSite = site(urban, 4.5);
const suburban = row(24, 6);
const suburbanSite = site(suburban, 6.0);

describe('T1 都市街区の段差(2t・移設あり)', () => {
  const s = buildStaircase(urban, urbanSite, rt);
  const expected: Array<[number, number, number, number, number, boolean]> = [
    // n, perHouseAverage, trucks, crewDays, relocated, truckAdded
    [1, 319_840, 1, 1, 0, false],
    [2, 211_907, 1, 1, 2, false],
    [3, 200_574, 1, 2, 3, false],
    [4, 186_907, 1, 2, 4, false],
    [6, 191_907, 2, 3, 6, false],
    [8, 184_407, 2, 4, 8, false],
    [12, 183_574, 3, 6, 12, false],
    [13, 189_292, 4, 7, 13, true],
    [16, 183_157, 4, 8, 16, false],
    [24, 182_741, 6, 12, 24, false],
  ];
  it.each(expected)('n=%i → %i 円/軒(±5%)', (n, price, trucks, crewDays, relocated, truckAdded) => {
    const st = s.steps[n - 1]!;
    within(st.perHouseAverage, price);
    expect(st.vehicleClass).toBe('2t');
    expect(st.trucks).toBe(trucks);
    expect(st.crewDays).toBe(crewDays);
    expect(st.truckAdded).toBe(truckAdded);
    expect(quoteBundle(urban.slice(0, n), urbanSite, rt).relocatedHouses).toBe(relocated);
    if (n > 1) expect(Math.sign(st.deltaFromPrevious)).toBe(truckAdded ? 1 : -1);
  });
  it('urbanSite is a 2t street', () => {
    expect(urbanSite.vehicleClass).toBe('2t');
    expect(s.vehicleClass).toBe('2t');
  });
  it('trucks are added at 5, 9, 13, 17, 21 and every such step goes up', () => {
    const added = s.steps.filter((st) => st.truckAdded).map((st) => st.size);
    expect(added).toEqual([5, 9, 13, 17, 21]);
    for (const st of s.steps.filter((x) => x.truckAdded)) expect(st.deltaFromPrevious).toBeGreaterThan(0);
    within(s.steps[4]!.deltaFromPrevious, 14_200);
    within(s.steps[8]!.deltaFromPrevious, 8_167);
    expect(s.steps[12]!.deltaFromPrevious).toBeGreaterThanOrEqual(5_400);
    expect(s.steps[12]!.deltaFromPrevious).toBeLessThanOrEqual(6_050);
  });
  it('savings at 12 is 40–45%, single equals step 1, best is a multiple of 4', () => {
    expect(s.steps[11]!.savingsRate).toBeGreaterThanOrEqual(0.4);
    expect(s.steps[11]!.savingsRate).toBeLessThanOrEqual(0.45);
    expect(s.singlePrice).toBe(s.steps[0]!.perHouseAverage);
    expect(buildStaircase(urban, urbanSite, rt, { maxSize: 12 }).best.size).toBe(12);
    expect(s.best.size).toBe(24);
  });
  it('12-house bundle categories and per-house breakdown', () => {
    const q = quoteBundle(urban.slice(0, 12), urbanSite, rt);
    within(q.byCategory.scaffold, 714_888);
    within(q.byCategory.vehicle, 180_000);
    within(q.byCategory.disposal, 348_000);
    within(q.byCategory.electrical, 300_000);
    within(q.byCategory.removal, 288_000);
    within(q.byCategory.roofRepair, 180_000);
    within(q.byCategory.crew, 192_000);
    within(q.bundleTotal, 2_202_888);
    within(Math.round(q.bundleTotal * rt.leadFeeRate), 110_144);
    const h = q.perHouse[0]!;
    within(h.scaffold, 59_574);
    within(h.vehicle, 15_000);
    within(h.disposal, 29_000);
    within(h.crew, 16_000);
    within(h.total, 183_574);
    expect(h.scaffoldRelocated).toBe(true);
    expect(h.relocationNeighborId).toBe('h1');
  });
  it('single-house breakdown', () => {
    const h = quoteBundle(urban.slice(0, 1), urbanSite, rt).perHouse[0]!;
    within(h.scaffold, 119_840);
    within(h.vehicle, 60_000);
    within(h.disposal, 44_000);
    within(h.electrical, 25_000);
    within(h.removal, 24_000);
    within(h.roofRepair, 15_000);
    within(h.crew, 32_000);
    expect(h.scaffoldRelocated).toBe(false);
  });
});

describe('T2 郊外街区の段差(4t 可・移設なし)', () => {
  const s = buildStaircase(suburban, suburbanSite, rt);
  it('prices at 1, 6, 12 and vehicle switch from 2t to 4t', () => {
    expect(suburbanSite.vehicleClass).toBe('4t');
    expect(s.vehicleClass).toBe('4t');
    within(s.steps[0]!.perHouseAverage, 319_840);
    expect(s.steps[0]!.vehicleClass).toBe('2t');
    within(s.steps[5]!.perHouseAverage, 224_673);
    expect(s.steps[5]!.vehicleClass).toBe('4t');
    expect(s.steps[5]!.trucks).toBe(1);
    expect(s.steps[5]!.crewDays).toBe(3);
    within(s.steps[11]!.perHouseAverage, 223_007);
    expect(s.steps[11]!.trucks).toBe(2);
    expect(s.steps[11]!.crewDays).toBe(6);
    for (const st of s.steps) expect(quoteBundle(suburban.slice(0, st.size), suburbanSite, rt).relocatedHouses).toBe(0);
    expect(s.steps[11]!.savingsRate).toBeGreaterThanOrEqual(0.28);
    expect(s.steps[11]!.savingsRate).toBeLessThanOrEqual(0.33);
    expect(s.steps[8]!.truckAdded).toBe(true);
    within(s.steps[8]!.deltaFromPrevious, 11_708);
    // 5 軒目: 台数据え置きで 2t → 4t に切り替わる段
    expect(s.steps[4]!.truckAdded).toBe(false);
    expect(s.steps[4]!.crewDayAdded).toBe(true);
    expect(s.steps[4]!.vehicleClass).toBe('4t');
  });
  it('urban minus suburban at 12 ≈ 39,433 (the value of relocation)', () => {
    const u = buildStaircase(urban, urbanSite, rt).steps[11]!.perHouseAverage;
    within(s.steps[11]!.perHouseAverage - u, 39_433);
  });
  it('suburb with a 4.5 m street stays on 2t', () => {
    const s2 = buildStaircase(suburban, site(suburban, 4.5), rt);
    within(s2.steps[11]!.perHouseAverage, 225_507);
    expect(s2.steps[11]!.savingsRate).toBeGreaterThanOrEqual(0.27);
    expect(s2.steps[11]!.savingsRate).toBeLessThanOrEqual(0.32);
  });
});

describe('T3 移設は束の中に 2 m 以内の隣家がいる軒だけ', () => {
  const a = house('a', 0);
  const b = house('b', 9.2);
  const c = house('c', 18.4);
  const d = house('d', 23.2 + 8 + 6 - 8); // b の東端 17.2 から 6 m
  const all = [a, b, c, d].map((x) => member(x));
  const st: SiteContext = { vehicleClass: '2t', vehicleReason: 'test', adjacency: buildAdjacencyGraph([a, b, c, d], { maxGapMeters: 12 }) };
  it('[a, b, d]: a and b relocate, d does not', () => {
    const q = quoteBundle([all[0]!, all[1]!, all[3]!], st, rt);
    expect(q.relocatedHouses).toBe(2);
    within(q.perHouse[0]!.scaffold, 64_574);
    within(q.perHouse[0]!.total, 200_574);
    expect(q.perHouse[2]!.scaffoldRelocated).toBe(false);
    within(q.perHouse[2]!.scaffold, 106_507);
    within(q.perHouse[2]!.total, 242_507);
    within(q.perHouseAverage, 214_552);
    expect(q.trucks).toBe(1);
    expect(q.crewDays).toBe(2);
  });
  it('[a, b, c, d]: three relocate, the isolated one pays full', () => {
    const q = quoteBundle(all, st, rt);
    expect(q.relocatedHouses).toBe(3);
    within(q.perHouse[3]!.total, 228_840);
    within(q.perHouse[0]!.total, 186_907);
    within(q.perHouseAverage, 197_390);
  });
  it('[a] alone and [a, c] (non-adjacent) get no relocation', () => {
    expect(quoteBundle([all[0]!], st, rt).relocatedHouses).toBe(0);
    within(quoteBundle([all[0]!], st, rt).perHouse[0]!.scaffold, 119_840);
    expect(quoteBundle([all[0]!, all[2]!], st, rt).relocatedHouses).toBe(0);
    expect(quoteBundle(suburban.slice(0, 2), suburbanSite, rt).relocatedHouses).toBe(0);
  });
});

describe('T4 感度: 足場削減率 40〜60% で 12 軒の単価は ±1.2 万', () => {
  it('relocationFactor 0.70 / 0.46', () => {
    const at = (f: number) => buildStaircase(urban, urbanSite, { ...rt, scaffold: { ...rt.scaffold, relocationFactor: f } }).steps[11]!.perHouseAverage;
    const mid = at(0.58);
    const hi = at(0.7) - mid;
    const lo = mid - at(0.46);
    expect(hi).toBeGreaterThanOrEqual(11_400);
    expect(hi).toBeLessThanOrEqual(12_600);
    expect(lo).toBeGreaterThanOrEqual(11_400);
    expect(lo).toBeLessThanOrEqual(12_600);
  });
});

describe('T5 車格判定', () => {
  it.each([
    [4.5, 0, '2t'],
    [6.0, 0, '4t'],
    [5.5, 0, '4t'],
    [5.4, 0, '2t'],
    [4.0, 0, '2t'],
    [3.9, 0, 'kei'],
    [3.0, 0, 'kei'],
    [6.0, 12, '2t'],
    [3.0, 12, 'kei'],
  ] as Array<[number, number, string]>)('width %f slope %f → %s', (w, sl, cls) => {
    expect(classifyVehicle(w, sl, rt).vehicleClass).toBe(cls);
  });
  it('unknown width → kei with reason', () => {
    const d = classifyVehicle(undefined, 0, rt);
    expect(d.vehicleClass).toBe('kei');
    expect(d.reason).toContain('不明');
  });
});

describe('T6 車両計画', () => {
  it.each([
    [16, '2t', '2t', 1, 80_000],
    [16, '4t', '2t', 1, 80_000],
    [12, '4t', 'kei', 1, 50_000],
    [64, '4t', '2t', 1, 80_000],
    [80, '4t', '4t', 1, 105_000],
    [192, '4t', '4t', 2, 210_000],
    [192, '2t', '2t', 3, 240_000],
    [208, '2t', '2t', 4, 320_000],
    [192, 'kei', 'kei', 16, 800_000],
  ] as Array<[number, 'kei' | '2t' | '4t', string, number, number]>)('%i panels, max %s → %s × %i = %i', (p, max, cls, trucks, cost) => {
    expect(planVehicles(p, max, rt)).toEqual({ vehicleClass: cls, trucks, cost });
  });
  it('kW → panels', () => {
    expect(panelsFor(4, rt)).toBe(16);
    expect(panelsFor(3.9, rt)).toBe(16);
    expect(panelsFor(4.1, rt)).toBe(17);
    expect(panelsFor(undefined, rt)).toBe(16);
  });
});

describe('T7 正直さの性質', () => {
  const kei = row(12, 1.2);
  const keiSite = site(kei, 3.0);
  const mixed = row(10, 1.2).map((m, i) => ({ ...m, installation: { ...m.installation, capacityKw: i % 3 === 0 ? 8 : i % 3 === 1 ? 3 : 4 } }));
  const cases: Array<[string, BundleMember[], SiteContext]> = [
    ['urban', urban, urbanSite],
    ['suburban', suburban, suburbanSite],
    ['kei', kei, keiSite],
    ['mixed', mixed, site(mixed, 4.5)],
  ];
  it.each(cases)('%s: a step only goes up when a truck or a crew day is added', (_, members, st) => {
    const s = buildStaircase(members, st, rt);
    for (const step of s.steps.slice(1)) {
      if (step.deltaFromPrevious > 0) expect(step.truckAdded || step.crewDayAdded).toBe(true);
    }
    for (let n = 1; n <= members.length; n++) {
      const q = quoteBundle(members.slice(0, n), st, rt);
      expect(Math.abs(q.perHouse.reduce((a, h) => a + h.total, 0) - q.bundleTotal)).toBeLessThanOrEqual(1);
      const cat = Object.values(q.byCategory).reduce((a, v) => a + v, 0);
      expect(Math.abs(cat - q.bundleTotal)).toBeLessThanOrEqual(n);
    }
  });
  it('urban: truckAdded ⇒ up; kei street: every step adds trips but still falls', () => {
    for (const st of buildStaircase(urban, urbanSite, rt).steps) if (st.truckAdded) expect(st.deltaFromPrevious).toBeGreaterThan(0);
    expect(keiSite.vehicleClass).toBe('kei');
    const k = buildStaircase(kei, keiSite, rt);
    expect(k.steps.slice(1).every((st) => st.truckAdded)).toBe(true);
    expect(k.steps[11]!.perHouseAverage).toBeLessThan(k.singlePrice);
  });
});

describe('T8 最低額と実測高', () => {
  it('small bungalow with 3kW uses the minimum scaffold and a kei trip', () => {
    const b = house('s', 0, 1, undefined, 6);
    const q = quoteBundle([member(b, 3)], { vehicleClass: '2t', vehicleReason: 't', adjacency: buildAdjacencyGraph([b]) }, rt);
    within(q.perHouse[0]!.scaffold, 80_000);
    expect(q.perHouse[0]!.panels).toBe(12);
    within(q.perHouse[0]!.vehicle, 30_000);
    within(q.perHouse[0]!.total, 238_000);
  });
  it('measured height 9.8 m (3 storeys) raises the scaffold', () => {
    const b = house('t', 0, 3, 9.8);
    const q = quoteBundle([member(b)], { vehicleClass: '2t', vehicleReason: 't', adjacency: buildAdjacencyGraph([b]) }, rt);
    within(q.perHouse[0]!.wallAreaSqm, 313.6);
    within(q.perHouse[0]!.scaffold, 183_072);
    within(q.perHouse[0]!.total, 383_072);
  });
});

describe('T9 配賦則(4 軒・先頭だけ 8kW)', () => {
  const four = row(4, 1.2);
  four[0]!.installation.capacityKw = 8;
  const st = site(four, 4.5);
  it('bundleTotal is allocation-independent; hybrid splits vehicle by panels and crew equally', () => {
    const hybrid = quoteBundle(four, st, rt);
    const equal = quoteBundle(four, st, rt, { sharedCostAllocation: 'equal' });
    const panels = quoteBundle(four, st, rt, { sharedCostAllocation: 'panels' });
    within(hybrid.bundleTotal, 875_628);
    expect(Math.abs(hybrid.bundleTotal - equal.bundleTotal)).toBeLessThanOrEqual(2);
    expect(Math.abs(hybrid.bundleTotal - panels.bundleTotal)).toBeLessThanOrEqual(2);
    within(hybrid.perHouse[0]!.total, 278_907);
    within(hybrid.perHouse[1]!.total, 198_907);
    within(equal.perHouse[0]!.total, 254_907);
    within(panels.perHouse[0]!.total, 291_507);
    within(hybrid.perHouse[0]!.vehicle, 48_000);
    within(hybrid.perHouse[0]!.crew, 16_000);
    within(panels.perHouse[0]!.crew, 25_600);
  });
});

describe('T10 6 軒の値', () => {
  it('is about 192k, not the report\'s 230k', () => {
    const s = buildStaircase(urban, urbanSite, rt);
    within(s.steps[5]!.perHouseAverage, 191_907);
    const diff = s.steps[5]!.perHouseAverage - s.steps[11]!.perHouseAverage;
    expect(diff).toBeGreaterThanOrEqual(5_000);
    expect(diff).toBeLessThanOrEqual(12_000);
  });
});
