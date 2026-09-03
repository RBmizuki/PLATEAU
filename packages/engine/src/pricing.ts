/**
 * 段差価格エンジン。
 *
 * 束の値段 = 軒ごとの変動費 + 束レベルの固定費(足場搬入・車両・班日)÷ 軒数。
 * 固定費は「台数」「班日」という整数で決まるため、軒数が増えて 1 台・1 日増える段では
 * 1 軒あたりが正直に少し戻る。
 *
 * 単価表(RateTable)はすべて差し替え可能。既定値は docs/pricing-model.md を参照。
 */
import type {
  AdjacencyGraph,
  Building,
  BundleMember,
  BundleQuote,
  HouseBreakdown,
  RateTable,
  SiteContext,
  Staircase,
  StaircaseStep,
  VehicleClass,
} from './types.js';
import { relocationEligible } from './adjacency.js';
import { wallAreaSqm } from './normalize.js';

const VEHICLE_ORDER: VehicleClass[] = ['kei', '2t', '4t'];

/** kW → パネル枚数(切り上げ)。 */
export function panelsFor(capacityKw: number | undefined, rt: RateTable): number {
  const kw = capacityKw && capacityKw > 0 ? capacityKw : rt.defaultCapacityKw;
  return Math.max(1, Math.ceil(kw / rt.kwPerPanel));
}

export interface VehiclePlan {
  vehicleClass: VehicleClass;
  trucks: number;
  cost: number;
}

/**
 * 車両計画。街区の上限車格以下で「台数 ×(1 日費用 + 処分場往復)」が最小の車格を選ぶ。
 * 同額なら大きい車格(台数が少ない)を優先する。
 */
export function planVehicles(totalPanels: number, maxClass: VehicleClass, rt: RateTable): VehiclePlan {
  const maxIdx = VEHICLE_ORDER.indexOf(maxClass);
  let best: VehiclePlan | undefined;
  for (let i = 0; i <= maxIdx; i++) {
    const cls = VEHICLE_ORDER[i]!;
    const cap = rt.vehicle.panelCapacity[cls];
    if (cap <= 0) continue;
    const trucks = Math.max(1, Math.ceil(totalPanels / cap));
    const cost = trucks * (rt.vehicle.dayCost[cls] + rt.disposal.transportPerTrip);
    if (!best || cost <= best.cost) best = { vehicleClass: cls, trucks, cost };
  }
  return best ?? { vehicleClass: maxClass, trucks: 1, cost: rt.vehicle.dayCost[maxClass] + rt.disposal.transportPerTrip };
}

export function crewDaysFor(houses: number, rt: RateTable): number {
  return Math.max(1, Math.ceil(houses / Math.max(1, rt.labor.housesPerCrewDay)));
}

export interface QuoteOptions {
  /**
   * 束レベル固定費(足場搬入・車両・班日)の配分。
   * equal: 軒数で等分(招待状の「1 軒 19 万円」に一致)。
   * panels: パネル枚数比で配分(大きな設備ほど多く負担)。
   */
  sharedCostAllocation?: 'equal' | 'panels';
}

/** 束(1 軒以上)の見積。 */
export function quoteBundle(members: readonly BundleMember[], site: SiteContext, rt: RateTable, options: QuoteOptions = {}): BundleQuote {
  if (members.length === 0) throw new Error('quoteBundle: empty bundle');
  const allocation = options.sharedCostAllocation ?? 'equal';
  const n = members.length;
  const ids = new Set(members.map((m) => m.building.id));
  const relocated = relocationEligible(ids, site.adjacency, rt.scaffold.relocationMaxGapMeters);

  const panels = members.map((m) => panelsFor(m.installation.capacityKw, rt));
  const totalPanels = panels.reduce((s, p) => s + p, 0);
  const vehicle = planVehicles(totalPanels, site.vehicleClass, rt);
  const crewDays = crewDaysFor(n, rt);

  // 束レベル固定費
  const sharedScaffold = rt.scaffold.mobilizationPerSite;
  const sharedVehicle = vehicle.trucks * rt.vehicle.dayCost[vehicle.vehicleClass];
  const sharedTransport = vehicle.trucks * rt.disposal.transportPerTrip;
  const sharedCrew = crewDays * rt.labor.crewMobilizationPerDay;

  const share = (i: number) => (allocation === 'panels' ? panels[i]! / totalPanels : 1 / n);

  const perHouse: HouseBreakdown[] = members.map((m, i) => {
    const wall = wallAreaSqm(m.building, rt.scaffold.storeyHeightMeters);
    const isRelocated = relocated.has(m.building.id);
    const setup = Math.max(rt.scaffold.minimumPerHouse, wall * rt.scaffold.perWallSqm) * (isRelocated ? rt.scaffold.relocationFactor : 1);
    const scaffold = setup + sharedScaffold * share(i);
    const vehicleCost = sharedVehicle * share(i);
    const disposal = panels[i]! * rt.disposal.perPanel + sharedTransport * share(i);
    const electrical = rt.labor.electricalPerHouse;
    const removal = panels[i]! * rt.labor.removalPerPanel;
    const roofRepair = rt.labor.roofRepairPerHouse;
    const crew = sharedCrew * share(i);
    const total = scaffold + vehicleCost + disposal + electrical + removal + roofRepair + crew;
    return {
      buildingId: m.building.id,
      panels: panels[i]!,
      wallAreaSqm: round(wall, 1),
      scaffoldRelocated: isRelocated,
      scaffold: round0(scaffold),
      vehicle: round0(vehicleCost),
      disposal: round0(disposal),
      electrical: round0(electrical),
      removal: round0(removal),
      roofRepair: round0(roofRepair),
      crew: round0(crew),
      total: round0(total),
    };
  });

  const byCategory = {
    scaffold: sum(perHouse, 'scaffold'),
    vehicle: sum(perHouse, 'vehicle'),
    disposal: sum(perHouse, 'disposal'),
    electrical: sum(perHouse, 'electrical'),
    removal: sum(perHouse, 'removal'),
    roofRepair: sum(perHouse, 'roofRepair'),
    crew: sum(perHouse, 'crew'),
  };
  const bundleTotal = sum(perHouse, 'total');
  return {
    size: n,
    vehicleClass: vehicle.vehicleClass,
    trucks: vehicle.trucks,
    crewDays,
    relocatedHouses: relocated.size,
    totalPanels,
    bundleTotal,
    perHouseAverage: Math.round(bundleTotal / n),
    perHouse,
    byCategory,
  };
}

