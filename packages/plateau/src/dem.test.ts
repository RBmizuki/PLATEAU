import { describe, expect, it } from 'vitest';
import { localProjector, normalizeBuilding } from '@ashiba/engine';
import { DemSampler, applyDem, parseDemTriangles } from './dem.js';

const origin: [number, number] = [140.05, 35.65];
const { toLngLat } = localProjector(origin);
const pos = (x: number, y: number, z: number) => {
  const [lon, lat] = toLngLat([x, y]);
  return `${lat.toFixed(9)} ${lon.toFixed(9)} ${z.toFixed(2)}`;
};

// 東へ 10% で上がる斜面を 2 枚の三角形で覆う(100m × 100m)
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" xmlns:gml="http://www.opengis.net/gml">
  <core:cityObjectMember>
    <dem:ReliefFeature gml:id="dem_1"><dem:lod>1</dem:lod>
      <dem:reliefComponent>
        <dem:TINRelief gml:id="tin_1"><dem:lod>1</dem:lod>
          <dem:tin><gml:TriangulatedSurface><gml:trianglePatches>
            <gml:Triangle><gml:exterior><gml:LinearRing><gml:posList>${pos(0, 0, 5)} ${pos(100, 0, 15)} ${pos(100, 100, 15)} ${pos(0, 0, 5)}</gml:posList></gml:LinearRing></gml:exterior></gml:Triangle>
            <gml:Triangle><gml:exterior><gml:LinearRing><gml:posList>${pos(0, 0, 5)} ${pos(100, 100, 15)} ${pos(0, 100, 5)} ${pos(0, 0, 5)}</gml:posList></gml:LinearRing></gml:exterior></gml:Triangle>
          </gml:trianglePatches></gml:TriangulatedSurface></dem:tin>
        </dem:TINRelief>
      </dem:reliefComponent>
    </dem:ReliefFeature>
  </core:cityObjectMember>
</core:CityModel>`;

describe('dem', () => {
  const tris = parseDemTriangles(XML);
  const sampler = new DemSampler(tris, origin);

  it('parses triangles', () => {
    expect(tris).toHaveLength(2);
  });

  it('samples elevation by barycentric interpolation and slope from the plane', () => {
    const s = sampler.sample(toLngLat([50, 20]))!;
    expect(s.elevation).toBeCloseTo(10, 0);
    expect(s.slopePercent).toBeCloseTo(10, 0);
    expect(sampler.sample(toLngLat([500, 500]))).toBeUndefined();
  });

  it('writes elevation and slope into buildings', () => {
    const b = normalizeBuilding({ id: 'b', footprint: [toLngLat([20, 20]), toLngLat([28, 20]), toLngLat([28, 29]), toLngLat([20, 29])] });
    expect(applyDem([b], sampler)).toBe(1);
    expect(b.groundElevation).toBeCloseTo(7.4, 0);
    expect(b.groundSlopePercent).toBeCloseTo(10, 0);
  });
});
