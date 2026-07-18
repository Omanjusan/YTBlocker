import type { BlockEntry, BlockLog, MatchTarget, MatchType } from './types';

/** browser.storage で使う各設定項目のキー名。文字列の再入力によるタイポを防ぐため一箇所に集約。
 * 例外: 同期フラグ(SYNC_ENABLED_KEY)はarea判定の都合で本ファイル内に、言語設定(LANG_STORAGE_KEY)はi18n.tsに別置き。 */
export const STORAGE_KEYS = {
  rulesPrefix: 'ytblocker_rules_',
  settings: 'ytblocker_settings',
  log: 'ytblocker_log',
  logDisabled: 'ytblocker_log_disabled',
} as const;

const LOG_KEY = STORAGE_KEYS.log;
const LOG_MAX = 50;

/** storage.sync の1アイテムあたり上限(8192byte)に対する安全マージン。ルール1件が収まる上限としても使う。 */
const CHUNK_BYTE_LIMIT = 7800;
export const MAX_ENTRY_BYTES = CHUNK_BYTE_LIMIT;

/** storage.sync 全体の容量上限(約100KB)。ここに対する使用率をUIの容量ゲージに使う。 */
export const SYNC_TOTAL_BUDGET = 102400;

/** id/createdAtは値の長さに依らずほぼ一定サイズなので、バイト見積もり用にダミー値を固定で使う。
 * idはgenerateIdの実形式と同じ13桁のDate.now()+ハイフン+乱数7文字に合わせる。 */
const DUMMY_ID = '0000000000000-0000000';
const DUMMY_CREATED_AT = 1700000000000;

/** ルール1件の保存形式。オブジェクトではなくタプルにしてキー名分のバイトを節約する。 [id, code, value, createdAt] */
type StoredEntry = [string, number, string, number];

/** ルール本体とは別枠で1キーにまとめて保存する設定項目。 */
interface Settings {
  blockShorts: boolean;
  scoutMode: boolean;
}

/** 未保存時に使う設定の初期値。 */
const DEFAULT_SETTINGS: Settings = { blockShorts: false, scoutMode: false };

/** 同期無効化フラグ。sync/localどちらを見るかの判定材料になるため、常にlocalに置く。 */
const SYNC_ENABLED_KEY = 'ytblocker_sync_enabled';

/** ルール/設定の同期(storage.sync使用)が有効かどうか。デフォルトは有効。 */
export async function isSyncEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(SYNC_ENABLED_KEY);
  return (result[SYNC_ENABLED_KEY] as boolean | undefined) ?? true;
}

/** 同期無効化フラグを直接書き換える。ルール/設定の実データ移行は行わないため、切替には switchSyncArea を使う。 */
export async function setSyncEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SYNC_ENABLED_KEY]: enabled });
}

/** 現在使うstorage area。isSyncEnabled()の値に応じてsync/localを切替。 */
async function getArea(): Promise<browser.storage.StorageArea> {
  return (await isSyncEnabled()) ? browser.storage.sync : browser.storage.local;
}

/** onChangedのareaNameが、現在アクティブなarea(getAreaと同じ判定)と一致するか。 */
export async function isActiveArea(areaName: string): Promise<boolean> {
  return areaName === ((await isSyncEnabled()) ? 'sync' : 'local');
}

/**
 * 同期の有効/無効を切り替える。切替前に、ルール/設定を現在のareaから新しいareaへコピーしたうえで
 * 元areaから削除する(往復してもデータが消えないように)。コピー成功後にフラグを更新するため、
 * 途中でコピーが失敗した場合は元areaにデータが残ったまま(フラグも未変更)になる。
 */
export async function switchSyncArea(enabled: boolean): Promise<void> {
  const current = await isSyncEnabled();
  if (current === enabled) return;

  const from = current ? browser.storage.sync : browser.storage.local;
  const to = enabled ? browser.storage.sync : browser.storage.local;

  const all = await from.get(null);
  const migratedKeys = Object.keys(all).filter(isRuleOrSettingsKey);

  if (migratedKeys.length > 0) {
    const payload = Object.fromEntries(migratedKeys.map((k) => [k, all[k]]));
    await to.set(payload);
    await from.remove(migratedKeys);
  }

  await setSyncEnabled(enabled);
}

const encoder = new TextEncoder();

/** JSONシリアライズ後のUTF-8実バイト数を計算する(日本語は1文字3byteになるため文字数では判定できない)。 */
function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** target(1/2/3)とmatchType(0=exact/1=partial/2=regex)を1つの数値に合成してタプルのフィールド数を減らす。 */
function packTargetMatch(target: MatchTarget, matchType: MatchType): number {
  const targetCode = target === 'video' ? 1 : target === 'channel' ? 2 : 3;
  const matchCode  = matchType === 'exact' ? 0 : matchType === 'partial' ? 1 : 2;
  return targetCode * 10 + matchCode;
}

