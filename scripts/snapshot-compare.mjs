// Refactor verification — diff two snapshot suffixes per page.
// Usage:  node scripts/snapshot-compare.mjs before after-r1
// Returns exit 0 if no differences flagged, exit 1 otherwise.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, '..', 'snapshots');

const PAGES = ['overview', 'geo', 'airisk', 'split'];

function load(slug, suffix) {
  const file = path.join(SNAPSHOT_DIR, `${slug}-${suffix}.json`);
  if (!fs.existsSync(file)) {
    return { missing: true, file };
  }
  return { snapshot: JSON.parse(fs.readFileSync(file, 'utf8')), file };
}

function diffKpis(before, after) {
  const diffs = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];
    if (!b) { diffs.push(`KPI[${i}] added: "${a.label}" = ${a.value}`); continue; }
    if (!a) { diffs.push(`KPI[${i}] removed: "${b.label}" (was ${b.value})`); continue; }
    if (b.label !== a.label)   diffs.push(`KPI[${i}] label: "${b.label}" → "${a.label}"`);
    if (b.value !== a.value)   diffs.push(`KPI[${i}] "${b.label}" value: ${JSON.stringify(b.value)} → ${JSON.stringify(a.value)}`);
    if (b.unit !== a.unit)     diffs.push(`KPI[${i}] "${b.label}" unit: ${JSON.stringify(b.unit)} → ${JSON.stringify(a.unit)}`);
    if (b.delta !== a.delta)   diffs.push(`KPI[${i}] "${b.label}" delta: ${JSON.stringify(b.delta)} → ${JSON.stringify(a.delta)}`);
    if (b.delta2 !== a.delta2) diffs.push(`KPI[${i}] "${b.label}" delta2: ${JSON.stringify(b.delta2)} → ${JSON.stringify(a.delta2)}`);
  }
  return diffs;
}

function diffHook(b, a) {
  const diffs = [];
  if (!b && !a) return diffs;
  if (!b) { diffs.push('hookData: missing in before'); return diffs; }
  if (!a) { diffs.push('hookData: missing in after');  return diffs; }
  if (b.rows      !== a.rows)      diffs.push(`hook.rows: ${b.rows} → ${a.rows}`);
  if (b.uniqueDOs !== a.uniqueDOs) diffs.push(`hook.uniqueDOs: ${b.uniqueDOs} → ${a.uniqueDOs}`);
  const cdB = JSON.stringify(b.channelDistribution);
  const cdA = JSON.stringify(a.channelDistribution);
  if (cdB !== cdA) diffs.push(`hook.channelDistribution: ${cdB} → ${cdA}`);
  const sdB = JSON.stringify(b.splitStatusDistribution);
  const sdA = JSON.stringify(a.splitStatusDistribution);
  if (sdB !== sdA) diffs.push(`hook.splitStatusDistribution: ${sdB} → ${sdA}`);
  return diffs;
}

function diffSections(before, after) {
  const diffs = [];
  const beforeTitles = before.map((s) => s.title);
  const afterTitles  = after.map((s) => s.title);
  for (const t of beforeTitles) {
    if (!afterTitles.includes(t)) diffs.push(`section removed: "${t}"`);
  }
  for (const t of afterTitles) {
    if (!beforeTitles.includes(t)) diffs.push(`section added: "${t}"`);
  }
  return diffs;
}

function diffTables(before, after) {
  const diffs = [];
  const max = Math.max(before.length, after.length);
  for (let i = 0; i < max; i++) {
    const b = before[i];
    const a = after[i];
    if (!b) { diffs.push(`table[${i}] added (rowCount=${a.rowCount})`); continue; }
    if (!a) { diffs.push(`table[${i}] removed (was rowCount=${b.rowCount})`); continue; }
    if (b.rowCount !== a.rowCount) {
      diffs.push(`table[${i}] rowCount: ${b.rowCount} → ${a.rowCount}`);
    }
    if (JSON.stringify(b.headers) !== JSON.stringify(a.headers)) {
      diffs.push(`table[${i}] headers changed`);
    }
    if (JSON.stringify(b.firstRow) !== JSON.stringify(a.firstRow)) {
      diffs.push(`table[${i}] firstRow changed`);
    }
    if (JSON.stringify(b.lastRow) !== JSON.stringify(a.lastRow)) {
      diffs.push(`table[${i}] lastRow changed`);
    }
  }
  return diffs;
}

function main() {
  const [, , beforeSuffix, afterSuffix] = process.argv;
  if (!beforeSuffix || !afterSuffix) {
    console.error('Usage: node scripts/snapshot-compare.mjs <beforeSuffix> <afterSuffix>');
    process.exit(2);
  }

  let totalDiffs = 0;
  for (const slug of PAGES) {
    console.log(`\n=== ${slug.toUpperCase()} (${beforeSuffix} → ${afterSuffix}) ===`);
    const b = load(slug, beforeSuffix);
    const a = load(slug, afterSuffix);
    if (b.missing) { console.log(`  ⚠️  missing: ${b.file}`); totalDiffs++; continue; }
    if (a.missing) { console.log(`  ⚠️  missing: ${a.file}`); totalDiffs++; continue; }

    const allDiffs = [
      ...diffKpis(b.snapshot.kpis, a.snapshot.kpis),
      ...diffHook(b.snapshot.hookData, a.snapshot.hookData),
      ...diffSections(b.snapshot.sections, a.snapshot.sections),
      ...diffTables(b.snapshot.tables, a.snapshot.tables),
    ];

    if (allDiffs.length === 0) {
      console.log('  ✓ no differences');
    } else {
      for (const d of allDiffs) console.log(`  ⚠️  ${d}`);
      totalDiffs += allDiffs.length;
    }

    console.log(
      `  Summary: kpis ${b.snapshot.summary.kpiCount}→${a.snapshot.summary.kpiCount}, ` +
      `sections ${b.snapshot.summary.sectionCount}→${a.snapshot.summary.sectionCount}, ` +
      `tables ${b.snapshot.summary.tableCount}→${a.snapshot.summary.tableCount}, ` +
      `hook ${b.snapshot.summary.hookCaptured ? 'Y' : 'N'}→${a.snapshot.summary.hookCaptured ? 'Y' : 'N'}`
    );
  }

  console.log(`\nTotal differences flagged: ${totalDiffs}`);
  process.exit(totalDiffs === 0 ? 0 : 1);
}

main();