export interface StaircaseOptions extends QuoteOptions {
  /** 何軒まで計算するか(既定: 候補全軒)。 */
  maxSize?: number;
  /**
   * 束に入れる順。既定は「自分の家から近い順」(招待状を配る順と一致)。
   */
  order?: readonly string[];
}

/**
 * 段差価格: n = 1..N について、候補を order の順に n 軒入れた束の 1 軒あたり平均を並べる。
 * order の先頭は必ず「自分の家」。
 */
export function buildStaircase(candidates: readonly BundleMember[], site: SiteContext, rt: RateTable, options: StaircaseOptions = {}): Staircase {
  if (candidates.length === 0) throw new Error('buildStaircase: no candidates');
  const byId = new Map(candidates.map((c) => [c.building.id, c]));
  const order = options.order ?? nearestFirstOrder(candidates);
  const ordered = order.map((id) => byId.get(id)).filter((c): c is BundleMember => c !== undefined);
  const maxSize = Math.min(options.maxSize ?? ordered.length, ordered.length);
  const steps: StaircaseStep[] = [];
  let prev: BundleQuote | undefined;
  let single = 0;
  for (let n = 1; n <= maxSize; n++) {
    const q = quoteBundle(ordered.slice(0, n), site, rt, options);
    if (n === 1) single = q.perHouseAverage;
    steps.push({
      size: n,
      perHouseAverage: q.perHouseAverage,
      trucks: q.trucks,
      crewDays: q.crewDays,
      deltaFromPrevious: prev ? q.perHouseAverage - prev.perHouseAverage : 0,
      truckAdded: prev ? q.trucks > prev.trucks : false,
      savingsRate: single > 0 ? round((single - q.perHouseAverage) / single, 4) : 0,
    });
    prev = q;
  }
  const best = steps.reduce((b, s) => (s.perHouseAverage < b.perHouseAverage ? s : b), steps[0]!);
  return { rateTableId: rt.id, vehicleClass: site.vehicleClass, singlePrice: single, steps, best };
}

/** 先頭の家から近い順(重心距離)。 */
export function nearestFirstOrder(candidates: readonly BundleMember[]): string[] {
  const first = candidates[0]!;
  const rest = candidates.slice(1);
  const d = (b: Building) => {
    const dx = (b.centroid[0] - first.building.centroid[0]) * Math.cos((first.building.centroid[1] * Math.PI) / 180);
    const dy = b.centroid[1] - first.building.centroid[1];
    return dx * dx + dy * dy;
  };
  rest.sort((a, b) => d(a.building) - d(b.building) || a.building.id.localeCompare(b.building.id));
  return [first.building.id, ...rest.map((r) => r.building.id)];
}

/** 束候補から SiteContext を作る補助(車格判定は vehicle.ts の decideBundleVehicle を使う)。 */
export function siteContext(vehicleClass: VehicleClass, vehicleReason: string, adjacency: AdjacencyGraph): SiteContext {
  return { vehicleClass, vehicleReason, adjacency };
}

function sum(rows: readonly HouseBreakdown[], key: keyof HouseBreakdown): number {
  let s = 0;
  for (const r of rows) s += r[key] as number;
  return Math.round(s);
}
function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
function round0(v: number): number {
  return Math.round(v);
}
