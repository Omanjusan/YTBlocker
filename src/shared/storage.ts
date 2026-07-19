import { byteLength, CHUNK_BYTE_LIMIT } from './sync-protocol';

import type { BlockEntry, BlockLog, MatchTarget, MatchType } from './types';
import type { StoredEntry, Tombstone } from './types';

/**
 * 正DB(storage.local)の読み書き。
 * ルール・設定・ログはすべてローカルに保持し、表示・ブロック動作は常にここだけを見る。
 * storage.sync との送受信は sender.ts / receiver.ts の責務で、このファイルは同期を関知しない。
 * (受信スナップショットの取り込み口として mergeForeign だけを receiver に提供する)
 */

/** browser.storage で使う各設定項目のキー名。文字列の再入力によるタイポを防ぐため一箇所に集約。
 * 例外: 言語設定(LANG_STORAGE_KEY)はi18n.tsに別置き。 */
export const STORAGE_KEYS = {
  /** 正DBのルール本体。全ルールを1キーに格納する。 */
  rules: 'ytblocker_local_rules',
  /** 正DBの墓標(削除済みルールIDと削除時刻)。削除の同期伝搬と、受信時の復活防止に使う。 */
  tombstones: 'ytblocker_local_tombs',
  /** 旧方式(チャンク分割)のルールキー接頭辞。移行処理(フェーズ3)専用。 */
  legacyRulesPrefix: 'ytblocker_rules_',
  settings: 'ytblocker_settings',
  log: 'ytblocker_log',
  logDisabled: 'ytblocker_log_disabled',
  /** 同期無効化フラグ。sender/receiverの稼働可否のみを制御する(正DBの置き場所は常にlocal)。
   * backgroundがONへの切替を検知して追いつき同期を回すため公開キーにしている。 */
  syncEnabled: 'ytblocker_sync_enabled',
} as const;

/** 正DB。すべてのルール/設定/ログ操作はこのareaに対して行う。 */
const AREA = browser.storage.local;

const LOG_KEY = STORAGE_KEYS.log;
const LOG_MAX = 50;

/** 墓標の保持期間。IDは再利用されないため長めに取り、期限切れは剪定する。 */
const TOMB_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** 墓標の最大保持件数。送信時に1アイテムへ収める必要があるため上限を設ける。 */
const TOMB_MAX = 150;

/** id/createdAtは値の長さに依らずほぼ一定サイズなので、バイト見積もり用にダミー値を固定で使う。
 * idはgenerateIdの実形式と同じ13桁のDate.now()+ハイフン+乱数7文字に合わせる。 */
const DUMMY_ID = '0000000000000-0000000';
const DUMMY_CREATED_AT = 1700000000000;

/** ルール本体とは別枠で1キーにまとめて保存する設定項目。デバイスローカル(同期対象外)。 */
interface Settings {
  blockShorts: boolean;
  scoutMode: boolean;
  /** すべてのブロック(ルール＋ショート一括非表示)の一時無効化。 */
  pauseAll: boolean;
}

/** 未保存時に使う設定の初期値。 */
const DEFAULT_SETTINGS: Settings = { blockShorts: false, scoutMode: false, pauseAll: false };

/** ルールの同期(sender/receiverの稼働)が有効かどうか。デフォルトは有効。 */
export async function isSyncEnabled(): Promise<boolean> {
  const result = await AREA.get(STORAGE_KEYS.syncEnabled);
  return (result[STORAGE_KEYS.syncEnabled] as boolean | undefined) ?? true;
}

