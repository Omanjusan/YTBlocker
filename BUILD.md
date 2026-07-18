# ビルド手順

## 環境

- Node.js v20.20.2（LTSであれば可）
- npm 11.18.0
- 動作確認はLinux上で実施

## 手順

```bash
npm install
npm run build
```

`src/*.ts` が esbuild によって `dist/*.js` にバンドルされます。
`dist/` の内容と `manifest.json` 等を合わせたものが配布用パッケージです。

配布用zipの再現は:

```bash
npm run package
```

`webext-package.js` のホワイトリストに列挙されたファイルのみをステージングし、
`web-ext build` で `web-ext-artifacts/` にzipを生成します。

## Build instructions (English)

Environment: Node.js v20.20.2 / npm 11.18.0 (any Node LTS works), tested on Linux.

```bash
npm install
npm run build      # esbuild bundles src/*.ts into dist/*.js (with sourcemaps)
npm run package    # reproduces the distributed zip in web-ext-artifacts/
```

The distributed package contains only the files whitelisted in `webext-package.js`
(manifest.json, options.html, dist/, _locales/, LICENSE).
