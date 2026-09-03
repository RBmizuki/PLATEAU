import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, yen, type BundleSummary, type QuoteResponse } from '../lib/api';
import { StaircaseChart } from '../components/StaircaseChart';

/** 印刷用の招待状(A4 1 枚)。 */
export function InvitationPage() {
  const { bundleId = '' } = useParams();
  const [params] = useSearchParams();
  const me = params.get('me') ?? '';
  const [bundle, setBundle] = useState<BundleSummary | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const b = await api.bundle(bundleId);
        setBundle(b.bundle);
        const meMember = b.bundle.members.find((m) => m.buildingId === me) ?? b.bundle.members[0];
        if (meMember) {
          const q = await api.quote({ clusterId: b.bundle.clusterId, buildingId: meMember.buildingId, installYear: meMember.installYear, capacityKw: meMember.capacityKw, week: b.bundle.week });
          setQuote(q);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [bundleId, me]);

  if (error) return <div className="invite"><p>{error}</p></div>;
  if (!bundle || !quote) return <div className="invite"><p>準備中…</p></div>;
  const q = quote.quote;
  const town = bundle.members[0]?.address?.replace(/[A-Z]-\d+$/, '') ?? 'この街区';

  return (
    <div className="invite">
      <div className="no-print row" style={{ marginBottom: 12 }}>
        <Link to="/"><button className="secondary">← 戻る</button></Link>
        <button onClick={() => window.print()}>印刷する</button>
      </div>
      <article className="sheet">
        <p className="kicker">{town} のみなさまへ</p>
        <h1>屋根の太陽光、降ろすのはご近所で。</h1>
        <p className="lead">
          2012〜2015 年ごろに載せた太陽光パネルは、パワコンが先に止まり、「載せ替えるか、降ろすか」の時期に入っています。
          1 軒ずつ降ろすと足場と車両の固定費が大半を食いますが、<strong>同じ週にご近所で束ねる</strong>と、足場の連棟移設と車両の積み合わせで 1 軒あたりが階段状に下がります。
        </p>
        <div className="figures">
          <div><span className="label">1 軒だけで降ろすと</span><span className="value">{yen(q.single)}</span></div>
          <div className="arrow">→</div>
          <div><span className="label">{q.threshold} 軒そろえば</span><span className="value accent">{yen(q.atThreshold.perHouseAverage)}</span></div>
        </div>
        <p className="status">この街区の共同撤去、いま <strong>{bundle.registered} 軒</strong>。{bundle.threshold} 軒そろえば、1 軒 {yen(q.atThreshold.perHouseAverage)}(概算・税抜)。希望の週: <strong>{bundle.week}</strong> の週。</p>
        <StaircaseChart staircase={q.staircase} currentSize={q.current.size} thresholdSize={q.threshold} width={640} height={220} />
        <h2>なぜ束だと安いか</h2>
        <ol>
          <li><strong>足場の連棟移設</strong> — 隣の家との間隔が {`${q.mine.scaffoldRelocated ? '狭い' : '広い'}`}街区では、足場材を隣へ手渡しで移せるため、組立・解体の手間が減ります。</li>
          <li><strong>車両の積み合わせ</strong> — この街区に入れるのは{q.vehicleClass === '4t' ? '4t車' : q.vehicleClass === '2t' ? '2t車' : '軽トラック'}。1 台にまとめて積むほど 1 軒あたりの車両費が下がります(1 台増える軒数では少し戻ります)。</li>
          <li><strong>処分運搬の束</strong> — 処分場への往復とマニフェストを束で 1 回にします。</li>
        </ol>
        <h2>参加のしかた</h2>
        <p>「足場の割り勘」で住所を入れ、パネルの設置年を入力し、<strong>{bundle.week}</strong> の週の枠に登録してください。登録は無料で契約ではありません。{bundle.threshold} 軒そろった時点で、地場の撤去・電気工事事業者に一括見積を依頼します。</p>
        <p className="fine">3D都市モデル(PLATEAU・国土交通省)の建物・道路データから、同じ時期に建った街区と、足場・車両の条件を計算しています。金額はすべて公表相場からの概算で、実際の見積は事業者が現地確認のうえ提示します。個別のお宅のパネルの有無は、ご本人が登録するまで表示しません。</p>
      </article>
    </div>
  );
}
