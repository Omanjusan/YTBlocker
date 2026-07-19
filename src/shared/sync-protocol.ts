import type { StoredEntry, Tombstone } from './types';

/**
 * デバイス間同期のプロトコル定義。
 * storage.sync は「デバイスごとの送信箱(アウトボックス)」の置き場としてのみ使い、
 * 正DB(storage.local)とは完全に分離する。自分のキーは自分だけが書くため、
 * 複数デバイスが同じキーを取り合う衝突(last-writer-winsによる全滅)が構造的に起きない。
 *
 * キー構成(deviceIdはデバイスごとの固定ランダム文字列):
 * - ytblocker_out_<deviceId>_<n> : そのデバイスの保有ルールセット(チャンク分割、上書き更新)
 * - ytblocker_tomb_<deviceId>    : そのデバイスが削除したルールIDの墓標一覧
 */

/** アウトボックス(保有ルールセット)キーの接頭辞。 */
export const OUT_PREFIX = 'ytblocker_out_';
/** 墓標キーの接頭辞。 */
export const TOMB_PREFIX = 'ytblocker_tomb_';
/** デバイスIDを保存する storage.local のキー。 */
const DEVICE_ID_KEY = 'ytblocker_device_id';

/** storage.sync の1アイテムあたり上限(8192byte)に対する安全マージン。ルール1件が収まる上限としても使う。 */
export const CHUNK_BYTE_LIMIT = 7800;
export const MAX_ENTRY_BYTES = CHUNK_BYTE_LIMIT;

/** storage.sync 全体の容量上限(約100KB)。ここに対する使用率をUIの容量ゲージに使う。 */
export const SYNC_TOTAL_BUDGET = 102400;

const encoder = new TextEncoder();

/** JSONシリアライズ後のUTF-8実バイト数を計算する(日本語は1文字3byteになるため文字数では判定できない)。 */
export function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** storage.sync の1アイテム(キー+値)が消費するバイト数。容量ゲージの算出・差分更新に使う。 */
export function itemByteSize(key: string, value: unknown): number {
  return byteLength(key) + byteLength(value);
}

/** このデバイスの固定ID。初回アクセス時に生成して storage.local に保存する。 */
export async function getDeviceId(): Promise<string> {
  const result = await browser.storage.local.get(DEVICE_ID_KEY);
  const existing = result[DEVICE_ID_KEY] as string | undefined;
  if (existing) return existing;
  const id = Math.random().toString(36).slice(2, 10);
  await browser.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

/** アウトボックスのチャンクキー名を組み立てる(例: "ytblocker_out_a1b2c3d4_0")。 */
export function outKey(deviceId: string, index: number): string {
  return `${OUT_PREFIX}${deviceId}_${index}`;
}

/** 墓標キー名を組み立てる(例: "ytblocker_tomb_a1b2c3d4")。 */
export function tombKey(deviceId: string): string {
  return `${TOMB_PREFIX}${deviceId}`;
}

/** 同期フィード(アウトボックス/墓標)のキーかどうか。容量ゲージの集計対象判定にも使う。 */
export function isSyncFeedKey(key: string): boolean {
  return key.startsWith(OUT_PREFIX) || key.startsWith(TOMB_PREFIX);
}

/** 同期フィードキーの持ち主(deviceId)を返す。フィードキーでなければnull。 */
export function feedOwner(key: string): string | null {
  if (key.startsWith(TOMB_PREFIX)) return key.slice(TOMB_PREFIX.length);
  if (key.startsWith(OUT_PREFIX)) {
    const rest = key.slice(OUT_PREFIX.length);
    const sep = rest.lastIndexOf('_');
    return sep === -1 ? rest : rest.slice(0, sep);
  }
  return null;
}

/** ルール一覧をCHUNK_BYTE_LIMIT以内のチャンク列に分割する。順序は保持する。 */
export function chunkEntries(entries: StoredEntry[]): StoredEntry[][] {
  const chunks: StoredEntry[][] = [];
  let current: StoredEntry[] = [];
  for (const entry of entries) {
    if (current.length > 0 && byteLength([...current, entry]) > CHUNK_BYTE_LIMIT) {
      chunks.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** 墓標一覧が1アイテムに収まるよう、古い順に切り捨てる。 */
export function fitTombstones(tombs: Tombstone[]): Tombstone[] {
  const sorted = [...tombs].sort((a, b) => b[1] - a[1]);
  while (sorted.length > 0 && byteLength(sorted) > CHUNK_BYTE_LIMIT) sorted.pop();
  return sorted;
}

/** 同期フィード全体が storage.sync 上で消費しているバイト数を実測する。容量ゲージの初期化用。 */
export async function getSyncUsageBytes(): Promise<number> {
  const all = await browser.storage.sync.get(null);
  return Object.entries(all)
    .filter(([key]) => isSyncFeedKey(key))
    .reduce((sum, [key, value]) => sum + itemByteSize(key, value), 0);
}
