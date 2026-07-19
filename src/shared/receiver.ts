import { isSyncEnabled, mergeForeign } from './storage';
import { feedOwner, getDeviceId, OUT_PREFIX, TOMB_PREFIX } from './sync-protocol';

import type { StoredEntry, Tombstone } from './types';

/**
 * 同期の受信側。storage.sync 上の他デバイスのアウトボックス/墓標を読み、
 * 正DB(storage.local)へマージする。取り込み規則(ID衝突は追加しない・
 * 墓標だけが削除を意味する)の実体は storage.mergeForeign 側にある。
 *
 * pull は全フィードを読み直す冪等処理。onChangedの変更内容を個別に追わず
 * 毎回全量マージする(ルール数規模的に十分軽く、取りこぼしが構造的に起きない)。
 */
export async function pull(): Promise<boolean> {
  if (!(await isSyncEnabled())) return false;

  const myId = await getDeviceId();
  const all = await browser.storage.sync.get(null);

  const foreignEntries: StoredEntry[] = [];
  const foreignTombs: Tombstone[] = [];
  for (const [key, value] of Object.entries(all)) {
    const owner = feedOwner(key);
    if (owner === null || owner === myId) continue;
    if (key.startsWith(OUT_PREFIX)) foreignEntries.push(...((value as StoredEntry[] | undefined) ?? []));
    if (key.startsWith(TOMB_PREFIX)) foreignTombs.push(...((value as Tombstone[] | undefined) ?? []));
  }

  if (foreignEntries.length === 0 && foreignTombs.length === 0) return false;
  return mergeForeign(foreignEntries, foreignTombs);
}
