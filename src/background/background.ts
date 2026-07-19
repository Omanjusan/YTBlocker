import { importLegacy, isLegacyRuleKey } from '../shared/migration';
import { pull } from '../shared/receiver';
import { publish } from '../shared/sender';
import { STORAGE_KEYS } from '../shared/storage';
import { isSyncFeedKey } from '../shared/sync-protocol';

/** ツールバーアイコンのクリックでオプションページを新規タブで開く。 */
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

// ---- 同期エンジンの駆動 ----
// sender(publish)/receiver(pull)はいずれも冪等(差分ゼロなら何も書かない)なので、
// ここでは「いつ回すか」だけを担う。実行中の再要求は1回に畳んで追走する。

let syncRunning = false;
let syncQueued = false;

/** 受信→送信の順で1周回す。受信で正DBが変わればその内容も直後のpublishで送信に反映される。 */
async function runSync(): Promise<void> {
  if (syncRunning) {
    syncQueued = true;
    return;
  }
  syncRunning = true;
  try {
    await pull();
    await publish();
  } catch (e) {
    console.warn('YTBlocker: 同期処理に失敗', e);
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      void runSync();
    }
  }
}

/** 旧形式(v1チャンク)の取り込み。冪等なので失敗しても次回起動・次回検知でやり直せる。 */
async function runImportLegacy(): Promise<void> {
  try {
    await importLegacy();
  } catch (e) {
    console.warn('YTBlocker: 旧形式データの移行に失敗', e);
  }
}

// 起動時(ブラウザ起動・拡張更新)は旧形式の取り込み→追いつき同期の順で一度回す
void (async () => {
  await runImportLegacy();
  await runSync();
})();

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    // 正DBのルール/墓標の変更(編集操作・receiverのマージ) → 送信箱へ反映
    // 同期フラグOFF→ON → 停止中に溜まった差分の追いつき
    const relevant =
      changes[STORAGE_KEYS.rules] !== undefined ||
      changes[STORAGE_KEYS.tombstones] !== undefined ||
      changes[STORAGE_KEYS.syncEnabled]?.newValue === true;
    if (relevant) void runSync();
    return;
  }

  if (area === 'sync') {
    // 他デバイスの送信箱の更新 → 受信。自分のキーの外部変化(同期層の事故等) → publishの自己修復
    if (Object.keys(changes).some(isSyncFeedKey)) void runSync();
    // 旧バージョンのままの他デバイスが旧チャンクを更新した場合も取りこぼさず取り込む
    // (取り込みで正DBが変わればlocalのonChanged経由でrunSyncが自動的に続く)
    if (Object.keys(changes).some(isLegacyRuleKey)) void runImportLegacy();
  }
});
