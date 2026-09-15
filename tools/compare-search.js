// 今の検索（legacy-search.js）と新しい検索（shared/route-search.js）を、
// 本番のフィクスチャに出てくる駅のすべての組み合わせ（出発・到着を区別する）で比較する。
// 比べるのは最良の経路の totalDuration と transferCount。結果は tools/out/compare.md に書き出す。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertV1ToV2 } from '../shared/convert-v1-to-v2.js';
import v1Overrides from '../shared/v1-overrides.js';
import { buildModel } from '../shared/model.js';
import { buildSearchGraph, searchRoutes } from '../shared/route-search.js';
import { legacySearch } from './legacy-search.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

function loadV1(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  return parsed && parsed.data ? parsed.data : parsed;
}

function stationName(v1, id) {
  const s = v1.stations.find(x => x.stationId === id);
  return s ? s.stationName : id;
}

function main() {
  const fixturePath = process.argv[2] || join(__dirname, '..', 'tests', 'fixtures', 'v1-latest.json');
  const v1 = loadV1(fixturePath);

  const { network, operations } = convertV1ToV2(v1, v1Overrides);
  const model = buildModel(network, [], operations.masters);
  const graph = buildSearchGraph(model);

  // 区間（segments）に出てくる駅だけを対象にする（どの路線にも属さない駅は除く、D-005）
  const stationIds = Array.from(new Set(
    v1.segments.flatMap(seg => [seg.fromStationId, seg.toStationId])
  ));

  const diffs = [];
  let pairCount = 0;
  let matchCount = 0;
  let bothEmptyCount = 0;
  const t0 = Date.now();

  for (const fromId of stationIds) {
    for (const toId of stationIds) {
      if (fromId === toId) continue;
      pairCount++;

      const legacyRoutes = legacySearch(v1, { fromId, toId, filters: {}, mode: 'balance' });
      const v2Routes = searchRoutes(model, graph, { fromStationId: fromId, toStationId: toId, transferPenalty: 10 });

      const legacy = legacyRoutes[0] || null;
      const v2 = v2Routes[0] || null;

      if (!legacy && !v2) {
        bothEmptyCount++;
        continue;
      }

      const legacyDuration = legacy ? Math.round(legacy.totalDuration) : null;
      const legacyTransfers = legacy ? legacy.transferCount : null;
      const v2Duration = v2 ? v2.totalDuration : null;
      const v2Transfers = v2 ? v2.transferCount : null;

      if (legacy && v2 && legacyDuration === v2Duration && legacyTransfers === v2Transfers) {
        matchCount++;
        continue;
      }

      // balance モード（乗換ペナルティ10秒）でのスコアで比べる。
      // どちらの実装も「所要時間＋乗換回数×penalty」の一番小さい経路を返すはずなので、
      // 生の所要時間だけで比べると「乗換が少ない代わりに時間が長い経路」を誤って(d)に分類してしまう。
      const PENALTY = 10;
      const legacyScore = legacy ? legacyDuration + legacyTransfers * PENALTY : null;
      const v2Score = v2 ? v2Duration + v2Transfers * PENALTY : null;

      let classification = null;
      if (legacy && !v2) {
        classification = 'd'; // 新しい方が経路を見つけられない
      } else if (!legacy && v2) {
        classification = 'a'; // 新しい方が新たに経路を見つけた（v1の不具合の可能性）
      } else if (v2Score < legacyScore) {
        classification = 'a';
      } else if (v2Score > legacyScore) {
        classification = 'd';
      } else {
        classification = 'b'; // スコアは同じで内訳（所要時間・乗換回数）だけ違う → 仕様変更による差の可能性
      }

      diffs.push({
        fromId, toId,
        fromName: stationName(v1, fromId), toName: stationName(v1, toId),
        legacyDuration, legacyTransfers, legacyScore,
        v2Duration, v2Transfers, v2Score,
        classification
      });
    }
  }

  const elapsedMs = Date.now() - t0;
  mkdirSync(OUT_DIR, { recursive: true });

  const byClass = { a: [], b: [], c: [], d: [] };
  diffs.forEach(d => byClass[d.classification].push(d));

  const lines = [];
  lines.push('# 検索結果の比較レポート');
  lines.push('');
  lines.push(`- 対象駅数: ${stationIds.length}`);
  lines.push(`- 組み合わせ数（出発・到着を区別）: ${pairCount}`);
  lines.push(`- 一致: ${matchCount}`);
  lines.push(`- 両方とも経路なし: ${bothEmptyCount}`);
  lines.push(`- 差があった組み合わせ: ${diffs.length}`);
  lines.push(`- 探索にかかった時間: ${elapsedMs}ms`);
  lines.push('');
  lines.push('分類: (a) 新しい方が短い／新たに見つかった　(b) 所要時間は同じで乗換回数が違う（仕様変更の可能性）　(c) 変換のあいまいさによる差（未使用、overridesで直す）　(d) 新しい方が長い／見つからない（要調査）');
  lines.push('');

  ['d', 'a', 'b', 'c'].forEach(cls => {
    const list = byClass[cls];
    lines.push(`## (${cls}) ${list.length}件`);
    lines.push('');
    if (list.length > 0) {
      lines.push('| 出発 | 到着 | legacy: 所要時間/乗換/score | v2: 所要時間/乗換/score |');
      lines.push('|---|---|---|---|');
      list.forEach(d => {
        const legacyCell = d.legacyDuration == null ? 'なし' : `${d.legacyDuration}秒/${d.legacyTransfers}回/${d.legacyScore}`;
        const v2Cell = d.v2Duration == null ? 'なし' : `${d.v2Duration}秒/${d.v2Transfers}回/${d.v2Score}`;
        lines.push(`| ${d.fromName}(${d.fromId}) | ${d.toName}(${d.toId}) | ${legacyCell} | ${v2Cell} |`);
      });
    }
    lines.push('');
  });

  writeFileSync(join(OUT_DIR, 'compare.md'), lines.join('\n') + '\n');

  console.log(`組み合わせ: ${pairCount}件 / 一致: ${matchCount}件 / 両方経路なし: ${bothEmptyCount}件 / 差: ${diffs.length}件（a:${byClass.a.length} b:${byClass.b.length} c:${byClass.c.length} d:${byClass.d.length}）`);
  console.log(`所要時間: ${elapsedMs}ms`);
  console.log(`出力: ${join(OUT_DIR, 'compare.md')}`);
}

main();
