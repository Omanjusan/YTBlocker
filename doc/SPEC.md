# YTBlocker 外部仕様書

開発者向け。個々の関数のシグネチャ・実装詳細はソース側のJSDocを正とする。ここではJSDocでは表現できない、モジュール構成・依存関係・複数ファイルにまたがる設計判断のみを扱う。

## モジュール構成

```
src/
├── shared/            共通基盤（型・永続化・同期・多言語化・デバッグ）
│   ├── types.ts         ブロックルール・ログ・保存タプル・墓標のデータモデル定義
│   ├── storage.ts       正DB(storage.local)へのアクセスを一元化する層。同期を関知しない
│   ├── sync-protocol.ts デバイス間同期のプロトコル定義（キー命名・deviceId・チャンク分割・容量計算）
│   ├── sender.ts        同期の送信側。正DBの内容をsync上の自デバイス送信箱へ差分反映
│   ├── receiver.ts      同期の受信側。他デバイスの送信箱を正DBへマージ
│   ├── migration.ts     旧保存形式(v1: sync/localチャンク)からの移行
│   ├── i18n.ts          自前の軽量i18n機構（表示言語のリアルタイム切替用）
│   └── debug.ts         DEBUGフラグによるログ出力の一元化
├── content/            YouTubeページに注入されるcontent script
│   ├── blocker.ts       ブロック判定・適用のコア
│   ├── menu-injector.ts  三点メニューへの項目注入UI
│   ├── card-scout.ts     観測モード（未対応カード検出ロガー）
│   ├── toast.ts          ブロック直後の通知トースト
│   └── content.ts        エントリポイント（監視・再適用の統括）
├── options/options.ts   設定ページ（ルール管理・ログ閲覧）
└── background/background.ts  同期エンジンの駆動＋ツールバーアイコンでオプションページを開く
```

依存関係の概略:

```
content.ts ─┬─> blocker.ts ─┬─> shared/storage.ts ─> shared/sync-protocol.ts ─> shared/types.ts
            │               └─> toast.ts ─> shared/storage.ts
            ├─> menu-injector.ts ─> blocker.ts, shared/debug.ts, shared/i18n.ts
            ├─> card-scout.ts ─> blocker.ts
            └─> shared/storage.ts, shared/i18n.ts

options.ts     ──> shared/storage.ts, shared/sync-protocol.ts, shared/types.ts, shared/i18n.ts
background.ts  ──> shared/migration.ts, shared/sender.ts, shared/receiver.ts, shared/storage.ts
sender.ts / receiver.ts / migration.ts ──> shared/storage.ts, shared/sync-protocol.ts
```

---

## デバイス間同期のアーキテクチャ（v1.5.1〜）

### 基本原則

- **正DBは storage.local のみ**。表示・ブロック動作は常にローカルだけを見る。同期層がどんな状態でも「データが消える」「表示が変わる」が起きない
- **storage.sync はデバイスごとの送信箱（アウトボックス）の置き場**。自分のキーは自分だけが書くため、複数デバイスが同じキーを取り合う衝突（last-writer-winsによる一覧全滅）が構造的に起きない
- **キーの消失に意味を持たせない**。削除は墓標（tombstone）の存在だけが意味する。同期層の事故でキーが消えても誤削除が伝搬しない

### storage.sync 上のキー構成

```
ytblocker_out_<deviceId>_<n>   そのデバイスの保有ルールセット（チャンク分割・全体上書き）
ytblocker_tomb_<deviceId>      そのデバイスが削除したルールIDの墓標一覧
```

deviceIdはインストールごとの固定ランダム文字列（storage.localに保存）。

### データフロー（一方通行）

```
UI操作 → 正DB(local) → [background] sender.publish → sync送信箱
sync受信(onChanged) → [background] receiver.pull → 正DB(local) → onChanged(local) → 全UI自動反映
```

- **publish**: 正DBから「あるべき送信箱」を組み立て、現状との差分だけを書く冪等処理。通常送信と、自分のキーが外部要因で壊れた場合の自己修復が同一コード。差分ゼロなら書き込みゼロのためループしない
- **pull**: 他デバイスの全フィードを毎回全量読み直してマージする冪等処理。取りこぼしが構造的に起きない
- 駆動はすべてbackgroundが担う（起動時の追いつき1周、onChangedによるイベント駆動、実行中の再要求は1回に畳む）

