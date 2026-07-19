import { mergeForeign, STORAGE_KEYS } from './storage';

import type { StoredEntry } from './types';

/**
 * 旧保存形式(v1: ルールを ytblocker_rules_<n> チャンクとしてsync/localの片側に保存)からの移行。
 * 旧チャンクのルールを正DB(storage.local)へ取り込む。取り込みは mergeForeign 経由なので
 * 何度実行しても安全(冪等)で、新形式で削除済み(墓標あり)のルールを復活させない。
 *
 * - localの旧チャンク: 取り込み後に削除する(このデバイスしか参照しないため安全)
 * - syncの旧チャンク: 削除しない。旧バージョンのままの他デバイスがまだ読み書きするため
 *   凍結で残す(全デバイスの更新が行き渡った後続バージョンでの掃除を想定)
 * - 旧settings(sync側): 正DBにsettingsが未保存の場合のみ引き継ぐ(設定はデバイスローカル化)
 */

/** 旧チャンクキーかどうか。新キー(ytblocker_local_/ytblocker_out_ 等)とは接頭辞が重ならない。 */
export function isLegacyRuleKey(key: string): boolean {
  return key.startsWith(STORAGE_KEYS.legacyRulesPrefix);
}

/** area全体のスナップショットから旧チャンクの全ルールを平坦化して集める。 */
function collectLegacyEntries(all: Record<string, unknown>): StoredEntry[] {
  return Object.keys(all)
    .filter(isLegacyRuleKey)
    .flatMap((key) => (all[key] as StoredEntry[] | undefined) ?? []);
}

/** 旧形式データの取り込みと(local側のみ)掃除を行う。backgroundの起動時と旧チャンク変更検知時に呼ばれる。 */
export async function importLegacy(): Promise<void> {
  const [syncAll, localAll] = await Promise.all([
    browser.storage.sync.get(null),
    browser.storage.local.get(null),
  ]);

  const legacy = [...collectLegacyEntries(localAll), ...collectLegacyEntries(syncAll)];
  if (legacy.length > 0) await mergeForeign(legacy, []);

  if (localAll[STORAGE_KEYS.settings] === undefined && syncAll[STORAGE_KEYS.settings] !== undefined) {
    await browser.storage.local.set({ [STORAGE_KEYS.settings]: syncAll[STORAGE_KEYS.settings] });
  }

  const localLegacyKeys = Object.keys(localAll).filter(isLegacyRuleKey);
  if (localLegacyKeys.length > 0) await browser.storage.local.remove(localLegacyKeys);
}
