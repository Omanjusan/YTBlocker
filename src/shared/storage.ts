import type { BlockEntry, BlockLog, MatchTarget, MatchType } from './types';

/** browser.storage で使う各設定項目のキー名。文字列の再入力によるタイポを防ぐため一箇所に集約。 */
export const STORAGE_KEYS = {
  rulesPrefix: 'ytblocker_rules_',
  settings: 'ytblocker_settings',
  log: 'ytblocker_log',
} as const;

const LOG_KEY = STORAGE_KEYS.log;
const LOG_MAX = 50;

/** storage.sync の1アイテムあたり上限(8192byte)に対する安全マージン。ルール1件が収まる上限としても使う。 */
const CHUNK_BYTE_LIMIT = 7800;
export const MAX_ENTRY_BYTES = CHUNK_BYTE_LIMIT;

/** storage.sync 全体の容量上限(約100KB)。ここに対する使用率をUIの容量ゲージに使う。 */
export const SYNC_TOTAL_BUDGET = 102400;

/** id/createdAtは値の長さに依らずほぼ一定サイズなので、バイト見積もり用にダミー値を固定で使う。 */
const DUMMY_ID = '000000000000-0000000';
const DUMMY_CREATED_AT = 1700000000000;

/** ルール1件の保存形式。オブジェクトではなくタプルにしてキー名分のバイトを節約する。 [id, code, value, createdAt] */
type StoredEntry = [string, number, string, number];

interface Settings {
  blockShorts: boolean;
  scoutMode: boolean;
}

const DEFAULT_SETTINGS: Settings = { blockShorts: false, scoutMode: false };

const encoder = new TextEncoder();

/** JSONシリアライズ後のUTF-8実バイト数を計算する(日本語は1文字3byteになるため文字数では判定できない)。 */
function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** target(1/2/3)とmatchType(0=exact/1=regex)を1つの数値に合成してタプルのフィールド数を減らす。 */
function encodeCode(target: MatchTarget, matchType: MatchType): number {
  const targetCode = target === 'video' ? 1 : target === 'channel' ? 2 : 3;
  const matchCode  = matchType === 'exact' ? 0 : 1;
  return targetCode * 10 + matchCode;
}

function decodeCode(code: number): { target: MatchTarget; matchType: MatchType } {
  const targetCode = Math.floor(code / 10);
  const matchCode  = code % 10;
  const target: MatchTarget = targetCode === 1 ? 'video' : targetCode === 2 ? 'channel' : 'both';
  const matchType: MatchType = matchCode === 0 ? 'exact' : 'regex';
  return { target, matchType };
}

function toStored(entry: BlockEntry): StoredEntry {
  return [entry.id, encodeCode(entry.target, entry.matchType), entry.value, entry.createdAt];
}

function fromStored(stored: StoredEntry): BlockEntry {
  const [id, code, value, createdAt] = stored;
  return { id, value, createdAt, ...decodeCode(code) };
}

/** フォーム入力中の target/matchType/value からルール1件の保存バイト数を見積もる(id/createdAtはダミー固定値)。 */
export function estimateEntryBytes(target: MatchTarget, matchType: MatchType, value: string): number {
  const stored: StoredEntry = [DUMMY_ID, encodeCode(target, matchType), value, DUMMY_CREATED_AT];
  return byteLength(stored);
}

/** storage.sync の1アイテム(キー+値)が消費するバイト数。容量ゲージの算出・差分更新に使う。 */
export function itemByteSize(key: string, value: unknown): number {
  return byteLength(key) + byteLength(value);
}

/** storage.sync 全体(全キー)の現在の使用バイト数を実測する。起動時の初期化用(以降は onChanged の差分で追う想定)。 */
export async function getUsageBytes(): Promise<number> {
  const all = await browser.storage.sync.get(null);
  return Object.entries(all).reduce((sum, [key, value]) => sum + itemByteSize(key, value), 0);
}

function chunkKey(index: number): string {
  return `${STORAGE_KEYS.rulesPrefix}${index}`;
}

interface Chunk {
  key: string;
  index: number;
  entries: StoredEntry[];
}

