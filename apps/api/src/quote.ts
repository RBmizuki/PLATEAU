/**
 * 段差価格エンジンと束ストアの接続。
 */
import {
  buildLeadSpec,
  buildStaircase,
  decideBundleVehicle,
  memberOf,
  quoteBundle,
  DEFAULT_RATE_TABLE,
  type BundleMember,
  type BundleQuote,
  type LeadSpec,
  type RateTable,
  type SiteContext,
  type Staircase,
  type YearCluster,
} from '@ashiba/engine';
import type { Dataset } from './dataset.js';
import type { BundleRecord } from './store.js';

export interface QuoteService {
  rateTable: RateTable;
  siteFor(cluster: YearCluster): SiteContext & { roadWidth?: number };
  /** 住民向け: 自分 + 登録済み + 残りの候補で段差を作る。 */
  staircaseFor(input: { cluster: YearCluster; selfBuildingId: string; installYear: number; capacityKw?: number; registered: readonly BundleMember[]; threshold: number }): ResidentQuote;
  bundleQuote(bundle: BundleRecord): BundleQuote | null;
  lead(bundle: BundleRecord): LeadSpec | null;
}

export interface ResidentQuote {
  rateTableId: string;
  clusterId: string;
  vehicleClass: SiteContext['vehicleClass'];
  vehicleReason: string;
  roadWidth: number | null;
  threshold: number;
  /** 単独価格。 */
  single: number;
  /** いま(自分 + 登録済み)の束サイズと 1 軒あたり。 */
  current: { size: number; perHouseAverage: number; trucks: number };
  /** 閾値に達したときの 1 軒あたり(候補が閾値未満なら候補全軒)。 */
  atThreshold: { size: number; perHouseAverage: number; trucks: number };
  /** 自分の家の内訳(いまの束で)。 */
  mine: BundleQuote['perHouse'][number];
  staircase: Staircase;
  /** 段差の順(自分 → 登録済み(近い順)→ 残りの候補(近い順))。 */
  order: Array<{ buildingId: string; registered: boolean; self: boolean }>;
}

export function createQuoteService(ds: Dataset, rateTable: RateTable = DEFAULT_RATE_TABLE): QuoteService {
  const siteCache = new Map<string, SiteContext & { roadWidth?: number }>();

  function siteFor(cluster: YearCluster): SiteContext & { roadWidth?: number } {
    const cached = siteCache.get(cluster.id);
    if (cached) return cached;
    const buildings = cluster.buildingIds.map((id) => ds.buildingById.get(id)!).filter(Boolean);
    const v = decideBundleVehicle(buildings, ds.roads, rateTable);
    const site = { vehicleClass: v.vehicleClass, vehicleReason: v.reason, adjacency: ds.adjacency, roadWidth: v.roadWidth };
    siteCache.set(cluster.id, site);
    return site;
  }

  function membersOf(bundle: BundleRecord): BundleMember[] {
    return bundle.members
      .map((m) => {
        const b = ds.buildingById.get(m.buildingId);
        return b ? memberOf(b, m.installYear, m.capacityKw) : undefined;
      })
      .filter((m): m is BundleMember => m !== undefined);
  }

  return {
    rateTable,
    siteFor,
    staircaseFor({ cluster, selfBuildingId, installYear, capacityKw, registered, threshold }) {
      const self = ds.buildingById.get(selfBuildingId);
      if (!self) throw new Error(`building ${selfBuildingId} not found`);
      const site = siteFor(cluster);
      const registeredIds = new Set(registered.map((m) => m.building.id));
      registeredIds.delete(selfBuildingId);
      const others = registered.filter((m) => m.building.id !== selfBuildingId);
      const rest = cluster.buildingIds
        .filter((id) => id !== selfBuildingId && !registeredIds.has(id))
        .map((id) => ds.buildingById.get(id)!)
        .map((b) => memberOf(b, b.yearOfConstruction ?? installYear, rateTable.defaultCapacityKw));
      const selfMember = memberOf(self, installYear, capacityKw);
      const candidates = [selfMember, ...nearestFirst(selfMember, others), ...nearestFirst(selfMember, rest)];
      const staircase = buildStaircase(candidates, site, rateTable, { order: candidates.map((c) => c.building.id) });
      const currentSize = 1 + others.length;
      const current = staircase.steps[currentSize - 1]!;
      const thresholdSize = Math.min(threshold, staircase.steps.length);
      const at = staircase.steps[thresholdSize - 1]!;
      const currentQuote = quoteBundle(candidates.slice(0, currentSize), site, rateTable);
      return {
        rateTableId: rateTable.id,
        clusterId: cluster.id,
        vehicleClass: site.vehicleClass,
        vehicleReason: site.vehicleReason,
        roadWidth: site.roadWidth ?? null,
        threshold: thresholdSize,
        single: staircase.singlePrice,
        current: { size: current.size, perHouseAverage: current.perHouseAverage, trucks: current.trucks },
        atThreshold: { size: at.size, perHouseAverage: at.perHouseAverage, trucks: at.trucks },
        mine: currentQuote.perHouse[0]!,
        staircase,
        order: candidates.map((c) => ({ buildingId: c.building.id, registered: registeredIds.has(c.building.id), self: c.building.id === selfBuildingId })),
      };
    },
    bundleQuote(bundle) {
      const cluster = ds.clusterById.get(bundle.clusterId);
      const members = membersOf(bundle);
      if (!cluster || members.length === 0) return null;
      return quoteBundle(members, siteFor(cluster), rateTable);
    },
    lead(bundle) {
      const cluster = ds.clusterById.get(bundle.clusterId);
      const members = membersOf(bundle);
      if (!cluster || members.length === 0) return null;
      const site = siteFor(cluster);
      const quote = quoteBundle(members, site, rateTable);
      return buildLeadSpec({ bundleId: bundle.id, cluster, week: bundle.week, members, quote, site, rt: rateTable });
    },
  };
}

function nearestFirst(from: BundleMember, list: readonly BundleMember[]): BundleMember[] {
  const [lon0, lat0] = from.building.centroid;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const d = (m: BundleMember) => {
    const dx = (m.building.centroid[0] - lon0) * k;
    const dy = m.building.centroid[1] - lat0;
    return dx * dx + dy * dy;
  };
  return [...list].sort((a, b) => d(a) - d(b) || a.building.id.localeCompare(b.building.id));
}
