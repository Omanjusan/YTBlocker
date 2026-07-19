// 使い方: npm run package （dist/ がビルド済みであること前提）
// 本体パッケージ(審査提出物)に実行に不要なファイル(src/*.ts, doc/, release.js等)が
// 混入しないよう、DIST_ZIP_INCLUDESに列挙したファイル/ディレクトリだけを一時ディレクトリへ
// ステージングしてからそこを対象にweb-ext buildする（ホワイトリスト方式）。
// release.js からも同じロジックを呼ぶため、定義はここ1箇所のみ。

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const STAGING_DIR = path.join(ROOT, '.web-ext-staging');

const DIST_ZIP_INCLUDES = [
  'manifest.json',
  'options.html',
  'dist',
  '_locales',
  'LICENSE',
];

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// sourcemapは実行時に読まれず配布物には不要のため、ステージングから除外する
// （dist/内の開発用mapはそのまま残す。欠けることで起きるのはDevToolsデバッグ時の警告のみ）
function removeSourceMaps(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) {
      removeSourceMaps(p);
    } else if (entry.endsWith('.map')) {
      fs.rmSync(p);
    }
  }
}

function buildWebExtPackage() {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });
  for (const item of DIST_ZIP_INCLUDES) {
    copyRecursive(path.join(ROOT, item), path.join(STAGING_DIR, item));
  }
  removeSourceMaps(STAGING_DIR);

  try {
    execFileSync(
      'npx',
      ['web-ext', 'build', `--source-dir=${STAGING_DIR}`, '--artifacts-dir=web-ext-artifacts', '--overwrite-dest'],
      { cwd: ROOT, stdio: 'inherit' },
    );
  } finally {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
}

if (require.main === module) {
  buildWebExtPackage();
} else {
  module.exports = { buildWebExtPackage, DIST_ZIP_INCLUDES };
}
