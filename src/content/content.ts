import { addLogs, DEFAULT_DEBOUNCE_DELAY, getBlockShortsEnabled, getDebounceDelay, getEntries, STORAGE_KEYS } from '../shared/storage';
import { applyBlockList, CARD_SELECTOR } from './blocker';
import { injectAllCardButtons } from './card-buttons';

import type { BlockEntry } from '../shared/types';

let blockEntries: BlockEntry[] = [];
let blockShorts = false;
let debounceDelay = DEFAULT_DEBOUNCE_DELAY;

/** 現在のブロックルールをDOMに適用し、ブロックが発生していればログを保存する。 */
function applyAndLog(): void {
  const logs = applyBlockList(blockEntries, blockShorts);
  if (logs.length > 0) addLogs(logs).catch(() => {});
}

/** カードへのブロックボタン注入をやり直す。ボタン押下時は refresh() 経由で再適用する。 */
function injectButtons(): void {
  injectAllCardButtons(async () => { await refresh(); });
}

/** storage からルール/設定を読み直し、ブロック適用とボタン注入をやり直す。 */
async function refresh(): Promise<void> {
  [blockEntries, blockShorts] = await Promise.all([getEntries(), getBlockShortsEnabled()]);
  applyAndLog();
  injectButtons();
}

(async () => {
  debounceDelay = await getDebounceDelay();
  await refresh();

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEYS.debounceDelay]) {
      debounceDelay = (changes[STORAGE_KEYS.debounceDelay].newValue as number) ?? DEFAULT_DEBOUNCE_DELAY;
    }
    if (!changes[STORAGE_KEYS.list] && !changes[STORAGE_KEYS.blockShorts]) return;
    await refresh();
  });

  // YouTubeはSPAでカード一覧を頻繁に部分差し替えするため、DOM変化を監視して
  // 追加されたノードに動画カードが含まれる場合だけ再適用する(無関係なDOM変化での
  // 無駄な再描画を避ける)。連続発火はデバウンスしてまとめて処理する。
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const domObserver = new MutationObserver((mutations) => {
    const hasRelevantChange = mutations.some(m =>
      [...m.addedNodes].some(n =>
        n.nodeType === 1 && (
          (n as Element).matches?.(CARD_SELECTOR) ||
          (n as Element).querySelector?.(CARD_SELECTOR)
        )
      )
    );
    if (!hasRelevantChange) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      applyAndLog();
      injectButtons();
    }, debounceDelay);
  });
  domObserver.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    applyAndLog();
    injectButtons();
  });
})();