/** packTargetMatch で合成した数値を target/matchType に戻す。10の位がtargetCode、1の位がmatchCode。 */
function unpackTargetMatch(code: number): { target: MatchTarget; matchType: MatchType } {
  const targetCode = Math.floor(code / 10);
  const matchCode  = code % 10;
  const target: MatchTarget = targetCode === 1 ? 'video' : targetCode === 2 ? 'channel' : 'both';
  const matchType: MatchType = matchCode === 0 ? 'exact' : matchCode === 1 ? 'partial' : 'regex';
  return { target, matchType };
}

/** BlockEntry を保存用タプル(StoredEntry)に変換する。 */
function toStored(entry: BlockEntry): StoredEntry {
  return [entry.id, packTargetMatch(entry.target, entry.matchType), entry.value, entry.createdAt];
}

/** 保存用タプル(StoredEntry)を BlockEntry に戻す。 */
function fromStored(stored: StoredEntry): BlockEntry {
  const [id, code, value, createdAt] = stored;
  return { id, value, createdAt, ...unpackTargetMatch(code) };
}

/** フォーム入力中の target/matchType/value からルール1件の保存バイト数を見積もる(id/createdAtはダミー固定値)。
 * addEntryの単独チャンク判定(byteLength([stored]))と一致するよう、配列で包んだサイズで測る。 */
export function estimateEntryBytes(target: MatchTarget, matchType: MatchType, value: string): number {
  const stored: StoredEntry = [DUMMY_ID, packTargetMatch(target, matchType), value, DUMMY_CREATED_AT];
  return byteLength([stored]);
}

/** storage.sync の1アイテム(キー+値)が消費するバイト数。容量ゲージの算出・差分更新に使う。 */
export function itemByteSize(key: string, value: unknown): number {
  return byteLength(key) + byteLength(value);
}

/** NG登録容量ゲージの集計対象(ルールチャンク+設定)のキーかどうか。ログ・言語設定等の無関係キーを容量に算入しないために使う。 */
export function isRuleOrSettingsKey(key: string): boolean {
  return key.startsWith(STORAGE_KEYS.rulesPrefix) || key === STORAGE_KEYS.settings;
}

/** 現在のarea上でルール+設定が消費しているバイト数を実測する。起動時の初期化用(以降は onChanged の差分で追う想定)。 */
export async function getUsageBytes(): Promise<number> {
  const all = await (await getArea()).get(null);
  return Object.entries(all)
    .filter(([key]) => isRuleOrSettingsKey(key))
    .reduce((sum, [key, value]) => sum + itemByteSize(key, value), 0);
}

/** チャンク番号からstorageキー名を組み立てる(例: index=0 なら "ytblocker_rules_0")。 */
function chunkKey(index: number): string {
  return `${STORAGE_KEYS.rulesPrefix}${index}`;
}

/** ルール1チャンク分。key/indexは同じチャンクキーを指し(index=Number(keyのプレフィックス除去分))、entriesがその中身。 */
interface Chunk {
  key: string;
  index: number;
  entries: StoredEntry[];
}

/** 全ルールチャンクをキー番号順に取得する。 */
async function getAllChunks(): Promise<Chunk[]> {
  const all = await (await getArea()).get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(STORAGE_KEYS.rulesPrefix))
    .map((key) => ({
      key,
      index: Number(key.slice(STORAGE_KEYS.rulesPrefix.length)),
      entries: (all[key] as StoredEntry[] | undefined) ?? [],
    }))
    .sort((a, b) => a.index - b.index);
}

/** 登録済みのブロックルール一覧を取得する。未登録時は空配列。 */
export async function getEntries(): Promise<BlockEntry[]> {
  const chunks = await getAllChunks();
  return chunks.flatMap((c) => c.entries.map(fromStored));
}

/**
 * ブロックルールを1件追加する。
 * 既存チャンクを番号順に見て、追加後もCHUNK_BYTE_LIMIT(7800byte)以内に収まる最初のチャンクへ追記する。
 * どのチャンクにも収まらなければ新しいチャンクキーを作る。
 */
export async function addEntry(entry: BlockEntry): Promise<void> {
  const stored = toStored(entry);
  const chunks = await getAllChunks();

  for (const chunk of chunks) {
    const next = [...chunk.entries, stored];
    if (byteLength(next) <= CHUNK_BYTE_LIMIT) {
      await (await getArea()).set({ [chunk.key]: next });
      return;
    }
  }

  if (byteLength([stored]) > CHUNK_BYTE_LIMIT) {
    throw new Error('ルールが長すぎて保存できません');
  }

  const nextIndex = chunks.length === 0 ? 0 : chunks[chunks.length - 1].index + 1;
  await (await getArea()).set({ [chunkKey(nextIndex)]: [stored] });
}

