const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ARTIFACTS_DIR = path.join(ROOT, 'web-ext-artifacts');

const SRC_ZIP_EXCLUDES = [
  'node_modules/*',
  'dist/*',
  '.git/*',
  '.claude/*',
  '.env',
  'web-ext-artifacts/*',
  '.amo-upload-uuid',
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
run('npx', ['web-ext', 'build', '--source-dir=.', '--artifacts-dir=web-ext-artifacts', '--overwrite-dest']);

console.log('[3/3] source zip');
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
const srcZipName = `ytblocker-${version}-src.zip`;
const srcZipPath = path.join(ARTIFACTS_DIR, srcZipName);
if (fs.existsSync(srcZipPath)) fs.unlinkSync(srcZipPath);

const zipArgs = ['-r', path.join('web-ext-artifacts', srcZipName), '.'];
for (const pattern of SRC_ZIP_EXCLUDES) {
  zipArgs.push('-x', pattern);
}
run('zip', zipArgs);

console.log(`--- done: web-ext-artifacts/ytblocker-${version}.zip, ${srcZipName} ---`);
