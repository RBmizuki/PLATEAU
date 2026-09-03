import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCityGML } from './citygml.js';

/** docs/plateau-data.md §6 の最小サンプルが、パーサでそのまま読めることを保証する(仕様書とコードの同期テスト)。 */
function docSample(): string {
  const md = readFileSync(resolve(__dirname, '../../../docs/plateau-data.md'), 'utf8');
  const start = md.indexOf('## 6.');
  const fence = md.indexOf('```xml', start);
  const end = md.indexOf('\n```', fence + 6);
  return md.slice(fence + '```xml'.length, end).trim();
}

describe('docs/plateau-data.md §6 sample', () => {
  const xml = docSample();
  it('exists and parses into buildings and a road', () => {
    expect(xml.length).toBeGreaterThan(500);
    const r = parseCityGML(xml);
    expect(r.buildings.length).toBeGreaterThanOrEqual(1);
    expect(r.roads.length).toBeGreaterThanOrEqual(1);
    const withYear = r.buildings.find((b) => b.yearOfConstruction !== undefined);
    expect(withYear).toBeDefined();
    expect(withYear!.footprint.length).toBeGreaterThanOrEqual(4);
    expect(withYear!.footprintArea).toBeGreaterThan(10);
    const road = r.roads[0]!;
    expect(road.width !== undefined || road.widthType !== undefined).toBe(true);
  });
});
