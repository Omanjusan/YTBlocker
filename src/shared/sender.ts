import { getStoredEntries, getTombstones, isSyncEnabled } from './storage';
import { chunkEntries, fitTombstones, getDeviceId, OUT_PREFIX } from './sync-protocol';
import { outKey, tombKey } from './sync-protocol';

/**
 * 同期の送信側。正DB(storage.local)の現在の保有ルールセット+墓標を、
 * storage.sync 上の自デバイス専用キー(アウトボックス)へ反映する。
 *
 * publish は「あるべき姿と現状の差分だけを書く」冪等な同期処理なので、
 * - ローカル変更後の送信
 * - 自分のキーが外部要因(同期層の事故など)で欠損した際の自己修復
 * の両方をこの1関数で兼ねる。差分が無ければ何も書かないため、
 * onChanged経由で再帰的に呼ばれてもループしない。
 */
export async function publish(): Promise<void> {
  if (!(await isSyncEnabled())) return;

  const deviceId = await getDeviceId();
  const entries = await getStoredEntries();
  const tombs = fitTombstones(await getTombstones());
  const chunks = chunkEntries(entries);

  // あるべきキー構成を組み立てる(ルールが空でもキー自体は置き、キー消失に意味を持たせない)
  const desired: Record<string, unknown> = {};
  chunks.forEach((chunk, i) => { desired[outKey(deviceId, i)] = chunk; });
  if (chunks.length === 0) desired[outKey(deviceId, 0)] = [];
  desired[tombKey(deviceId)] = tombs;

  // 現状の自デバイスキーを取得し、値が変わったキーのみ書き込む
  const all = await browser.storage.sync.get(null);
  const ownPrefix = `${OUT_PREFIX}${deviceId}_`;
  const ownKeys = Object.keys(all).filter((k) => k.startsWith(ownPrefix) || k === tombKey(deviceId));

  const toSet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(desired)) {
    if (JSON.stringify(all[key]) !== JSON.stringify(value)) toSet[key] = value;
  }
  const toRemove = ownKeys.filter((k) => !(k in desired));

  if (Object.keys(toSet).length > 0) await browser.storage.sync.set(toSet);
  if (toRemove.length > 0) await browser.storage.sync.remove(toRemove);
}