/** 指定IDのブロックルールを削除する(トーストの「元に戻す」から呼ばれる)。空になったチャンクはキーごと削除する。 */
export async function removeEntry(id: string): Promise<void> {
  const chunks = await getAllChunks();

  for (const chunk of chunks) {
    const next = chunk.entries.filter((e) => e[0] !== id);
    if (next.length === chunk.entries.length) continue;

    if (next.length === 0) {
      await (await getArea()).remove(chunk.key);
    } else {
      await (await getArea()).set({ [chunk.key]: next });
    }
    return;
  }
}

/**
 * 指定IDのブロックルールを部分更新する。該当IDが無ければ何もしない。
 * 更新後も同じチャンクに収まればその場で上書き、収まらなければ
 * 元のチャンクから取り除いたうえで addEntry と同じロジックで空きのあるチャンクへ再配置する。
 */
export async function updateEntry(id: string, patch: Partial<Pick<BlockEntry, 'target' | 'value' | 'matchType'>>): Promise<void> {
  const chunks = await getAllChunks();

  for (const chunk of chunks) {
    const idx = chunk.entries.findIndex((e) => e[0] === id);
    if (idx === -1) continue;

    const patched: BlockEntry = { ...fromStored(chunk.entries[idx]), ...patch };
    const replaced = chunk.entries.map((e, i) => (i === idx ? toStored(patched) : e));

    if (byteLength(replaced) <= CHUNK_BYTE_LIMIT) {
      await (await getArea()).set({ [chunk.key]: replaced });
      return;
    }

    const withoutEntry = chunk.entries.filter((_, i) => i !== idx);
    if (withoutEntry.length === 0) {
      await (await getArea()).remove(chunk.key);
    } else {
      await (await getArea()).set({ [chunk.key]: withoutEntry });
    }
    await addEntry(patched);
    return;
  }
}

/** ブロック履歴ログを新しい順に取得する。 */
export async function getLogs(): Promise<BlockLog[]> {
  const result = await browser.storage.local.get(LOG_KEY);
  return (result[LOG_KEY] as BlockLog[] | undefined) ?? [];
}

/** ブロック履歴ログを追加する。合計件数が LOG_MAX を超えた分は古い順に切り捨てる。ログ無効時は何もしない。 */
export async function addLogs(newEntries: BlockLog[]): Promise<void> {
  if (newEntries.length === 0) return;
  if (await isLogDisabled()) return;
  const logs = await getLogs();
  const combined = [...newEntries, ...logs].slice(0, LOG_MAX);
  await browser.storage.local.set({ [LOG_KEY]: combined });
}

/** ブロック履歴ログを全件削除する。 */
export async function clearLogs(): Promise<void> {
  await browser.storage.local.set({ [LOG_KEY]: [] });
}

/** ブロックログの記録/表示を無効化しているか。パフォーマンス懸念があるユーザー向けの設定。 */
export async function isLogDisabled(): Promise<boolean> {
  const result = await browser.storage.local.get(STORAGE_KEYS.logDisabled);
  return (result[STORAGE_KEYS.logDisabled] as boolean | undefined) ?? false;
}

/** isLogDisabled と対。 */
export async function setLogDisabled(disabled: boolean): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.logDisabled]: disabled });
}

/** 現在のarea(sync/local)からSettingsを読み出す。未保存項目はDEFAULT_SETTINGSで補完する。 */
async function getSettings(): Promise<Settings> {
  const result = await (await getArea()).get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.settings] as Partial<Settings> | undefined) };
}

/** Settingsの一部を現在のareaへ差分反映する(既存値とマージして丸ごと上書き)。 */
async function setSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await (await getArea()).set({ [STORAGE_KEYS.settings]: { ...current, ...patch } });
}

/** ショート動画を一括ブロックする設定が有効かどうかを取得する。 */
export async function getBlockShortsEnabled(): Promise<boolean> {
  return (await getSettings()).blockShorts;
}

/** getBlockShortsEnabled と対。 */
export async function setBlockShortsEnabled(enabled: boolean): Promise<void> {
  await setSettings({ blockShorts: enabled });
}

/** 観測モード(未対応カード検出ログ)が有効かどうかを取得する。 */
export async function getScoutModeEnabled(): Promise<boolean> {
  return (await getSettings()).scoutMode;
}

/** getScoutModeEnabled と対。 */
export async function setScoutModeEnabled(enabled: boolean): Promise<void> {
  await setSettings({ scoutMode: enabled });
}

/** ブロックルール/ログのID用に衝突しにくい一意な文字列を生成する。 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
