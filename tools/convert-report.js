import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertV1ToV2 } from '../shared/convert-v1-to-v2.js';
import v1Overrides from '../shared/v1-overrides.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

function loadV1(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  return parsed && parsed.data ? parsed.data : parsed;
}

function stationName(network, id) {
  const s = network.stations.find(x => x.id === id);
  return s ? s.name : id;
}

function lineName(network, id) {
  const l = network.lines.find(x => x.id === id);
  return l ? l.name : id;
}

function categoryLabel(network, lineId, categoryId) {
  const l = network.lines.find(x => x.id === lineId);
  const cat = l && l.categories.find(c => c.id === categoryId);
  return cat ? cat.name : categoryId;
}

function serviceSummaryLine(network, sv) {
  const stationNames = sv.stops.map(s => stationName(network, s.stationId));
  const lineParts = sv.sections.map(sec => `${lineName(network, sec.lineId)}/${categoryLabel(network, sec.lineId, sec.categoryId)}`);
  const circularNote = sv.circular ? '（環状）' : '';
  return `- \`${sv.id}\`${circularNote}: ${lineParts.join(' → ')}｜${stationNames.join(' - ')}`;
}

function buildReportMarkdown(network, operations, report) {
  const lines = [];
  lines.push('# 変換レポート');
  lines.push('');
  lines.push('## 件数の一覧');
  lines.push('');
  Object.entries(report.stats).forEach(([key, value]) => {
    lines.push(`- ${key}: ${value}`);
  });
  lines.push('');

  lines.push('## issues');
  lines.push('');
  const byCode = new Map();
  report.issues.forEach(i => {
    if (!byCode.has(i.code)) byCode.set(i.code, []);
    byCode.get(i.code).push(i);
  });
  if (byCode.size === 0) {
    lines.push('（なし）');
  }
  for (const [code, items] of byCode) {
    lines.push(`### ${code}（${items[0].level}, ${items.length}件）`);
    items.forEach(i => lines.push(`- ${i.message}`));
    lines.push('');
  }

  lines.push('## 運行系統ごとの一覧');
  lines.push('');
  network.services.forEach(sv => {
    lines.push(serviceSummaryLine(network, sv));
  });
  lines.push('');

  lines.push('## 路線ごとの運行系統');
  lines.push('');
  network.lines.forEach(line => {
    const svIds = network.services
      .filter(sv => sv.sections.some(sec => sec.lineId === line.id))
      .map(sv => sv.id);
    lines.push(`### ${line.name} (${line.id})`);
    if (svIds.length === 0) {
      lines.push('（走っている運行系統なし）');
    } else {
      svIds.forEach(id => lines.push(`- ${id}`));
    }
    lines.push('');
  });

  return lines.join('\n');
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('使い方: node tools/convert-report.js <v1データのJSONファイル>');
    process.exit(1);
  }
  const v1data = loadV1(inputPath);
  const { network, operations, report } = convertV1ToV2(v1data, v1Overrides);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'network.json'), JSON.stringify(network, null, 2));
  writeFileSync(join(OUT_DIR, 'operations.json'), JSON.stringify(operations, null, 2));
  writeFileSync(join(OUT_DIR, 'report.md'), buildReportMarkdown(network, operations, report));

  console.log(`書き出しました: ${join(OUT_DIR, 'network.json')}`);
  console.log(`書き出しました: ${join(OUT_DIR, 'operations.json')}`);
  console.log(`書き出しました: ${join(OUT_DIR, 'report.md')}`);
}

main();
