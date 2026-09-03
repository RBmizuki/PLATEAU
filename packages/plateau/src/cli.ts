#!/usr/bin/env tsx
/**
 * 使い方:
 *   pnpm --filter @ashiba/plateau cli ingest <file.gml|dir> [...] -o out.json [--usage 411,412,413,414] [--codelists <dir>]
 *   (--codelists 省略時は入力の親ディレクトリにある codelists/ を自動で探す)
 *   pnpm --filter @ashiba/plateau cli fixture -o out.json [--citygml out.gml]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { coverageStats, parseCityGML } from './citygml.js';
import { parseWidthTypeCodelist } from './codelist.js';
import { writeCityGML } from './citygml-writer.js';
import { generateFixture } from './fixture.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** udx/bldg などの入力から、同じ zip 内の codelists/ を探す。 */
function findCodelists(inputs: string[]): string | undefined {
  for (const input of inputs) {
    let dir = statSync(input).isFile() ? dirname(resolve(input)) : resolve(input);
    for (let i = 0; i < 4; i++) {
      const cand = join(dir, 'codelists');
      if (existsSync(cand)) return cand;
      dir = dirname(dir);
    }
  }
  return undefined;
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
  const inputs = process.argv.slice(3).filter((a, i, all) => !a.startsWith('-') && all[i - 1] !== '-o' && all[i - 1] !== '--usage' && all[i - 1] !== '--codelists');
  const codelistDir = arg('--codelists') ?? findCodelists(inputs);
  let widthTypeMeters: Record<string, number> | undefined;
  if (codelistDir) {
    const f = join(codelistDir, 'RoadStructureAttribute_widthType.xml');
    if (existsSync(f)) {
      const table = parseWidthTypeCodelist(readFileSync(f, 'utf8'));
      widthTypeMeters = Object.fromEntries(Object.values(table).map((t) => [t.code, t.representative]));
      console.error(`widthType codelist: ${Object.values(table).map((t) => `${t.code}=${t.label}→${t.representative}m`).join(', ')}`);
    }
  }
  const buildings = [];
  const roads = [];
  const warnings: string[] = [];
  for (const input of inputs) {
    for (const file of listGml(input)) {
      const xml = readFileSync(file, 'utf8');
      const r = parseCityGML(xml, { usageFilter: usage, widthTypeMeters });
      buildings.push(...r.buildings);
      roads.push(...r.roads);
      warnings.push(...r.warnings.map((w) => `${file}: ${w}`));
      console.error(`${file}: ${r.buildings.length} buildings, ${r.roads.length} roads, ${r.warnings.length} warnings`);
    }
  }
  const coverage = coverageStats(buildings, roads);
  writeFileSync(out, JSON.stringify({ buildings, roads, meta: { source: inputs, codelists: codelistDir ?? null, coverage, warnings: warnings.slice(0, 200) } }));
  console.error(`wrote ${out}: ${buildings.length} buildings, ${roads.length} roads`);
  console.error(`築年充足率 ${(coverage.yearCoverage * 100).toFixed(1)}% (${coverage.withYear}/${coverage.residential} 住宅棟、2010〜2016 年築 ${coverage.fitWindow})`);
  console.error(`幅員の根拠 ${JSON.stringify(coverage.roadWidthSource)}`);
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
