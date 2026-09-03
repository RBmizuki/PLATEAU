import type { Staircase } from '@ashiba/engine';

export interface StaircaseChartProps {
  staircase: Staircase;
  currentSize: number;
  thresholdSize: number;
  width?: number;
  height?: number;
}

const yen = (v: number) => `${(v / 10_000).toFixed(1)}万円`;

/**
 * 段差価格の階段。横軸 = 束の軒数、縦軸 = 1 軒あたり。
 * 車両が 1 台増えて価格が戻る段には印を付ける。
 */
export function StaircaseChart({ staircase, currentSize, thresholdSize, width = 440, height = 220 }: StaircaseChartProps) {
  const steps = staircase.steps;
  const pad = { l: 56, r: 12, t: 18, b: 30 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(...steps.map((s) => s.perHouseAverage));
  const min = Math.min(...steps.map((s) => s.perHouseAverage));
  const y0 = Math.floor((min * 0.85) / 10_000) * 10_000;
  const y1 = Math.ceil((max * 1.05) / 10_000) * 10_000;
  const x = (i: number) => pad.l + (i / steps.length) * w;
  const y = (v: number) => pad.t + h - ((v - y0) / (y1 - y0)) * h;
  const bw = w / steps.length;
  const ticks: number[] = [];
  for (let v = y0; v <= y1; v += 50_000) ticks.push(v);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="束のサイズ別の1軒あたり価格" style={{ maxWidth: '100%', height: 'auto' }}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="#e3e8ee" />
          <text x={pad.l - 6} y={y(v) + 4} fontSize={11} textAnchor="end" fill="#52606d">{v / 10_000}万</text>
        </g>
      ))}
      {steps.map((s, i) => {
        const isCurrent = s.size === currentSize;
        const isThreshold = s.size === thresholdSize;
        const fill = isCurrent ? '#d9480f' : s.size < currentSize ? '#e67700' : isThreshold ? '#2b8a3e' : '#c9d3dc';
        return (
          <g key={s.size}>
            <rect x={x(i) + 1} y={y(s.perHouseAverage)} width={Math.max(2, bw - 2)} height={pad.t + h - y(s.perHouseAverage)} fill={fill} rx={2} />
            {s.deltaFromPrevious > 0 && <text x={x(i) + bw / 2} y={y(s.perHouseAverage) - 4} fontSize={11} textAnchor="middle">{s.truckAdded ? '🚚' : s.crewDayAdded ? '👷' : '▲'}</text>}
            {(i === 0 || i === steps.length - 1 || s.size % 4 === 0 || isCurrent || isThreshold) && (
              <text x={x(i) + bw / 2} y={height - pad.b + 14} fontSize={11} textAnchor="middle" fill="#52606d">{s.size}</text>
            )}
          </g>
        );
      })}
      {(() => {
        const t = steps[thresholdSize - 1];
        if (!t) return null;
        return (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={y(t.perHouseAverage)} y2={y(t.perHouseAverage)} stroke="#2b8a3e" strokeDasharray="4 4" />
            <text x={width - pad.r} y={y(t.perHouseAverage) - 4} fontSize={12} textAnchor="end" fill="#2b8a3e">{thresholdSize}軒で {yen(t.perHouseAverage)}</text>
          </g>
        );
      })()}
      <text x={pad.l + w / 2} y={height - 2} fontSize={11} textAnchor="middle" fill="#52606d">束の軒数(🚚 車両が 1 台増えて戻る段 / 👷 班の出動日が増えて戻る段 / ▲ 大きな家が加わって平均が上がる段)</text>
    </svg>
  );
}
