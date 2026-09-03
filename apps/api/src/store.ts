/**
 * 束(共同撤去枠)の永続化。JSON ファイル 1 枚(小規模デモ向け)。
 * 決済・契約はスコープ外(リード渡しまで)。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BundleStatus } from '@ashiba/engine';

export interface BundleMemberRecord {
  buildingId: string;
  installYear: number;
  capacityKw: number;
  /** 表示名(任意)。個人情報は最小限。 */
  contactName?: string;
  registeredAt: string;
}

export interface BundleRecord {
  id: string;
  clusterId: string;
  /** ISO 週(例: 2026-W47)。同じ週の共同撤去枠。 */
  week: string;
  /** 成立閾値(軒)。 */
  threshold: number;
  status: BundleStatus;
  members: BundleMemberRecord[];
  createdAt: string;
  updatedAt: string;
  handedOverAt?: string;
  contractorId?: string;
}

export interface StoreState {
  bundles: BundleRecord[];
}

export class BundleStore {
  private state: StoreState = { bundles: [] };
  private seq = 0;

  constructor(private readonly file?: string, private readonly now: () => Date = () => new Date()) {
    if (file && existsSync(file)) {
      this.state = JSON.parse(readFileSync(file, 'utf8')) as StoreState;
      this.seq = this.state.bundles.length;
    }
  }

  list(filter: { clusterId?: string; status?: BundleStatus } = {}): BundleRecord[] {
    return this.state.bundles.filter((b) => (!filter.clusterId || b.clusterId === filter.clusterId) && (!filter.status || b.status === filter.status));
  }

  get(id: string): BundleRecord | undefined {
    return this.state.bundles.find((b) => b.id === id);
  }

  /** クラスタ × 週 の枠を取得(無ければ作る)。 */
  openBundle(clusterId: string, week: string, threshold: number): BundleRecord {
    let b = this.state.bundles.find((x) => x.clusterId === clusterId && x.week === week && x.status !== 'cancelled');
    if (b) return b;
    const ts = this.now().toISOString();
    this.seq += 1;
    b = { id: `bundle-${clusterId}-${week}-${this.seq}`, clusterId, week, threshold, status: 'forming', members: [], createdAt: ts, updatedAt: ts };
    this.state.bundles.push(b);
    this.persist();
    return b;
  }

  /** 登録(同じ建物の二重登録は上書き)。閾値到達で status を進める。 */
  join(bundleId: string, member: Omit<BundleMemberRecord, 'registeredAt'>): BundleRecord {
    const b = this.get(bundleId);
    if (!b) throw new Error(`bundle ${bundleId} not found`);
    if (b.status === 'handed_to_contractor' || b.status === 'cancelled') throw new Error(`bundle ${bundleId} is ${b.status}`);
    // 同じ建物が他の枠に入っていたら外す(1 軒 1 枠)
    for (const other of this.state.bundles) {
      if (other.id !== bundleId && other.status === 'forming') {
        const before = other.members.length;
        other.members = other.members.filter((m) => m.buildingId !== member.buildingId);
        if (other.members.length !== before) other.updatedAt = this.now().toISOString();
      }
    }
    const ts = this.now().toISOString();
    const idx = b.members.findIndex((m) => m.buildingId === member.buildingId);
    const rec: BundleMemberRecord = { ...member, registeredAt: idx >= 0 ? b.members[idx]!.registeredAt : ts };
    if (idx >= 0) b.members[idx] = rec;
    else b.members.push(rec);
    b.updatedAt = ts;
    if (b.members.length >= b.threshold && b.status === 'forming') b.status = 'threshold_met';
    this.persist();
    return b;
  }

  leave(bundleId: string, buildingId: string): BundleRecord {
    const b = this.get(bundleId);
    if (!b) throw new Error(`bundle ${bundleId} not found`);
    if (b.status === 'handed_to_contractor') throw new Error('already handed to contractor');
    b.members = b.members.filter((m) => m.buildingId !== buildingId);
    if (b.members.length < b.threshold && b.status === 'threshold_met') b.status = 'forming';
    b.updatedAt = this.now().toISOString();
    this.persist();
    return b;
  }

  handover(bundleId: string, contractorId: string): BundleRecord {
    const b = this.get(bundleId);
    if (!b) throw new Error(`bundle ${bundleId} not found`);
    if (b.status !== 'threshold_met') throw new Error(`bundle ${bundleId} has not met its threshold (${b.members.length}/${b.threshold})`);
    const ts = this.now().toISOString();
    b.status = 'handed_to_contractor';
    b.contractorId = contractorId;
    b.handedOverAt = ts;
    b.updatedAt = ts;
    this.persist();
    return b;
  }

  reset(): void {
    this.state = { bundles: [] };
    this.seq = 0;
    this.persist();
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }
}

/** ISO 週文字列 (YYYY-Www)。 */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 今から n 週先までの候補週(次の月曜始まり)。 */
export function upcomingWeeks(from: Date, count: number, leadWeeks = 3): string[] {
  const out: string[] = [];
  const d = new Date(from);
  d.setDate(d.getDate() + leadWeeks * 7);
  for (let i = 0; i < count; i++) {
    out.push(isoWeek(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
