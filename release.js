// 使い方: npm run release
// manifest.jsonのversionを元にビルド→web-ext build→ソースzip作成までを一括実行する
// 出力先: web-ext-artifacts/ytblocker-<version>.zip, ytblocker-<version>-src.zip
// ソースzipはSRC_ZIP_INCLUDESに列挙したファイル/ディレクトリのみを含める（ホワイトリスト方式）

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildWebExtPackage } = require('./webext-package');

const ROOT = __dirname;
const ARTIFACTS_DIR = path.join(ROOT, 'web-ext-artifacts');

const SRC_ZIP_INCLUDES = [
  'src',
  'manifest.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'build.js',
  'options.html',
  'doc',
  'LICENSE',
  'README.md',
  'BUILD.md',
];

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;

console.log(`--- release v${version} ---`);

console.log('[1/3] build');
run('npm', ['run', 'build']);

console.log('[2/3] package (web-ext build)');
buildWebExtPackage();

console.log('[3/3] source zip');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const srcZipName = `ytblocker-${version}-src.zip`;
const srcZipPath = path.join(ARTIFACTS_DIR, srcZipName);
if (fs.existsSync(srcZipPath)) fs.unlinkSync(srcZipPath);

const zipArgs = ['-r', path.join('web-ext-artifacts', srcZipName), ...SRC_ZIP_INCLUDES];
run('zip', zipArgs);

console.log(`--- done: web-ext-artifacts/ytblocker-${version}.zip, ${srcZipName} ---`);
