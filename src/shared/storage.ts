import type { BlockEntry, BlockLog } from './types';

/** browser.storage.local で使う各設定項目のキー名。文字列の再入力によるタイポを防ぐため一箇所に集約。 */
export const STORAGE_KEYS = {
  list: 'ytblocker_list',
  log: 'ytblocker_log',
  blockShorts: 'ytblocker_block_shorts',
  debounceDelay: 'ytblocker_debounce_delay',
  scoutMode: 'ytblocker_scout_mode',
} as const;

const KEY           = STORAGE_KEYS.list;
const LOG_KEY        = STORAGE_KEYS.log;
const SHORTS_KEY     = STORAGE_KEYS.blockShorts;
const DEBOUNCE_KEY   = STORAGE_KEYS.debounceDelay;
const SCOUT_KEY      = STORAGE_KEYS.scoutMode;
const LOG_MAX        = 50;

export const DEFAULT_DEBOUNCE_DELAY = 300;

/** 登録済みのブロックルール一覧を取得する。未登録時は空配列。 */
export async function getEntries(): Promise<BlockEntry[]> {
  const result = await browser.storage.local.get(KEY);
  return (result[KEY] as BlockEntry[] | undefined) ?? [];
}

/** ブロックルールを1件追加する。 */
export async function addEntry(entry: BlockEntry): Promise<void> {
  const entries = await getEntries();
  entries.push(entry);
  await browser.storage.local.set({ [KEY]: entries });
}

/** 指定IDのブロックルールを削除する(トーストの「元に戻す」から呼ばれる)。 */
export async function removeEntry(id: string): Promise<void> {
  const entries = await getEntries();
  await browser.storage.local.set({ [KEY]: entries.filter((e) => e.id !== id) });
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

/** ショート動画を一括ブロックする設定が有効かどうかを取得する。 */
export async function getBlockShortsEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(SHORTS_KEY);
  return (result[SHORTS_KEY] as boolean | undefined) ?? false;
}

export async function setBlockShortsEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SHORTS_KEY]: enabled });
}

/** DOM監視の再描画をまとめて処理するデバウンス遅延時間(ms)を取得する。 */
export async function getDebounceDelay(): Promise<number> {
  const result = await browser.storage.local.get(DEBOUNCE_KEY);
  return (result[DEBOUNCE_KEY] as number | undefined) ?? DEFAULT_DEBOUNCE_DELAY;
}

export async function setDebounceDelay(ms: number): Promise<void> {
  await browser.storage.local.set({ [DEBOUNCE_KEY]: ms });
}

/** 観測モード(未対応カード検出ログ)が有効かどうかを取得する。 */
export async function getScoutModeEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(SCOUT_KEY);
  return (result[SCOUT_KEY] as boolean | undefined) ?? false;
}

export async function setScoutModeEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SCOUT_KEY]: enabled });
}

/** ブロックルール/ログのID用に衝突しにくい一意な文字列を生成する。 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