### マージ規則（storage.mergeForeign）

- 追加: ローカルに無いIDのみ取り込む。ID衝突・墓標入りID・同内容（対象+一致方法+値）の重複は取り込まない
- 削除: 相手の墓標にあるIDをローカルからも削除。墓標自体も取り込んで他デバイスへ再伝搬させる
- 編集の伝搬: 同一IDのままでは伝わらないため、updateEntryは「旧ID削除（墓標）+新IDで追加」として表現する（createdAt引き継ぎで並び順維持）

### 同期の有効/無効

- フラグ（`ytblocker_sync_enabled`、デバイスローカル）はsender/receiverの稼働可否のみを制御する。データ移送は行わない
- OFF中も正DBは通常運用。OFF→ONはbackgroundがフラグ変更を検知して追いつき同期（pull→publish）を回す
- 設定値（blockShorts等）はデバイスローカルで同期対象外

### 制約・既知の性質

- 同期の実行タイミング（クラウドとの送受信）はFirefox本体のスケジューラ任せで、拡張からは制御・観測できない。拡張にできるのは「syncエリアへの書き込み」と「onChangedによる受信検知」まで
- 墓標はTTL 180日・最大150件で剪定。IDは再利用されないため、期限切れによる復活は同一ルールの手動再登録と区別できず実害がない
- storage.syncの制約: 1アイテム8192byte（安全マージンとして7800byteでチャンク分割）、全体約100KB（容量ゲージはこの使用率を表示）

### 旧形式(v1)からの移行（migration.ts）

v1はルールを `ytblocker_rules_<n>` チャンクとしてsync/localの片側（同期フラグで切替）に保存していた。

- 取り込みはmergeForeign経由で冪等。移行フラグ管理は不要で、失敗しても次回起動時にやり直せる
- localの旧チャンクは取り込み後に削除（このデバイスしか見ないため安全）
- **syncの旧チャンクは削除しない**。旧バージョンのままの他デバイスがまだ読み書きするため凍結で残す（全デバイス更新後の後続バージョンで掃除予定）。移行期間中に旧バージョンデバイスが旧チャンクを更新した場合もonChangedで検知して取り込む

---

## content/content.ts: 起動時の処理フロー

content scriptのエントリポイント。監視・再適用ロジックを統括する（無名の即時実行関数内にリスナー登録一式）。

1. `refresh()` で初回適用
2. `setupMenuInjector` で三点メニュー注入をセットアップ
3. `browser.storage.onChanged` を購読し、正DB(localのみ)のルール/設定変更時に反映。receiverによる他デバイス分のマージもlocalの変更として届くため、この監視だけで完結する
4. `MutationObserver` でDOM変化を監視し、追加ノードに動画カードが含まれる場合のみ即時再適用（無関係なDOM変化での無駄な再描画を回避）。広告枠（`isInsideAdContainer`）のみの変化では反応しない
5. `yt-navigate-finish` イベント（YouTube SPA遷移完了）でも即時再適用 — *現在、MutationObserver単独でSPA遷移時のカード差し替えを検知できるか実地検証中のため一時的にコメントアウト中*
6. 観測モード（`scoutMode`）が有効な場合のみ、要素追加全般を対象に `scoutScan` を即時実行（ブロック適用側は既知カードの追加でしか発火しないが、観測は未知カードを探すのが目的のため別系統）

---

## 既知の注意点（複数ファイルにまたがる設計判断）

- YouTubeのCSSクラス命名には wiz形式（`yt-content-metadata-view-model-wiz__metadata-text`）と camelCase形式（`ytContentMetadataViewModelMetadataText`）の2系統が存在し、版によってどちらが使われるかが異なる。セレクタは両対応で列挙する（`blocker.ts`のセレクタ定義全般に影響）
- 広告枠（`ytd-ad-slot-renderer` 等）内のカードは削除しない。YouTube側の広告完了判定を壊し無限リロードを引き起こすことが実機検証で確認されている（`blocker.ts`の`isInsideAdContainer`、`content.ts`のMutationObserverコールバック双方で考慮）
