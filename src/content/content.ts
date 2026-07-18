import { addLogs, getBlockShortsEnabled, getEntries, getScoutModeEnabled, isActiveArea, STORAGE_KEYS } from '../shared/storage';
import { getLanguage } from '../shared/i18n';
import { applyBlockList, CARD_SELECTOR, isInsideAdContainer } from './blocker';
import { scoutScan } from './card-scout';
import { setupMenuInjector } from './menu-injector';

import type { BlockEntry } from '../shared/types';

/** 現在のブロックルール一覧。storageから読み込んでキャッシュし、refresh() で読み直す。 */
let blockEntries: BlockEntry[] = [];
/** ショート動画を一括ブロックする設定の現在値。refresh() で読み直す。 */
let blockShorts = false;
/** 観測モード(youtubeUIアップデート時など未対応カード検出時の開発者追跡用隠しオプション)
 * の現在値。storage.onChanged で即時反映する。 */
let scoutMode = false;

/** 観測モードが有効な場合のみ scoutScan を実行するラッパー。 */
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

/**
 * コンテンツスクリプトの初期化処理。
 * 設定読み込み→初回ブロック適用→三点メニュー注入のセットアップを行った後、
 * storageの変更監視・DOM変化監視をそれぞれ登録し、以降はイベント駆動で
 * ブロック適用/観測モードを回し続ける。
 * (YouTube側のSPAページ遷移(yt-navigate-finish)監視は、DOM変化監視単独で代替できるか
 * 実地検証中のため一時コメントアウト中: YTBLOCKER_TEST_NAVIGATE_FINISH)
 */
(async () => {
  scoutMode = await getScoutModeEnabled();
  await refresh();
  scheduleScout();

  // 三点メニュー経由のブロック。document全体のclickリスナー1本なので初回登録のみでよい。
  // 言語切替はページ再読み込みで反映される想定(リアルタイム監視はしない)
  const lang = await getLanguage();
  setupMenuInjector(lang, async () => { await refresh(); });

  // options.ts(別コンテキスト)側でのルール登録・設定変更をこのタブにも即時反映する。
  // アクティブでないarea(sync/local切替前後の非対象側)からの変更は無視する。
  browser.storage.onChanged.addListener(async (changes, area) => {
    if (!(await isActiveArea(area))) return;

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
  // body配下全体を対象に監視開始。YouTubeはページ内のどこでカード一覧を差し替えるか
  // 特定できないため、childList+subtreeでDOM全域を対象にする。
  domObserver.observe(document.body, { childList: true, subtree: true });

  // 1.4.0コメントアウト: domObserver側だけでSPA遷移時のカード差し替えを
  // 検知できるか実地テスト中。(YTBLOCKER_TEST_NAVIGATE_FINISH)
  // document.addEventListener('yt-navigate-finish', () => {
  //   applyAndLog();
  //   scheduleScout();
  // });
})();