/** isSyncEnabled と対。OFFでもsync上の自デバイスの送信箱は消さない(キー消失に意味を持たせない設計)。 */
export async function setSyncEnabled(enabled: boolean): Promise<void> {
  await AREA.set({ [STORAGE_KEYS.syncEnabled]: enabled });
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
 * addEntryの単独サイズ判定(byteLength([stored]))と一致するよう、配列で包んだサイズで測る。 */
export function estimateEntryBytes(target: MatchTarget, matchType: MatchType, value: string): number {
  const stored: StoredEntry = [DUMMY_ID, packTargetMatch(target, matchType), value, DUMMY_CREATED_AT];
  return byteLength([stored]);
}

/** 正DBのルール一覧を保存形式(タプル)のまま取得する。sender の送信元にもなる。 */
export async function getStoredEntries(): Promise<StoredEntry[]> {
  const result = await AREA.get(STORAGE_KEYS.rules);
  return (result[STORAGE_KEYS.rules] as StoredEntry[] | undefined) ?? [];
}

/** 正DBのルール一覧を丸ごと書き換える(private)。 */
async function setStoredEntries(entries: StoredEntry[]): Promise<void> {
  await AREA.set({ [STORAGE_KEYS.rules]: entries });
}

/** 正DBの墓標一覧を取得する。sender の送信元にもなる。 */
export async function getTombstones(): Promise<Tombstone[]> {
  const result = await AREA.get(STORAGE_KEYS.tombstones);
  return (result[STORAGE_KEYS.tombstones] as Tombstone[] | undefined) ?? [];
}

/** 期限切れ・件数超過の墓標を古い順に剪定して保存する(private)。 */
async function setTombstones(tombs: Tombstone[]): Promise<void> {
  const limit = Date.now() - TOMB_TTL_MS;
  const pruned = tombs
    .filter(([, deletedAt]) => deletedAt >= limit)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOMB_MAX);
  await AREA.set({ [STORAGE_KEYS.tombstones]: pruned });
}

/** 登録済みのブロックルール一覧を取得する。未登録時は空配列。 */
export async function getEntries(): Promise<BlockEntry[]> {
  return (await getStoredEntries()).map(fromStored);
}

/** ブロックルールを1件追加する。1件が送信チャンクに収まらないサイズなら拒否する。 */
export async function addEntry(entry: BlockEntry): Promise<void> {
  const stored = toStored(entry);
  if (byteLength([stored]) > CHUNK_BYTE_LIMIT) {
    throw new Error('ルールが長すぎて保存できません');
  }
  const entries = await getStoredEntries();
  await setStoredEntries([...entries, stored]);
}

/** 指定IDのブロックルールを削除し、墓標を残す(トーストの「元に戻す」から呼ばれる)。 */
export async function removeEntry(id: string): Promise<void> {
  const entries = await getStoredEntries();
  const next = entries.filter((e) => e[0] !== id);
  if (next.length === entries.length) return;

  await setStoredEntries(next);
  await setTombstones([...(await getTombstones()), [id, Date.now()]]);
}

/**
 * 指定IDのブロックルールを部分更新する。該当IDが無ければ何もしない。
 * 同期の受信側は「既存IDと衝突する追加を取り込まない」ため、同一IDのままでは編集が伝搬しない。
 * そこで編集は「旧IDの削除(墓標)+新IDでの追加」として表現する。createdAtは一覧の並び順維持のため引き継ぐ。
 */
export async function updateEntry(id: string, patch: Partial<Pick<BlockEntry, 'target' | 'value' | 'matchType'>>): Promise<void> {
  const entries = await getStoredEntries();
  const idx = entries.findIndex((e) => e[0] === id);
  if (idx === -1) return;

  const patched: BlockEntry = { ...fromStored(entries[idx]), ...patch, id: generateId() };
  const stored = toStored(patched);
  if (byteLength([stored]) > CHUNK_BYTE_LIMIT) {
    throw new Error('ルールが長すぎて保存できません');
  }

  const next = entries.map((e, i) => (i === idx ? stored : e));
  await setStoredEntries(next);
  await setTombstones([...(await getTombstones()), [id, Date.now()]]);
}

/**
 * 受信スナップショットを正DBへマージする(receiver専用の取り込み口)。
 * - 追加: ローカルに無いIDのみ取り込む。ID衝突・墓標入りのID・同内容(対象+一致方法+値)の重複は取り込まない
 * - 削除: 相手の墓標にあるIDをローカルからも削除する。墓標自体も取り込み、他デバイスへ再伝搬させる
 * ルール一覧に変化があったかを返す(呼び出し側のログ用。UI反映はonChanged経由で自動)。
 */
