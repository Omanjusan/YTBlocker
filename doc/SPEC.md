# YTBlocker 外部仕様書

開発者向け。個々の関数のシグネチャ・実装詳細はソース側のJSDocを正とする。ここではJSDocでは表現できない、モジュール構成・依存関係・複数ファイルにまたがる設計判断のみを扱う。

## モジュール構成

```
src/
├── shared/            共通基盤（型・永続化・多言語化・デバッグ）
│   ├── types.ts         ブロックルール・ログのデータモデル定義
│   ├── storage.ts       browser.storage(sync/local)へのアクセスを一元化する層
│   ├── i18n.ts          自前の軽量i18n機構（表示言語のリアルタイム切替用）
│   └── debug.ts         DEBUGフラグによるログ出力の一元化
├── content/            YouTubeページに注入されるcontent script
│   ├── blocker.ts       ブロック判定・適用のコア
│   ├── menu-injector.ts  三点メニューへの項目注入UI
│   ├── card-scout.ts     観測モード（未対応カード検出ロガー）
│   ├── toast.ts          ブロック直後の通知トースト
│   └── content.ts        エントリポイント（監視・再適用の統括）
├── options/options.ts   設定ページ（ルール管理・ログ閲覧）
└── background/background.ts  ツールバーアイコンのクリックでオプションページを開く
```

依存関係の概略:

```
content.ts ─┬─> blocker.ts ─┬─> shared/storage.ts ─> shared/types.ts
            │               └─> toast.ts ─> shared/storage.ts
            ├─> menu-injector.ts ─> blocker.ts, shared/debug.ts, shared/i18n.ts
            ├─> card-scout.ts ─> blocker.ts
            └─> shared/storage.ts, shared/i18n.ts

options.ts     ──> shared/storage.ts, shared/types.ts, shared/i18n.ts
background.ts  ──> (browser API のみ)
```

---

## content/content.ts: 起動時の処理フロー

content scriptのエントリポイント。監視・再適用ロジックを統括する（無名の即時実行関数内にリスナー登録一式）。

1. `refresh()` で初回適用
2. `setupMenuInjector` で三点メニュー注入をセットアップ
3. `browser.storage.onChanged` を購読し、ルール/設定変更時に反映（アクティブでないarea(sync/local)からの変更は無視）
4. `MutationObserver` でDOM変化を監視し、追加ノードに動画カードが含まれる場合のみ即時再適用（無関係なDOM変化での無駄な再描画を回避）。広告枠（`isInsideAdContainer`）のみの変化では反応しない
5. `yt-navigate-finish` イベント（YouTube SPA遷移完了）でも即時再適用 — *現在、MutationObserver単独でSPA遷移時のカード差し替えを検知できるか実地検証中のため一時的にコメントアウト中*
6. 観測モード（`scoutMode`）が有効な場合のみ、要素追加全般を対象に `scoutScan` を即時実行（ブロック適用側は既知カードの追加でしか発火しないが、観測は未知カードを探すのが目的のため別系統）

---

## 既知の注意点（複数ファイルにまたがる設計判断）

- YouTubeのCSSクラス命名には wiz形式（`yt-content-metadata-view-model-wiz__metadata-text`）と camelCase形式（`ytContentMetadataViewModelMetadataText`）の2系統が存在し、版によってどちらが使われるかが異なる。セレクタは両対応で列挙する（`blocker.ts`のセレクタ定義全般に影響）
- 広告枠（`ytd-ad-slot-renderer` 等）内のカードは削除しない。YouTube側の広告完了判定を壊し無限リロードを引き起こすことが実機検証で確認されている（`blocker.ts`の`isInsideAdContainer`、`content.ts`のMutationObserverコールバック双方で考慮）
