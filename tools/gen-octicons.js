// docs/rewis-v2/assets/octicons/*.svg を読み、src/editor/common/icons.js を生成する。
// 使い方: node tools/gen-octicons.js
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'docs', 'rewis-v2', 'assets', 'octicons');
const outFile = path.join(rootDir, 'src', 'editor', 'common', 'icons.js');

const files = readdirSync(srcDir)
  .filter((name) => name.endsWith('-16.svg'))
  .sort((a, b) => a.localeCompare(b));

const entries = files.map((file) => {
  const name = file.slice(0, -'-16.svg'.length);
  const svg = readFileSync(path.join(srcDir, file), 'utf8');
  const paths = [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) {
    throw new Error(`${file}: <path> が見つかりません`);
  }
  return [name, paths];
});

const lines = entries.map(([name, paths]) => {
  const pathsLiteral = paths.map((d) => JSON.stringify(d)).join(', ');
  return `  ${JSON.stringify(name)}: [${pathsLiteral}]`;
});

const output = `// 自動生成: node tools/gen-octicons.js（docs/rewis-v2/assets/octicons/*.svg から）
// ライセンス: src/editor/common/icons-LICENSE（MIT, github/primer/octicons）
export const ICONS = {
${lines.join(',\n')}
};
`;

writeFileSync(outFile, output);
console.log(`${entries.length} 個のアイコンを ${path.relative(rootDir, outFile)} に書き出しました。`);
