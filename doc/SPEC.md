# YTBlocker 外部仕様書

開発者向け。

## モジュール構成

```
src/
├── shared/            共通基盤（型・永続化・デバッグ）
│   ├── types.ts
│   ├── storage.ts
│   └── debug.ts
├── content/            YouTubeページに注入されるcontent script
│   ├── blocker.ts       ブロック判定・適用のコア
│   ├── menu-injector.ts  三点メニューへの項目注入UI
│   ├── toast.ts          ブロック直後の通知トースト
│   └── content.ts        エントリポイント（監視・再適用の統括）
├── popup/popup.ts       ツールバーアイコンのポップアップ
└── options/options.ts   設定ページ（ルール管理・ログ閲覧）
```

依存関係の概略:

```
content.ts ─┬─> blocker.ts ─┬─> shared/storage.ts ─> shared/types.ts
            │               └─> toast.ts
            └─> menu-injector.ts ─> blocker.ts, shared/debug.ts

popup.ts    ──> shared/storage.ts
options.ts  ──> shared/storage.ts, shared/types.ts
```

---

## shared/types.ts

ブロックルール・ログのデータモデル定義。

| 型 | 定義 | 説明 |
|---|---|---|
| `MatchTarget` | `'video' \| 'channel' \| 'both'` | ブロックルールの適用対象。`both` は動画タイトル・チャンネル名のどちらか一致すればブロック |
| `MatchType` | `'exact' \| 'regex'` | `exact` は完全一致、`regex` は正規表現マッチ（`/pattern/flags` 形式にも対応） |

### `BlockEntry`
ユーザーが登録したブロックルール1件分。

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | `string` | 一意ID |
| `target` | `MatchTarget` | 適用対象 |
| `matchType` | `MatchType` | マッチ方式 |
| `value` | `string` | マッチ対象の文字列（完全一致テキスト or 正規表現パターン） |
| `createdAt` | `number` | 登録日時（UNIXミリ秒） |

### `BlockLog`
実際にブロックが発動した際の履歴1件分（オプションページの「ログ」欄に表示）。

| フィールド | 型 | 説明 |
|---|---|---|
| `videoTitle` | `string` | ブロックされた動画のタイトル |
| `channelName` | `string` | ブロックされた動画のチャンネル名 |
| `matchedValue` | `string` | どのルールにマッチしてブロックされたかを示す値 |
| `blockedAt` | `number` | ブロック発生日時（UNIXミリ秒） |

---

## shared/storage.ts

`browser.storage.local` へのアクセスを一元化する層。

### 定数

- `STORAGE_KEYS`: `browser.storage.local` で使う各設定項目のキー名。文字列の再入力によるタイポを防ぐため一箇所に集約（`list` / `log` / `blockShorts` / `debounceDelay`）
- `DEFAULT_DEBOUNCE_DELAY = 300`: デバウンス遅延のデフォルト値(ms)
- ログは内部で最大50件（`LOG_MAX`）に切り詰め

### 関数

| 関数 | シグネチャ | 説明 |
|---|---|---|
| `getEntries` | `() => Promise<BlockEntry[]>` | 登録済みのブロックルール一覧を取得。未登録時は空配列 |
| `addEntry` | `(entry: BlockEntry) => Promise<void>` | ブロックルールを1件追加 |
| `removeEntry` | `(id: string) => Promise<void>` | 指定IDのブロックルールを削除（トーストの「元に戻す」から呼ばれる） |
| `getLogs` | `() => Promise<BlockLog[]>` | ブロック履歴ログを新しい順に取得 |
| `addLogs` | `(newEntries: BlockLog[]) => Promise<void>` | ログを追加。合計件数がLOG_MAX(50)を超えた分は古い順に切り捨て |
| `clearLogs` | `() => Promise<void>` | ブロック履歴ログを全件削除 |
| `getBlockShortsEnabled` | `() => Promise<boolean>` | ショート動画を一括ブロックする設定が有効かどうかを取得 |
| `setBlockShortsEnabled` | `(enabled: boolean) => Promise<void>` | 上記設定を更新 |
| `getDebounceDelay` | `() => Promise<number>` | DOM監視の再描画をまとめて処理するデバウンス遅延時間(ms)を取得 |
| `setDebounceDelay` | `(ms: number) => Promise<void>` | 上記設定を更新 |
| `generateId` | `() => string` | ブロックルール/ログのID用に衝突しにくい一意な文字列を生成（`${Date.now()}-${random}`形式） |