export async function mergeForeign(foreignEntries: StoredEntry[], foreignTombs: Tombstone[]): Promise<boolean> {
  const entries = await getStoredEntries();
  const tombs = await getTombstones();

  const tombIds = new Map<string, number>(tombs);
  let tombsChanged = false;
  for (const [id, deletedAt] of foreignTombs) {
    if (!tombIds.has(id)) {
      tombIds.set(id, deletedAt);
      tombsChanged = true;
    }
  }

  const survivors = entries.filter((e) => !tombIds.has(e[0]));

  const localIds = new Set(survivors.map((e) => e[0]));
  // 同内容判定キーの区切りはNUL。ルール値に現れ得ない文字なので衝突しない。
  // 生のNULバイトを書くとgrep/file等がこのファイルをバイナリ扱いするためエスケープ表記にする
  const localBodies = new Set(survivors.map((e) => `${e[1]}\u0000${e[2]}`));
  const additions = foreignEntries.filter((e) => {
    if (tombIds.has(e[0]) || localIds.has(e[0])) return false;
    if (localBodies.has(`${e[1]}\u0000${e[2]}`)) return false;
    localIds.add(e[0]);
    localBodies.add(`${e[1]}\u0000${e[2]}`);
    return true;
  });

  const rulesChanged = survivors.length !== entries.length || additions.length > 0;
  if (rulesChanged) await setStoredEntries([...survivors, ...additions]);
  if (tombsChanged) await setTombstones([...tombIds.entries()].map(([id, at]) => [id, at]));
  return rulesChanged;
}

/** ブロック履歴ログを新しい順に取得する。 */
export async function getLogs(): Promise<BlockLog[]> {
  const result = await AREA.get(LOG_KEY);
  return (result[LOG_KEY] as BlockLog[] | undefined) ?? [];
}

/** ブロック履歴ログを追加する。合計件数が LOG_MAX を超えた分は古い順に切り捨てる。ログ無効時は何もしない。 */
export async function addLogs(newEntries: BlockLog[]): Promise<void> {
  if (newEntries.length === 0) return;
  if (await isLogDisabled()) return;
  const logs = await getLogs();
  const combined = [...newEntries, ...logs].slice(0, LOG_MAX);
  await AREA.set({ [LOG_KEY]: combined });
}

/** ブロック履歴ログを全件削除する。 */
export async function clearLogs(): Promise<void> {
  await AREA.set({ [LOG_KEY]: [] });
}

/** ブロックログの記録/表示を無効化しているか。パフォーマンス懸念があるユーザー向けの設定。 */
export async function isLogDisabled(): Promise<boolean> {
  const result = await AREA.get(STORAGE_KEYS.logDisabled);
  return (result[STORAGE_KEYS.logDisabled] as boolean | undefined) ?? false;
}

/** isLogDisabled と対。 */
export async function setLogDisabled(disabled: boolean): Promise<void> {
  await AREA.set({ [STORAGE_KEYS.logDisabled]: disabled });
}

/** Settingsを正DBから読み出す。未保存項目はDEFAULT_SETTINGSで補完する。 */
async function getSettings(): Promise<Settings> {
  const result = await AREA.get(STORAGE_KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.settings] as Partial<Settings> | undefined) };
}

/** Settingsの一部を正DBへ差分反映する(既存値とマージして丸ごと上書き)。 */
async function setSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await AREA.set({ [STORAGE_KEYS.settings]: { ...current, ...patch } });
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

/** すべてのブロック(ルール＋ショート一括非表示)を一時無効化しているかどうかを取得する。 */
export async function getPauseAllEnabled(): Promise<boolean> {
  return (await getSettings()).pauseAll;
}

/** getPauseAllEnabled と対。 */
export async function setPauseAllEnabled(enabled: boolean): Promise<void> {
  await setSettings({ pauseAll: enabled });
}

/** ブロックルール/ログのID用に衝突しにくい一意な文字列を生成する。 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
