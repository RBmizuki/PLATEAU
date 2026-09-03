import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeadSpec, YearCluster } from '@ashiba/engine';
import { api, yen, yenFull, type BundleSummary, type FeatureCollection } from '../lib/api';
import { CityMap } from '../components/CityMap';

const statusLabel: Record<BundleSummary['status'], string> = {
  forming: '募集中',
  threshold_met: '成立(引き渡し可)',
  handed_to_contractor: '引き渡し済み',
  cancelled: '取消',
};

/** 事業者側: 束の密度マップ・巡回計画・発注仕様。 */
export function ContractorPage() {
  const [buildings, setBuildings] = useState<FeatureCollection | null>(null);
  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | undefined>();
  const [clusters, setClusters] = useState<YearCluster[]>([]);
  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [focus, setFocus] = useState<YearCluster | null>(null);
  const [lead, setLead] = useState<{ bundle: BundleSummary; lead: LeadSpec | null } | null>(null);

  const reload = useCallback(async () => {
    const [c, b] = await Promise.all([api.clusters(), api.bundles()]);
    setClusters(c.clusters);
    setBundles(b.bundles);
  }, []);

  useEffect(() => {
    api.dataset().then((d) => setBounds(d.bounds)).catch(() => undefined);
    api.buildingsGeoJSON().then(setBuildings).catch(console.error);
    api.roadsGeoJSON().then(setRoads).catch(console.error);
    void reload();
  }, [reload]);

  const bundlesByCluster = useMemo(() => {
    const m = new Map<string, BundleSummary[]>();
    for (const b of bundles) m.set(b.clusterId, [...(m.get(b.clusterId) ?? []), b]);
    return m;
  }, [bundles]);

  const registeredIds = useMemo(() => bundles.flatMap((b) => b.members.map((m) => m.buildingId)), [bundles]);
  const routeLine = useMemo(() => {
    if (!lead?.lead || !buildings) return null;
    const byId = new Map(buildings.features.map((f) => [String(f.properties['id']), f]));
    const coords = lead.lead.route.map((id) => byId.get(id)).filter(Boolean).map((f) => centroid(f!.geometry.coordinates[0]!));
    return coords.length > 1 ? coords : null;
  }, [lead, buildings]);

  async function openLead(b: BundleSummary) {
    const r = await api.lead(b.id);
    setLead(r);
    const c = clusters.find((x) => x.id === b.clusterId) ?? null;
    setFocus(c);
  }

  async function handover(b: BundleSummary) {
    await api.handover(b.id, 'demo-contractor');
    await reload();
    await openLead(b);
  }

  return (
    <div className="layout">
      <aside className="panel">
        <h2 style={{ marginTop: 0 }}>束の密度マップ</h2>
        <p className="muted">築年クラスタ(同時期分譲の街区)ごとの候補軒数と登録状況。成立した束は発注仕様つきのリードとして受け取れます。</p>
        <ul className="hits">
          {clusters.map((c) => {
            const bs = bundlesByCluster.get(c.id) ?? [];
            const reg = bs.reduce((s, b) => s + b.registered, 0);
            const density = Math.round((reg / c.candidateCount) * 100);
            return (
              <li key={c.id}>
                <button onClick={() => { setFocus(c); setLead(null); }} style={c.id === focus?.id ? { borderColor: 'var(--accent)' } : undefined}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span><strong>{c.id}</strong> <span className="pill">{c.yearMin}〜{c.yearMax}</span></span>
                    <span>{reg}/{c.candidateCount} 軒</span>
                  </div>
                  <div className="density"><div style={{ width: `${density}%` }} /></div>
                  {bs.map((b) => (
                    <div key={b.id} className="row" style={{ marginTop: 6, fontSize: 14 }}>
                      <span className="pill">{b.week}</span>
                      <span>{statusLabel[b.status]} {b.registered}/{b.threshold}</span>
                      <span style={{ marginLeft: 'auto' }}>
                        <button className="secondary" style={{ fontSize: 13, padding: '4px 8px' }} onClick={(e) => { e.stopPropagation(); void openLead(b); }}>発注仕様</button>
                        {b.status === 'threshold_met' && <button className="accent" style={{ fontSize: 13, padding: '4px 8px', marginLeft: 6 }} onClick={(e) => { e.stopPropagation(); void handover(b); }}>リードを受け取る</button>}
                      </span>
                    </div>
                  ))}
                </button>
              </li>
            );
          })}
        </ul>
        {lead?.lead && (
          <section className="step" style={{ marginTop: 14 }}>
            <h2>発注仕様 {lead.bundle.id}</h2>
            <p className="note">{lead.bundle.week} の週 / 車格 {lead.lead.vehicleClass} / 車両 {lead.lead.quote.trucks} 台 / 班日 {lead.lead.quote.crewDays} 日 / パネル {lead.lead.quote.totalPanels} 枚</p>
            <p><strong>束の合計 {yen(lead.lead.quote.bundleTotal)}</strong>(1 軒平均 {yen(lead.lead.quote.perHouseAverage)})・想定リード価値 {yenFull(lead.lead.leadValue)}</p>
            <table className="breakdown">
              <tbody>
                <tr><th>足場</th><td>{yenFull(lead.lead.quote.byCategory.scaffold)}</td></tr>
                <tr><th>車両</th><td>{yenFull(lead.lead.quote.byCategory.vehicle)}</td></tr>
                <tr><th>処分・運搬</th><td>{yenFull(lead.lead.quote.byCategory.disposal)}</td></tr>
                <tr><th>電気工事</th><td>{yenFull(lead.lead.quote.byCategory.electrical)}</td></tr>
                <tr><th>取外し</th><td>{yenFull(lead.lead.quote.byCategory.removal)}</td></tr>
                <tr><th>防水補修</th><td>{yenFull(lead.lead.quote.byCategory.roofRepair)}</td></tr>
                <tr><th>班の出動</th><td>{yenFull(lead.lead.quote.byCategory.crew)}</td></tr>
              </tbody>
            </table>
            <h3 style={{ fontSize: 16 }}>巡回順</h3>
            <ol style={{ paddingLeft: 20, fontSize: 14 }}>
              {lead.lead.route.map((id, i) => {
                const m = lead.lead!.members.find((x) => x.buildingId === id);
                return <li key={id}>{m?.address ?? id} — {m?.panels} 枚{m?.scaffoldRelocated ? '・連棟移設' : ''}{i === 0 ? '(起点)' : ''}</li>;
              })}
            </ol>
            <h3 style={{ fontSize: 16 }}>注意事項</h3>
            <ul style={{ paddingLeft: 20, fontSize: 14 }}>{lead.lead.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <button className="secondary" style={{ fontSize: 14 }} onClick={() => downloadJson(lead.lead!, `${lead.bundle.id}.json`)}>発注仕様を JSON で保存</button>
          </section>
        )}
      </aside>
      <main className="stage">
        <CityMap buildings={buildings} roads={roads} bounds={bounds} candidateIds={focus?.buildingIds ?? []} registeredIds={registeredIds} flyTo={focus?.centroid ?? null} routeLine={routeLine} height="calc(100vh - 62px)" />
      </main>
    </div>
  );
}

function centroid(ring: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  const n = ring.length - 1 || 1;
  for (let i = 0; i < n; i++) {
    x += ring[i]![0]!;
    y += ring[i]![1]!;
  }
  return [x / n, y / n];
}

function downloadJson(obj: unknown, name: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
