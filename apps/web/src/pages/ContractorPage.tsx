import { useEffect, useState } from 'react';
import type { YearCluster } from '@ashiba/engine';
import { api, type FeatureCollection } from '../lib/api';
import { CityMap } from '../components/CityMap';

/** 事業者側: 束の密度マップ(登録・成立状況は /api/bundles 接続後に反映)。 */
export function ContractorPage() {
  const [buildings, setBuildings] = useState<FeatureCollection | null>(null);
  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | undefined>();
  const [clusters, setClusters] = useState<YearCluster[]>([]);
  const [focus, setFocus] = useState<YearCluster | null>(null);

  useEffect(() => {
    api.dataset().then((d) => setBounds(d.bounds)).catch(() => undefined);
    api.buildingsGeoJSON().then(setBuildings).catch(console.error);
    api.roadsGeoJSON().then(setRoads).catch(console.error);
    api.clusters().then((r) => setClusters(r.clusters)).catch(console.error);
  }, []);

  return (
    <div className="layout">
      <aside className="panel">
        <h2 style={{ marginTop: 0 }}>束の密度マップ</h2>
        <p className="muted">築年クラスタ(同時期分譲の街区)ごとの候補軒数。登録が閾値に達した束は発注リードとして受け取れます。</p>
        <ul className="hits">
          {clusters.map((c) => (
            <li key={c.id}>
              <button onClick={() => setFocus(c)} style={c.id === focus?.id ? { borderColor: 'var(--accent)' } : undefined}>
                <strong>{c.id}</strong> — {c.medianYear} 年ごろ({c.yearMin}〜{c.yearMax})・候補 {c.candidateCount} 軒
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="stage">
        <CityMap buildings={buildings} roads={roads} bounds={bounds} candidateIds={focus?.buildingIds ?? []} flyTo={focus?.centroid ?? null} height="calc(100vh - 62px)" />
      </main>
    </div>
  );
}
