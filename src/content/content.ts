import { addLogs, getBlockShortsEnabled, getEntries, getScoutModeEnabled, STORAGE_KEYS } from '../shared/storage';
import { applyBlockList, CARD_SELECTOR, isInsideAdContainer } from './blocker';
import { scoutScan } from './card-scout';
import { setupMenuInjector } from './menu-injector';

import type { BlockEntry } from '../shared/types';

let blockEntries: BlockEntry[] = [];
let blockShorts = false;
let scoutMode = false;

function scheduleScout(): void {
  if (scoutMode) scoutScan();
}

/** 現在のブロックルールをDOMに適用し、ブロックが発生していればログを保存する。 */
function applyAndLog(): void {
  const logs = applyBlockList(blockEntries, blockShorts);
  if (logs.length > 0) addLogs(logs).catch(() => {});
}

/** storage からルール/設定を読み直し、ブロック適用をやり直す。 */
async function refresh(): Promise<void> {
  [blockEntries, blockShorts] = await Promise.all([getEntries(), getBlockShortsEnabled()]);
  applyAndLog();
}

(async () => {
  scoutMode = await getScoutModeEnabled();
  await refresh();
  scheduleScout();

  // 三点メニュー経由のブロック。document全体のclickリスナー1本なので初回登録のみでよい
  setupMenuInjector(async () => { await refresh(); });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'sync') return;

    if (changes[STORAGE_KEYS.settings]) {
      const newSettings = changes[STORAGE_KEYS.settings].newValue as { scoutMode?: boolean } | undefined;
      scoutMode = newSettings?.scoutMode ?? false;
      scheduleScout(); // ONにした瞬間に現在のページを一度走査する
    }

    const ruleChanged = Object.keys(changes).some((k) => k.startsWith(STORAGE_KEYS.rulesPrefix));
    if (!ruleChanged && !changes[STORAGE_KEYS.settings]) return;
    await refresh();
  });

  // YouTubeはSPAでカード一覧を頻繁に部分差し替えするため、DOM変化を監視して
  // 追加されたノードに動画カードが含まれる場合だけ再適用する(無関係なDOM変化での
  // 無駄な再描画を避ける)。
  const domObserver = new MutationObserver((mutations) => {
    const addedElements = mutations.flatMap(m => [...m.addedNodes].filter(n => n.nodeType === 1));
    if (addedElements.length === 0) return;

    // 観測モードは未知カードが対象なので CARD_SELECTOR で絞らず要素追加全般で走らせる
    scheduleScout();

    // 広告枠は uBlock 等と同じDOMを奪い合いやすく、そこだけの変化で毎回
    // 再スキャンすると衝突頻度が上がる。広告枠以外にカードが増えた時だけ反応する
    const hasRelevantChange = addedElements.some((n) => {
      const el = n as Element;
      const cards = [
        ...(el.matches?.(CARD_SELECTOR) ? [el] : []),
        ...(el.querySelectorAll?.(CARD_SELECTOR) ?? []),
      ];
      return cards.some((card) => !isInsideAdContainer(card));
    });
    if (!hasRelevantChange) return;

    applyAndLog();
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    applyAndLog();
    scheduleScout();
  });
})();
