import type { Building, BundleMember, BundleQuote, LeadSpec, RateTable, SiteContext, YearCluster } from './types.js';
import { planRoute } from './route.js';

export interface LeadInput {
  bundleId: string;
  cluster: Pick<YearCluster, 'id'>;
  week: string;
  members: readonly BundleMember[];
  quote: BundleQuote;
  site: SiteContext;
  rt: RateTable;
  /** 巡回の起点(街区の入口に最も近い家)。未指定なら先頭。 */
  startBuildingId?: string;
}

/** 事業者への発注仕様。 */
export function buildLeadSpec(input: LeadInput): LeadSpec {
  const { members, quote, rt } = input;
  const byId = new Map(quote.perHouse.map((h) => [h.buildingId, h]));
  const route = planRoute(
    members.map((m) => ({ id: m.building.id, position: m.building.centroid })),
    input.startBuildingId,
  );
  const notes: string[] = [input.site.vehicleReason];
  const sloped = members.filter((m) => (m.building.groundSlopePercent ?? 0) >= rt.vehicle.slopePercentDowngrade);
  if (sloped.length > 0) notes.push(`斜面地の軒 ${sloped.length} 件(勾配 ${Math.max(...sloped.map((m) => m.building.groundSlopePercent ?? 0)).toFixed(0)}% まで): 搬出経路と足場の根がらみを現地確認`);
  const flooded = members.filter((m) => (m.building.floodDepth ?? 0) > 0);
  if (flooded.length > 0) notes.push(`浸水想定区域の軒 ${flooded.length} 件(想定浸水深 最大 ${Math.max(...flooded.map((m) => m.building.floodDepth ?? 0)).toFixed(1)} m): 放置時の感電リスクが高いため優先施工を推奨`);
  const threeStorey = members.filter((m) => (m.building.storeysAboveGround ?? 2) >= 3);
  if (threeStorey.length > 0) notes.push(`3 階建て ${threeStorey.length} 軒: 足場の架払い規模が大きい`);
  notes.push(`連棟移設が効く軒 ${quote.relocatedHouses} / ${members.length}`);

  return {
    bundleId: input.bundleId,
    clusterId: input.cluster.id,
    week: input.week,
    vehicleClass: quote.vehicleClass,
    members: members.map((m) => {
      const h = byId.get(m.building.id);
      return {
        buildingId: m.building.id,
        address: m.building.address,
        panels: h?.panels ?? 0,
        storeys: m.building.storeysAboveGround,
        wallAreaSqm: h?.wallAreaSqm ?? 0,
        scaffoldRelocated: h?.scaffoldRelocated ?? false,
      };
    }),
    quote,
    leadValue: Math.round(quote.bundleTotal * rt.leadFeeRate),
    route: route.order,
    notes,
  };
}

export function memberOf(building: Building, installYear: number, capacityKw?: number): BundleMember {
  return { building, installation: { buildingId: building.id, installYear, capacityKw } };
}