---

## shared/debug.ts

- `DEBUG` (`boolean`, デフォルト `false`): trueにするとビルド後の拡張機能がdevtoolsコンソールにデバッグログを出力する
- `debugLog(...args: unknown[]): void`: `DEBUG` がtrueのときだけ `[YTBlocker]` プレフィックス付きでログ出力する

---

## content/blocker.ts

ブロック判定・適用のコアロジック。menu-injector から利用される共通基盤。

### `CARD_SELECTOR`
YouTube上の動画カード要素を捕捉するCSSセレクタ（複数バージョンのDOM構造に対応するため以下を列挙し `,` 結合）:
`ytd-rich-item-renderer`, `ytd-video-renderer`, `ytd-compact-video-renderer`, `ytd-grid-video-renderer`, `ytd-reel-item-renderer`, `ytd-shorts-lockup-view-model`（旧）, `ytm-shorts-lockup-view-model-v2`（検索結果ページ用）

### 関数

| 関数 | シグネチャ | 説明 |
|---|---|---|
| `deepQuery` | `(root: Element \| ShadowRoot, selector: string) => Element \| null` | Shadow DOMを再帰的に貫通してquerySelectorする。YouTube新UIはタイトル/チャンネル名がshadow root内にあるため通常のquerySelectorでは届かない |
| `getVideoTitle` | `(card: Element) => string` | 動画カード要素からタイトルを取得。新旧複数のDOM構造に対応するため候補セレクタを順に試すフォールバック方式 |
| `getChannelName` | `(card: Element) => string` | 動画カード要素からチャンネル名を取得。`getVideoTitle`と同様のフォールバック方式 |
| `blockAndLog` | `(card, target, value, title, channel, onAdded) => Promise<void>` | ルール登録・ログ保存・カード除去・トースト表示までを一括実行。menu-injectorから呼ばれる |
| `isShorts` | `(card: Element) => boolean` | カード要素がショート動画かどうかを判定（タグ名 `YTD-REEL-ITEM-RENDERER` または `/shorts/` リンクの有無） |
| `entryMatches` | `(value: string, entry: BlockEntry) => boolean` | valueがentryにマッチするか判定。regexの場合、`/pattern/flags` 形式ならパターン+フラグとして、そうでなければ文字列全体を正規表現として解釈。不正な正規表現はfalse扱い |
| `applyBlockList` | `(entries: BlockEntry[], blockShorts: boolean) => BlockLog[]` | 現在DOM上にある全カードにブロックルールを適用し、マッチしたものを削除。ショート一括ブロックが有効な場合はルールに関わらずショートを先に除去。戻り値は実際にブロックされた項目のログ配列（呼び出し側でstorageに保存） |

---

## content/menu-injector.ts

YouTubeの三点メニュー（`⋮`）にブロック用の項目を動的挿入するUI。

| 関数 | シグネチャ | 説明 |
|---|---|---|
| `reset` | `() => void` | 三点メニュー監視の途中状態（監視中のカード・MutationObserver・タイムアウト）を全て破棄 |
| `createMenuItem` | `(label, onClick) => HTMLElement` | 三点メニュー（`tp-yt-paper-listbox`）に挿入する項目1個分のDOM要素を生成 |
| `injectItems` | `(card, listbox, onAdded) => void` | 開いた三点メニューのlistboxに区切り線とブロック用の項目を追加。既に追加済みなら何もしない |
| `findMenuListbox` | `() => Element \| null` | YouTube側が開いた三点メニューのlistbox要素を探す。DOM構造の版差に応じて複数セレクタを試す |
| `setupMenuInjector` | `(onAdded: OnAdded) => void` | カード内の三点メニューボタンのクリックをdocument全体で捕捉し、メニューが開いたタイミングで動的にブロック用の項目を注入する。メニューは動的生成されるため、クリック後にMutationObserverでlistboxの出現を待ち、**2秒以内に見つからなければ諦めてリセット** |