/** 全ルールチャンクをキー番号順に取得する。 */
async function getAllChunks(): Promise<Chunk[]> {
  const all = await browser.storage.sync.get(null);
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
 * 既存チャンクを番号順に見て、追加後も8KB以内に収まる最初のチャンクへ追記する。
 * どのチャンクにも収まらなければ新しいチャンクキーを作る。
 */
export async function addEntry(entry: BlockEntry): Promise<void> {
  const stored = toStored(entry);
  const chunks = await getAllChunks();

  for (const chunk of chunks) {
    const next = [...chunk.entries, stored];
    if (byteLength(next) <= CHUNK_BYTE_LIMIT) {
      await browser.storage.sync.set({ [chunk.key]: next });
      return;
    }
  }

  if (byteLength([stored]) > CHUNK_BYTE_LIMIT) {
    throw new Error('ルールが長すぎて保存できません');
  }

  const nextIndex = chunks.length === 0 ? 0 : chunks[chunks.length - 1].index + 1;
  await browser.storage.sync.set({ [chunkKey(nextIndex)]: [stored] });
}

/** 指定IDのブロックルールを削除する(トーストの「元に戻す」から呼ばれる)。空になったチャンクはキーごと削除する。 */
export async function removeEntry(id: string): Promise<void> {
  const chunks = await getAllChunks();

  for (const chunk of chunks) {
    const next = chunk.entries.filter((e) => e[0] !== id);
    if (next.length === chunk.entries.length) continue;

    if (next.length === 0) {
      await browser.storage.sync.remove(chunk.key);
    } else {
      await browser.storage.sync.set({ [chunk.key]: next });
    }
    return;
  }
}

/**
 * 指定IDのブロックルールを部分更新する。該当IDが無ければ何もしない。
 * 更新後も同じチャンクに収まればその場で上書き、収まらなければ
 * 元のチャンクから取り除いたうえで addEntry と同じロジックで空きのあるチャンクへ再配置する。
 */
export async function updateEntry(id: string, patch: Partial<Pick<BlockEntry, 'target' | 'value'>>): Promise<void> {
  const chunks = await getAllChunks();

  for (const chunk of chunks) {
    const idx = chunk.entries.findIndex((e) => e[0] === id);
    if (idx === -1) continue;

    const patched: BlockEntry = { ...fromStored(chunk.entries[idx]), ...patch };
    const replaced = chunk.entries.map((e, i) => (i === idx ? toStored(patched) : e));

    if (byteLength(replaced) <= CHUNK_BYTE_LIMIT) {
      await browser.storage.sync.set({ [chunk.key]: replaced });
      return;
    }

    const withoutEntry = chunk.entries.filter((_, i) => i !== idx);
    if (withoutEntry.length === 0) {
      await browser.storage.sync.remove(chunk.key);
    } else {
      await browser.storage.sync.set({ [chunk.key]: withoutEntry });
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

/** ブロック履歴ログを追加する。合計件数が LOG_MAX を超えた分は古い順に切り捨てる。 */
export async function addLogs(newEntries: BlockLog[]): Promise<void> {
  if (newEntries.length === 0) return;
  const logs = await getLogs();
  const combined = [...newEntries, ...logs].slice(0, LOG_MAX);
  await browser.storage.local.set({ [LOG_KEY]: combined });
}

/** ブロック履歴ログを全件削除する。 */
export async function clearLogs(): Promise<void> {
  await browser.storage.local.set({ [LOG_KEY]: [] });
}

async function getSettings(): Promise<Settings> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.settings] as Partial<Settings> | undefined) };
}

async function setSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await browser.storage.sync.set({ [STORAGE_KEYS.settings]: { ...current, ...patch } });
}

/** ショート動画を一括ブロックする設定が有効かどうかを取得する。 */
export async function getBlockShortsEnabled(): Promise<boolean> {
  return (await getSettings()).blockShorts;
}

export async function setBlockShortsEnabled(enabled: boolean): Promise<void> {
  await setSettings({ blockShorts: enabled });
}

/** 観測モード(未対応カード検出ログ)が有効かどうかを取得する。 */
export async function getScoutModeEnabled(): Promise<boolean> {
  return (await getSettings()).scoutMode;
}

export async function setScoutModeEnabled(enabled: boolean): Promise<void> {
  await setSettings({ scoutMode: enabled });
}

/** ブロックルール/ログのID用に衝突しにくい一意な文字列を生成する。 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
