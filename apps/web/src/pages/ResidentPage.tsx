import { useEffect, useMemo, useState } from 'react';
import type { YearCluster } from '@ashiba/engine';
import { api, clusterLabel, type FeatureCollection, type GeocodeHit } from '../lib/api';
import { CityMap } from '../components/CityMap';
import { QuoteStep } from './steps/QuoteStep';

export function ResidentPage() {
  const [buildings, setBuildings] = useState<FeatureCollection | null>(null);
  const [roads, setRoads] = useState<FeatureCollection | null>(null);
  const [bounds, setBounds] = useState<[number, number, number, number] | undefined>();
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState('例: 千葉市美浜区真砂三丁目A-3');
  const [attribution, setAttribution] = useState<string | undefined>();
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [selected, setSelected] = useState<GeocodeHit | null>(null);
  const [installYear, setInstallYear] = useState(2013);
  const [capacityKw, setCapacityKw] = useState(4);
  const [clusters, setClusters] = useState<YearCluster[] | null>(null);
  const [chosenCluster, setChosenCluster] = useState<YearCluster | null>(null);
  const [flyTo, setFlyTo] = useState<[number, number] | null>(null);
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);

  useEffect(() => {
    api.dataset().then((d) => {
      setBounds(d.bounds);
      setAttribution(typeof d.meta['attribution'] === 'string' ? (d.meta['attribution'] as string) : undefined);
      if (d.hasAddresses === false) setPlaceholder('このデータに住所は入っていません。地図の家をクリックしてください');
      else if (String(d.source).includes('masago')) setQuery('千葉市美浜区真砂三丁目A-3');
    }).catch(() => undefined);
    api.buildingsGeoJSON().then(setBuildings).catch(console.error);
    api.roadsGeoJSON().then(setRoads).catch(console.error);
  }, []);

  async function search() {
    const r = await api.geocode(query);
    setHits(r.hits);
    if (r.hits.length === 1) choose(r.hits[0]!);
  }

  function choose(h: GeocodeHit) {
    setSelected(h);
    setHits([]);
    setFlyTo(h.centroid);
    setClusters(null);
    setChosenCluster(null);
  }

  async function findClusters() {
    if (!selected) return;
    const r = await api.clustersNear(installYear, selected.centroid[0], selected.centroid[1], selected.id);
    setClusters(r.clusters);
    setChosenCluster(r.clusters[0] ?? null);
  }

  const candidateIds = useMemo(() => chosenCluster?.buildingIds ?? [], [chosenCluster]);

  return (
    <div className="layout">
      <aside className="panel">
        <section className={`step ${selected ? 'done' : 'active'}`}>
          <h2><span className="n">1</span>ご自宅の住所</h2>
          <p className="muted">住所を入れると、ご自宅が 3D の街並みの中に立ちます。</p>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder={placeholder} />
          <div className="row">
            <button onClick={search}>この住所で探す</button>
            <span className="note">地図の家を直接クリックしても選べます</span>
          </div>
          {hits.length > 1 && (
            <ul className="hits">
              {hits.map((h) => (
                <li key={h.id}><button onClick={() => choose(h)}>{h.address ?? h.id}</button></li>
              ))}
            </ul>
          )}
          {selected && <p>選択中: <strong>{selected.address ?? selected.id}</strong></p>}
        </section>

        <section className={`step ${!selected ? '' : clusters ? 'done' : 'active'}`}>
          <h2><span className="n">2</span>太陽光パネルの設置年</h2>
          <p className="muted">同じ時期に分譲された街区から、寿命の窓が重なりうる候補を街区単位で集計します(個別の家のパネル有無は、本人が登録するまで表示しません)。</p>
          <label>設置年(西暦)</label>
          <input type="number" min={2000} max={2026} value={installYear} onChange={(e) => setInstallYear(Number(e.target.value))} disabled={!selected} />
          <label>設備容量(kW・わからなければ 4)</label>
          <input type="number" min={1} max={20} step={0.5} value={capacityKw} onChange={(e) => setCapacityKw(Number(e.target.value))} disabled={!selected} />
          <div className="row">
            <button onClick={findClusters} disabled={!selected}>ご近所の候補を探す</button>
          </div>
          {clusters && clusters.length === 0 && <p className="note">近くに同時期の街区が見つかりませんでした。設置年を ±3 年で試してください。</p>}
          {clusters && clusters.length > 0 && (
            <div className="row">
              {clusters.map((c) => (
                <button key={c.id} className={c.id === chosenCluster?.id ? 'accent' : 'secondary'} onClick={() => setChosenCluster(c)}>
                  {c.basis === 'geometry' ? '同時期分譲の疑い(推定)' : `${c.medianYear}年ごろの街区`}・候補 {c.candidateCount} 軒
                </button>
              ))}
            </div>
          )}
          {chosenCluster && chosenCluster.basis === 'geometry' && (
            <p className="note">この都市の 3D 都市モデルには築年が入っていないため、同じ規模の家が等間隔に並ぶ列を「同時期分譲の疑い」として形状から推定しています({clusterLabel(chosenCluster)})。</p>
          )}
          {chosenCluster && (
            <p className="badge" style={{ marginTop: 12 }}>
              <span>同時期の屋根・候補あと</span>
              <strong>{Math.max(0, chosenCluster.candidateCount - registeredIds.length - 1)} 軒</strong>
              <span className="pill">推定・概算</span>
            </p>
          )}
        </section>

        {selected && chosenCluster && (
          <QuoteStep
            buildingId={selected.id}
            address={selected.address}
            cluster={chosenCluster}
            installYear={installYear}
            capacityKw={capacityKw}
            registeredIds={registeredIds}
            onRegistered={setRegisteredIds}
          />
        )}
      </aside>
      <main className="stage">
        <CityMap
          buildings={buildings}
          roads={roads}
          bounds={bounds}
          selectedId={selected?.id ?? null}
          candidateIds={candidateIds}
          registeredIds={registeredIds}
          flyTo={flyTo}
          attribution={attribution}
          height="calc(100vh - 62px)"
          onSelect={(id, props) => choose({ id, address: (props['address'] as string | null) ?? null, centroid: flyTo ?? [0, 0], method: 'click', score: 1 })}
        />
      </main>
    </div>
  );
}