---

## content/toast.ts

ブロック登録直後に表示する右下トースト通知。

- `DURATION_MS = 5000`: トースト自動消滅までの時間

| 関数 | シグネチャ | 説明 |
|---|---|---|
| `truncate` | `(text: string, max = 10) => string` | 文字列をmax文字で切り詰め、省略した場合は末尾に「…」を付ける |
| `showToast` | `(label: string, entryId: string) => void` | ブロック登録直後に画面右下へ通知トーストを表示。「元に戻す」ボタンで直前の登録を取り消せる。`DURATION_MS`経過で自動的に消える |
| `dismiss`（内部） | `() => void` | トーストをフェードアウトさせつつ削除。二重実行を防ぐガード付き |

---

## content/content.ts

content scriptのエントリポイント。監視・再適用ロジックを統括する（無名の即時実行関数内にリスナー登録一式）。

| 関数 | シグネチャ | 説明 |
|---|---|---|
| `applyAndLog` | `() => void` | 現在のブロックルールをDOMに適用し、ブロックが発生していればログを保存 |
| `refresh` | `() => Promise<void>` | storageからルール/設定を読み直し、ブロック適用をやり直す |

### 起動時の処理フロー

1. `getDebounceDelay()` でデバウンス値を読み込み、`refresh()` で初回適用
2. `browser.storage.onChanged` を購読し、デバウンス値変更・ルール/ショート設定変更時に反映
3. `MutationObserver` でDOM変化を監視し、追加ノードに動画カードが含まれる場合のみ再適用（無関係なDOM変化での無駄な再描画を回避）。連続発火はデバウンスしてまとめて処理
4. `yt-navigate-finish` イベント（YouTube SPA遷移完了）でも即時再適用

---

## popup/popup.ts

ツールバーアイコンのポップアップ。登録済みルール件数の表示とオプションページへの導線のみを担う。

| 処理 | 説明 |
|---|---|
| 件数表示 | ポップアップを開いた時点の登録済みNGエントリ件数を取得し、バッジ表示 |
| 設定ボタン | 「設定」ボタン押下でオプションページを新規タブで開く |

---

## options/options.ts

設定ページ。ルール登録・一覧管理・ログ閲覧・各種設定を行う。関数の直接のTSDocは無いためコードから機能を整理。

### セクション構成

| セクション | 主な関数/処理 | 説明 |
|---|---|---|
| ショート動画設定 | チェックボックス変更ハンドラ | `getBlockShortsEnabled`/`setBlockShortsEnabled` と同期 |
| デバウンス遅延設定 | 入力欄変更ハンドラ | 入力値を100〜1000msにクランプして`setDebounceDelay`保存 |
| リアルタイムマッチ判定 | `updateMatchIndicator()` | サンプル入力欄がパターン欄の正規表現にマッチするかをリアルタイムで判定し、⭕/❌で表示 |
| 登録 | `handleAdd(target: MatchTarget)` | 正規表現入力欄の内容を`matchType: 'regex'`のブロックルールとして登録 |
| ルールリスト描画 | `renderList()`, `targetLabel()`, `targetBadgeClass()` | 登録済みブロックルール一覧を新しい順に描画。行ごとに対象/方式バッジ・削除ボタン付き |
| ログ描画 | `renderLog()`, `formatTime()` | ブロック履歴ログを新しい順に描画。`formatTime`はUNIXミリ秒を`MM/DD HH:mm:ss`形式の日本語ロケール文字列に変換 |
| ストレージ変更同期 | `browser.storage.onChanged` リスナー | 他コンテキスト（content script等）からのルール/ログ変更をリアルタイムに反映 |

---

## 既知の注意点（コードコメントより）

- `blocker.ts` の `CARD_SELECTOR` にある `ytm-shorts-lockup-view-model-v2` は検索結果ページ用の対応漏れを追加で修正したもの
- `menu-injector.ts` の三点メニュー監視は2秒でタイムアウトし諦める設計（YouTube側のメニュー生成が非同期のため）
- `content.ts` のMutationObserverは全体のDOM変化を監視するが、カード関連の変化のみに絞ってから処理する設計（パフォーマンス配慮）
