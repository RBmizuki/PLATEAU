import type { YearCluster } from '@ashiba/engine';

export interface QuoteStepProps {
  buildingId: string;
  address: string | null;
  cluster: YearCluster;
  installYear: number;
  capacityKw: number;
  registeredIds: string[];
  onRegistered: (ids: string[]) => void;
}

/**
 * ステップ 3〜5(試算 → 登録 → 招待状)。
 * 段差価格エンジン(/api/quote, /api/bundles)が入り次第ここに実装する。
 */
export function QuoteStep(props: QuoteStepProps) {
  return (
    <section className="step active">
      <h2><span className="n">3</span>いくら安くなるか</h2>
      <p className="muted">段差価格エンジンを接続中です。街区 {props.cluster.id}(候補 {props.cluster.candidateCount} 軒)に対して、束のサイズ別の 1 軒あたり価格をここに表示します。</p>
      <p className="note">建物 {props.buildingId} / {props.capacityKw} kW / {props.installYear} 年設置</p>
    </section>
  );
}
