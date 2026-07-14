# ビルド手順

## 環境
- Node.js (LTS)
- npm

## 手順

```
npm install
npm run build
```

`src/*.ts` が esbuild によって `dist/*.js` にバンドルされます。
`dist/` の内容と `manifest.json` 等を合わせたものが配布用パッケージです。
