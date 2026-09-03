#!/usr/bin/env tsx
/**
 * 使い方:
 *   pnpm --filter @ashiba/plateau cli ingest <file.gml|dir> [...] -o out.json [--usage 411,412,413,414]
 *   pnpm --filter @ashiba/plateau cli fixture -o out.json [--citygml out.gml]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCityGML } from './citygml.js';
import { writeCityGML } from './citygml-writer.js';
import { generateFixture } from './fixture.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function listGml(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return [path];
  return readdirSync(path)
    .filter((f) => f.endsWith('.gml'))
    .map((f) => join(path, f));
}

const cmd = process.argv[2];
if (cmd === 'ingest') {
  const out = arg('-o') ?? 'plateau.json';
  const usage = arg('--usage')?.split(',');
  const inputs = process.argv.slice(3).filter((a, i, all) => !a.startsWith('-') && all[i - 1] !== '-o' && all[i - 1] !== '--usage');
  const buildings = [];
  const roads = [];
  const warnings: string[] = [];
  for (const input of inputs) {
    for (const file of listGml(input)) {
      const xml = readFileSync(file, 'utf8');
      const r = parseCityGML(xml, { usageFilter: usage });
      buildings.push(...r.buildings);
      roads.push(...r.roads);
      warnings.push(...r.warnings.map((w) => `${file}: ${w}`));
      console.error(`${file}: ${r.buildings.length} buildings, ${r.roads.length} roads, ${r.warnings.length} warnings`);
    }
  }
  writeFileSync(out, JSON.stringify({ buildings, roads, meta: { source: inputs, warnings: warnings.slice(0, 200) } }));
  console.error(`wrote ${out}: ${buildings.length} buildings, ${roads.length} roads`);
} else if (cmd === 'fixture') {
  const out = arg('-o') ?? 'fixture.json';
  const gml = arg('--citygml');
  const fx = generateFixture();
  writeFileSync(out, JSON.stringify(fx));
  console.error(`wrote ${out}: ${fx.buildings.length} buildings, ${fx.roads.length} roads`);
  if (gml) {
    writeFileSync(gml, writeCityGML(fx.buildings, fx.roads));
    console.error(`wrote ${gml}`);
  }
} else {
  console.error('usage: cli ingest <gml|dir>... -o out.json [--usage 411,412] | cli fixture -o out.json [--citygml out.gml]');
  process.exit(1);
}
