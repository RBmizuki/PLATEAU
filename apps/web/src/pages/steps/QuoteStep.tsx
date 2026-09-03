import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { YearCluster } from '@ashiba/engine';
import { api, yen, yenFull, type BundleSummary, type QuoteResponse } from '../../lib/api';
import { StaircaseChart } from '../../components/StaircaseChart';

export interface QuoteStepProps {
  buildingId: string;
  address: string | null;
  cluster: YearCluster;
  installYear: number;
  capacityKw: number;
  registeredIds: string[];
  onRegistered: (ids: string[]) => void;
}

const vehicleLabel = { kei: '軽トラック', '2t': '2t車', '4t': '4t車' } as const;

/** ステップ 3〜5: 試算 → 登録 → 招待状。 */
export function QuoteStep(props: QuoteStepProps) {
  const { buildingId, cluster, installYear, capacityKw, onRegistered } = props;
  const [weeks, setWeeks] = useState<string[]>([]);
  const [week, setWeek] = useState<string | undefined>();
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [bundle, setBundle] = useState<BundleSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const q = await api.quote({ clusterId: cluster.id, buildingId, installYear, capacityKw, week });
      setData(q);
      onRegistered(q.registeredIds);
      if (q.bundleId) {
        const b = await api.bundle(q.bundleId);
        setBundle(b.bundle);
        if (!week) setWeek(b.bundle.week);
      } else setBundle(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cluster.id, buildingId, installYear, capacityKw, week, onRegistered]);

  useEffect(() => {
    api.weeks().then((w) => {
      setWeeks(w.weeks);
      setWeek((cur) => cur ?? w.weeks[0]);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const amRegistered = bundle?.members.some((m) => m.buildingId === buildingId) ?? false;

  async function register() {
    setBusy(true);
    try {
      const r = await api.join({ clusterId: cluster.id, week, buildingId, installYear, capacityKw });
      setBundle(r.bundle);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!bundle) return;
    setBusy(true);
    try {
      await api.leave(bundle.id, buildingId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function seedDemo(count: number) {
    setBusy(true);
    try {
      await api.demoSeed({ clusterId: cluster.id, count, week, excludeBuildingId: buildingId });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <section className="step"><h2><span className="n">3</span>いくら安くなるか</h2><p className="note">試算に失敗しました: {error}</p></section>;
  if (!data) return <section className="step active"><h2><span className="n">3</span>いくら安くなるか</h2><p className="muted">計算中…</p></section>;

  const q = data.quote;
  const registeredOthers = q.current.size - 1;
  const remaining = Math.max(0, q.threshold - q.current.size);
  const nextTruckStep = q.staircase.steps.find((s) => s.size > q.threshold && s.truckAdded);

  return (
    <>
      <section className="step active">
        <h2><span className="n">3</span>いくら安くなるか</h2>
        <p className="muted">
          足場の連棟移設・車両の積み合わせ・処分運搬を束ねると、撤去の 1 軒あたりが束のサイズに応じて階段状に下がります。車両が 1 台増える軒数では、正直に少し戻ります。
        </p>
        <div className="quote-bar">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div><div className="note">1 軒だけで降ろすと</div><div className="money" style={{ color: '#52606d' }}>{yen(q.single)}<small>概算</small></div></div>
            <div><div className="note">いま({q.current.size} 軒: あなた + ご近所 {registeredOthers} 軒)</div><div className="money" style={{ color: 'var(--accent)' }}>{yen(q.current.perHouseAverage)}<small>概算</small></div></div>
            <div><div className="note">{q.threshold} 軒そろえば</div><div className="money" style={{ color: 'var(--ok)' }}>{yen(q.atThreshold.perHouseAverage)}<small>概算</small></div></div>
          </div>
        </div>
        <StaircaseChart staircase={q.staircase} currentSize={q.current.size} thresholdSize={q.threshold} />
        <p className="note">
          この街区に入れる車: <strong>{vehicleLabel[q.vehicleClass]}</strong>({q.vehicleReason})。
          {nextTruckStep && <> {nextTruckStep.size} 軒目でトラックが {nextTruckStep.trucks} 台目に増え、1 軒あたり {yen(nextTruckStep.deltaFromPrevious)} 戻ります。</>}
        </p>
        <button className="secondary" onClick={() => setShowBreakdown((v) => !v)} style={{ fontSize: 15, padding: '8px 12px' }}>
          {showBreakdown ? '内訳を閉じる' : 'あなたの家の内訳(なぜ束だと安いか)'}
        </button>
        {showBreakdown && (
          <table className="breakdown">
            <tbody>
              <tr><th>足場{q.mine.scaffoldRelocated ? '(連棟移設あり)' : ''}</th><td>{yenFull(q.mine.scaffold)}</td></tr>
              <tr><th>車両(積み合わせ)</th><td>{yenFull(q.mine.vehicle)}</td></tr>
              <tr><th>処分・運搬({q.mine.panels} 枚)</th><td>{yenFull(q.mine.disposal)}</td></tr>
              <tr><th>電気工事(切離し・パワコン)</th><td>{yenFull(q.mine.electrical)}</td></tr>
              <tr><th>パネル・架台の取外し</th><td>{yenFull(q.mine.removal)}</td></tr>
              <tr><th>架台跡の防水補修</th><td>{yenFull(q.mine.roofRepair)}</td></tr>
              <tr><th>班の出動(段取り)</th><td>{yenFull(q.mine.crew)}</td></tr>
              <tr><th>合計(税抜・概算)</th><td><strong>{yenFull(q.mine.total)}</strong></td></tr>
            </tbody>
          </table>
        )}
      </section>

      <section className={`step ${amRegistered ? 'done' : 'active'}`}>
        <h2><span className="n">4</span>同じ週の共同撤去枠に登録</h2>
        <p className="muted">登録は無料で、契約ではありません。{q.threshold} 軒そろった時点で、地場の撤去・電気工事事業者に一括で見積を依頼します。</p>
        <label>希望の週</label>
        <select value={week ?? ''} onChange={(e) => setWeek(e.target.value)} disabled={amRegistered}>
          {weeks.map((w) => <option key={w} value={w}>{w}(の週)</option>)}
        </select>
        {bundle && (
          <p className="badge" style={{ marginTop: 12 }}>
            <span>この街区の共同撤去、いま</span><strong>{bundle.registered} 軒</strong>
            <span>/ {bundle.threshold} 軒{bundle.status === 'threshold_met' ? '(成立)' : bundle.status === 'handed_to_contractor' ? '(事業者へ引き渡し済み)' : `・あと ${remaining} 軒`}</span>
          </p>
        )}
        <div className="row">
          {!amRegistered ? (
            <button className="accent" onClick={register} disabled={busy}>この週の枠に登録する</button>
          ) : (
            <button className="secondary" onClick={leave} disabled={busy || bundle?.status === 'handed_to_contractor'}>登録を取り消す</button>
          )}
          <span className="note no-print">デモ: <button className="secondary" style={{ fontSize: 13, padding: '4px 8px' }} onClick={() => seedDemo(6)} disabled={busy}>ご近所 6 軒を登録済みにする</button></span>
        </div>
      </section>

      <section className={`step ${amRegistered ? 'active' : ''}`}>
        <h2><span className="n">5</span>ご近所への招待状</h2>
        <p className="muted">「載せるときは一軒ずつ載せた。降ろすのは、ご近所で」。印刷して回覧板やポストに。</p>
        <div className="row">
          {bundle && amRegistered ? (
            <Link to={`/invite/${encodeURIComponent(bundle.id)}?me=${encodeURIComponent(buildingId)}`}><button>招待状を作る(印刷)</button></Link>
          ) : (
            <button disabled>登録すると招待状を作れます</button>
          )}
        </div>
      </section>
    </>
  );
}
