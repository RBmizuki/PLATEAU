import { useEffect, useRef, useState } from 'react';
import maplibregl, { type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection } from '../lib/api';

export interface CityMapProps {
  buildings: FeatureCollection | null;
  roads: FeatureCollection | null;
  bounds?: [number, number, number, number];
  /** 自分の家(強調)。 */
  selectedId?: string | null;
  /** 束候補の街区(薄く灯す)。 */
  candidateIds?: readonly string[];
  /** 登録済みの家(濃く灯す)。 */
  registeredIds?: readonly string[];
  onSelect?: (id: string, props: Record<string, unknown>) => void;
  flyTo?: [number, number] | null;
  /** 巡回順の折れ線(事業者側)。 */
  routeLine?: [number, number][] | null;
  /** 出典表示(データセットの meta.attribution)。 */
  attribution?: string;
  height?: number | string;
}

/**
 * 外部タイルに依存しない自前スタイル。VITE_BASEMAP_STYLE に地理院ベクトルタイル等の
 * style.json を渡せば下地を差し替えられる(オフライン環境では空の背景で動く)。
 */
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9eef2' } }],
};

const BUILDING_COLOR = [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  '#d9480f',
  ['boolean', ['feature-state', 'registered'], false],
  '#e67700',
  ['boolean', ['feature-state', 'candidate'], false],
  '#f5b342',
  ['==', ['get', 'usage'], '411'],
  '#c9d3dc',
  '#b7c2cc',
] as unknown as maplibregl.ExpressionSpecification;

export function CityMap(props: CityMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const stateIds = useRef<Set<string>>(new Set());
  /** スタイルの load 後に true。isStyleLoaded() は GeoJSON 処理中に false を返すので使わない。 */
  const [ready, setReady] = useState(false);
  const fitted = useRef(false);
  const { buildings, roads, bounds, selectedId, candidateIds, registeredIds, onSelect, flyTo, routeLine, attribution } = props;
  const attributionRef = useRef<maplibregl.AttributionControl | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const style = (import.meta.env['VITE_BASEMAP_STYLE'] as string | undefined) ?? BLANK_STYLE;
    const map = new maplibregl.Map({
      container: container.current,
      style,
      center: [140.0468, 35.6401],
      zoom: 17,
      pitch: 58,
      bearing: -18,
      antialias: true,
      // 撮影・録画(3 分動画)で canvas を確実に取り出せるように保持する
      preserveDrawingBuffer: true,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    const attr = new maplibregl.AttributionControl({ compact: true, customAttribution: '3D都市モデル: PLATEAU(国土交通省)相当の合成データ' });
    map.addControl(attr);
    attributionRef.current = attr;
    mapRef.current = map;
    (window as unknown as { __ashibaMap?: MLMap }).__ashibaMap = map;
    map.on('error', (e) => console.error('maplibre error', e.error?.message ?? e));
    map.on('load', () => setReady(true));
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // データ投入
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !buildings) return;
    {
      if (roads) {
        if (map.getSource('roads')) (map.getSource('roads') as maplibregl.GeoJSONSource).setData(roads as never);
        else {
          map.addSource('roads', { type: 'geojson', data: roads as never });
          map.addLayer({
            id: 'roads-fill',
            type: 'fill',
            source: 'roads',
            paint: { 'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'width'], 4], 3, '#f3d6d6', 4.5, '#dfe6ec', 6, '#cfd8e0'], 'fill-opacity': 0.9 },
          });
          map.addLayer({ id: 'roads-line', type: 'line', source: 'roads', paint: { 'line-color': '#9aa8b5', 'line-width': 0.8 } });
        }
      }
      if (map.getSource('buildings')) (map.getSource('buildings') as maplibregl.GeoJSONSource).setData(buildings as never);
      else {
        map.addSource('buildings', { type: 'geojson', data: buildings as never, promoteId: 'id' });
        map.addLayer({
          id: 'buildings-3d',
          type: 'fill-extrusion',
          source: 'buildings',
          paint: {
            'fill-extrusion-color': BUILDING_COLOR,
            'fill-extrusion-height': ['get', 'height'],
            'fill-extrusion-base': ['get', 'base'],
            'fill-extrusion-opacity': 0.92,
            'fill-extrusion-vertical-gradient': true,
          },
        });
        map.on('click', 'buildings-3d', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const id = String(f.id ?? (f.properties as { id?: string }).id);
          onSelectRef.current?.(id, f.properties as Record<string, unknown>);
        });
        map.on('mouseenter', 'buildings-3d', () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', 'buildings-3d', () => (map.getCanvas().style.cursor = ''));
      }
      if (bounds && !fitted.current) {
        fitted.current = true;
        map.fitBounds([bounds[0], bounds[1], bounds[2], bounds[3]], { padding: 40, pitch: 58, bearing: -18, duration: 0 });
      }
    }
  }, [ready, buildings, roads, bounds]);

  // feature-state で強調表示
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource('buildings')) return;
    for (const id of stateIds.current) map.setFeatureState({ source: 'buildings', id }, { selected: false, candidate: false, registered: false });
    stateIds.current.clear();
    const set = (id: string, patch: Record<string, boolean>) => {
      map.setFeatureState({ source: 'buildings', id }, patch);
      stateIds.current.add(id);
    };
    for (const id of candidateIds ?? []) set(id, { candidate: true });
    for (const id of registeredIds ?? []) set(id, { registered: true });
    if (selectedId) set(selectedId, { selected: true });
  }, [ready, selectedId, candidateIds, registeredIds, buildings]);

  // 出典表示の差し替え
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !attribution) return;
    if (attributionRef.current) map.removeControl(attributionRef.current);
    const attr = new maplibregl.AttributionControl({ compact: true, customAttribution: attribution });
    map.addControl(attr);
    attributionRef.current = attr;
  }, [attribution]);

  // 巡回順
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data = { type: 'FeatureCollection', features: routeLine ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeLine } }] : [] } as never;
    if (map.getSource('route')) (map.getSource('route') as maplibregl.GeoJSONSource).setData(data);
    else {
      map.addSource('route', { type: 'geojson', data });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#1c7ed6', 'line-width': 3, 'line-dasharray': [1.5, 1] } });
    }
  }, [ready, routeLine]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTo) return;
    map.flyTo({ center: flyTo, zoom: 18.5, pitch: 60, bearing: -18, duration: 1200 });
  }, [ready, flyTo]);

  return <div ref={container} className="city-map" style={{ height: props.height ?? 480 }} />;
}
