import { addLogs, DEFAULT_DEBOUNCE_DELAY, getBlockShortsEnabled, getDebounceDelay, getEntries, getScoutModeEnabled, STORAGE_KEYS } from '../shared/storage';
import { applyBlockList, CARD_SELECTOR, isInsideAdContainer } from './blocker';
import { scoutScan } from './card-scout';
import { setupMenuInjector } from './menu-injector';

import type { BlockEntry } from '../shared/types';

let blockEntries: BlockEntry[] = [];
let blockShorts = false;
let debounceDelay = DEFAULT_DEBOUNCE_DELAY;
let scoutMode = false;

// 観測モード用の独立デバウンス。ブロック適用側は既知カードの追加でしか発火しないが、
// 観測は「未知のカード」を探すのが目的なので、要素追加全般を対象に別系統で走らせる。
let scoutTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleScout(): void {
  if (!scoutMode) return;
  if (scoutTimer) clearTimeout(scoutTimer);
  scoutTimer = setTimeout(() => { scoutScan(); }, debounceDelay);
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
  [debounceDelay, scoutMode] = await Promise.all([getDebounceDelay(), getScoutModeEnabled()]);
  await refresh();
  scheduleScout();

  // 三点メニュー経由のブロック。document全体のclickリスナー1本なので初回登録のみでよい
  setupMenuInjector(async () => { await refresh(); });

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.debounceDelay]) {
      debounceDelay = (changes[STORAGE_KEYS.debounceDelay].newValue as number) ?? DEFAULT_DEBOUNCE_DELAY;
    }
    if (changes[STORAGE_KEYS.scoutMode]) {
      scoutMode = (changes[STORAGE_KEYS.scoutMode].newValue as boolean) ?? false;
      scheduleScout(); // ONにした瞬間に現在のページを一度走査する
    }
    if (!changes[STORAGE_KEYS.list] && !changes[STORAGE_KEYS.blockShorts]) return;
    await refresh();
  });

  // YouTubeはSPAでカード一覧を頻繁に部分差し替えするため、DOM変化を監視して
  // 追加されたノードに動画カードが含まれる場合だけ再適用する(無関係なDOM変化での
  // 無駄な再描画を避ける)。連続発火はデバウンスしてまとめて処理する。
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
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

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applyAndLog();
    }, debounceDelay);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    applyAndLog();
    scheduleScout();
  });
})();
