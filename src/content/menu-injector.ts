import { blockAndLog, CARD_SELECTOR, getChannelName, getVideoTitle, isInsideAdContainer } from './blocker';
import { debugLog } from '../shared/debug';

type OnAdded = () => void;

let pendingCard: Element | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let menuObserver: MutationObserver | null = null;
let injectAttempts = 0;

/** 三点メニュー監視の途中状態(監視中のカード・MutationObserver・ポーリング・タイムアウト)を全て破棄する。 */
function reset(): void {
  if (cleanupTimer !== null) clearTimeout(cleanupTimer);
  if (pollTimer !== null) clearInterval(pollTimer);
  menuObserver?.disconnect();
  menuObserver = null;
  pendingCard = null;
  cleanupTimer = null;
  pollTimer = null;
  injectAttempts = 0;
}

/** YouTubeの三点メニュー(tp-yt-paper-listbox)に挿入する項目1個分のDOM要素を生成する。 */
function createMenuItem(label: string, onClick: () => void): HTMLElement {
  // メニューのポップアップ内では --yt-spec-text-primary が解決されないことがあるため、
  // YouTubeがダークモード時に付ける <html dark> 属性でフォールバック色を切り替える
  const fallbackColor = document.documentElement.hasAttribute('dark') ? '#f1f1f1' : '#0f0f0f';
  const el = document.createElement('div');
  el.className = 'ytblocker-item';
  el.setAttribute('role', 'menuitem');
  el.setAttribute('tabindex', '0');
  el.textContent = label;
  el.style.cssText = [
    'cursor:pointer',
    'padding:0 16px',
    'min-height:40px',
    'display:flex',
    'align-items:center',
    'font-size:1.4rem',
    'font-family:Roboto,Arial,sans-serif',
    `color:var(--yt-spec-text-primary,${fallbackColor})`,
    'white-space:nowrap',
    'box-sizing:border-box',
  ].join(';');

  el.addEventListener('mouseenter', () => {
    el.style.backgroundColor = 'var(--yt-spec-10-percent-layer,rgba(0,0,0,0.05))';
  });
  el.addEventListener('mouseleave', () => {
    el.style.backgroundColor = '';
  });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
    // YouTube のメニューを閉じる（Escape キー相当）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  return el;
}

/** 開いた三点メニューの listbox に区切り線とブロック用の項目を追加する。既に追加済みなら何もしない。 */
function injectItems(card: Element, listbox: Element, onAdded: OnAdded): void {
  if (listbox.querySelector('.ytblocker-item')) {
    debugLog('injectItems: already injected, skip');
    return;
  }

  // メニューDOMの使い回し・再構築でlistbox外に残った過去の注入分が
  // 同じポップアップ内に見えてしまう(区切り線の二重表示等)ため、注入直前にも残骸を掃除する
  const stale = document.querySelectorAll('.ytblocker-item');
  if (stale.length > 0) {
    debugLog('injectItems: removing', stale.length, 'stale item(s)');
    stale.forEach((el) => el.remove());
  }

  const title = getVideoTitle(card);
  const channel = getChannelName(card);
  debugLog('injectItems: title:', title || '(empty)', '| channel:', channel || '(empty)');
  if (!title && !channel) {
    debugLog('injectItems: title/channel both empty, bail');
    return;
  }

  const sep = document.createElement('div');
  sep.className = 'ytblocker-item ytblocker-sep';
  sep.style.cssText = 'border-top:1px solid var(--yt-spec-10-percent-layer,#e0e0e0);margin:4px 0;pointer-events:none';
  listbox.appendChild(sep);

  if (title) {
    listbox.appendChild(
      createMenuItem('🚫 この動画をブロック', async () => {
        await blockAndLog(card, 'video', title, title, channel, onAdded);
      })
    );
  }

  if (channel) {
    listbox.appendChild(
      createMenuItem('🚫 このチャンネルをブロック', async () => {
        await blockAndLog(card, 'channel', channel, title, channel, onAdded);
      })
    );
  }

  updateSepVisibility(listbox);
}

/**
 * 区切り線の二重表示を防ぐ。旧UIのネイティブ最終項目はdividerを内蔵している(has-separator属性)ことがあり、
 * その直後にこちらのsepが並ぶと線が2本見える。sepの直前の可視要素がhas-separator持ちならsepを非表示にする。
 * メニューDOM使い回し時はネイティブ項目が注入後に差し込まれることがあるため、
 * 注入直後の一回だけでなく監視中のポーリングからも呼んで追従する。
 */
function updateSepVisibility(listbox: Element): void {
  const sep = listbox.querySelector('.ytblocker-sep') as HTMLElement | null;
  if (!sep) return;
  let prev: Element | null = sep.previousElementSibling;
  while (prev && (prev as HTMLElement).offsetHeight === 0) {
    prev = prev.previousElementSibling;
  }
  const redundant = prev?.hasAttribute('has-separator') ?? false;
  sep.style.display = redundant ? 'none' : '';
}

/**
 * 三点メニューの見切れ対策。
 * 新UI(yt-list-view-model系シート型メニュー)では、メニューを開いた時点で測ったネイティブ項目分の高さが
 * yt-sheet-view-model のインライン max-height に固定されるため、後から注入した項目が
 * 配下の overflow:auto なDIVでクリップされて見切れる(実測でこの構造を確認済み)。
 * そこで listbox の実コンテンツ高に合わせて max-height を自前で上書きして全項目を展開する。
 * 上限は yt-contextual-sheet-layout 側の max-height(ビューポート由来)でクランプする。
 * YouTube側の開閉アニメーション等が遅れて上書きしてくるため、即時・次フレーム・150ms後の3回適用する。
 * 旧UI(tp-yt-paper-listbox系)はこの構造を持たないため、従来どおりresizeイベントで再計算を促す。
 */
function expandMenuSheet(listbox: Element): void {
  const el = listbox as HTMLElement;
  const sheet = el.closest('yt-sheet-view-model') as HTMLElement | null;

  if (!sheet) {
    // 旧UI: resizeイベントでYouTube側の位置・高さ再計算を促す
    window.dispatchEvent(new Event('resize'));
    return;
  }

  const layout = el.closest('yt-contextual-sheet-layout') as HTMLElement | null;

  const apply = () => {
    const needed = el.scrollHeight;
    if (needed <= 0) return;
    const cap = layout ? parseFloat(getComputedStyle(layout).maxHeight) : NaN;
    const next = Number.isFinite(cap) ? Math.min(needed, cap) : needed;
    if (parseFloat(sheet.style.maxHeight) !== next) {
      sheet.style.maxHeight = `${next}px`;
      debugLog('expandMenuSheet: sheet maxHeight ->', sheet.style.maxHeight);
    }
  };

  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 150);
}

/** YouTube側が開いた三点メニューの listbox 要素を探す。DOM構造の版差に応じて複数セレクタを試す。 */
function findMenuListbox(): Element | null {
  const candidates: [string, string][] = [
    ['yt-list-view-model[role="menu"]', 'D'],  // 新UI(yt-lockup-view-model系カードのシート型メニュー)
    ['ytd-menu-popup-renderer tp-yt-paper-listbox', 'A'],
    ['tp-yt-paper-listbox[role="listbox"]', 'B'],
    ['ytd-menu-popup-renderer', 'C'],
  ];
  for (const [sel, label] of candidates) {
    for (const hit of document.querySelectorAll(sel)) {
      // 閉じた古いメニューがDOMに残留することがあるため、非表示のdropdown配下は除外
      const dropdown = hit.closest('tp-yt-iron-dropdown') as HTMLElement | null;
      if (dropdown && dropdown.style.display === 'none') continue;
      debugLog('findMenuListbox: matched pattern', label, sel);
      return hit;
    }
  }
  debugLog('findMenuListbox: no pattern matched');
  return null;
}

/**
 * カード内の三点メニューボタンのクリックを document 全体で捕捉し、
 * メニューが開いたタイミングで動的にブロック用の項目を注入する。
 * メニューは動的に生成されるため、クリック後に MutationObserver で
 * listbox の出現とネイティブ項目の構築完了を待ってから注入する
 * (空のlistboxへの注入はYouTube側の項目構築で上書き消去されるため)。
 * 注入後も監視を続け、消された場合は最大3回まで再注入する。
 * 2秒経過で監視を終了する。
 */
export function setupMenuInjector(onAdded: OnAdded): void {
  debugLog('setupMenuInjector: registered');

  document.addEventListener(
    'click',
    (e) => {
      const path = e.composedPath() as Element[];

      // カード要素を探す
      const card = path.find(
        (el): el is Element => el instanceof Element && typeof el.matches === 'function' && el.matches(CARD_SELECTOR)
      );
      if (!card) { debugLog('click: card not found in composedPath'); reset(); return; }
      if (isInsideAdContainer(card)) { debugLog('click: card is inside ad container, skip'); reset(); return; }

      // BUTTON要素を探す（三点メニューボタン）
      const button = path.find(
        (el): el is Element => el instanceof Element && el.tagName === 'BUTTON'
      ) as HTMLButtonElement | undefined;
      if (!button) { debugLog('click: card found but no BUTTON in composedPath, card:', card.tagName); reset(); return; }

      debugLog('button in card clicked, card:', card.tagName, 'aria-label:', button.getAttribute('aria-label') ?? '');

      reset();
      // 新UIはメニューDOMをカード間で使い回すため、前回注入した項目が
      // 残っていると古いカードの情報のままになる。必ず除去してから再注入する
      document.querySelectorAll('.ytblocker-item').forEach((el) => el.remove());
      pendingCard = card;

      const tryInject = () => {
        if (!pendingCard) return;
        const listbox = findMenuListbox();
        if (!listbox) return;

        // 空のlistboxに注入するとYouTube(Polymer)側の項目構築で上書き消去されるため、
        // ネイティブ項目が流し込まれるまで注入を待つ
        const nativeItem = listbox.querySelector(
          'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item, yt-list-item-view-model'
        );
        if (!nativeItem) {
          debugLog('tryInject: listbox found but no native items yet, waiting');
          return;
        }

        // 注入済みで生き残っていれば区切り線の重複チェックだけして終わり。消されていたら再注入(上限付き)
        if (listbox.querySelector('.ytblocker-item')) {
          updateSepVisibility(listbox);
          return;
        }
        if (injectAttempts >= 3) {
          debugLog('tryInject: inject attempts exhausted, giving up');
          reset();
          return;
        }
        injectAttempts++;
        debugLog('tryInject: injecting (attempt', injectAttempts, ')');
        injectItems(pendingCard, listbox, onAdded);
        expandMenuSheet(listbox);
        // 即resetせず監視を継続し、YouTube側に消された場合は次のmutationで再注入する。
        // 監視はcleanupTimerで終了する。
      };

      // メニューDOMが使い回される場合、再オープン時はノード追加が起きず
      // display切替(style属性変更)だけで表示されるため、childList監視では検出できない。
      // MutationObserverと並走して200ms間隔のポーリングでも同じ判定を回す(cleanupTimerで終了)。
      menuObserver = new MutationObserver(tryInject);
      menuObserver.observe(document.body, { childList: true, subtree: true });
      pollTimer = setInterval(tryInject, 200);
      debugLog('menuObserver: observing for card', card.tagName);

      cleanupTimer = setTimeout(() => {
        debugLog('cleanupTimer: 2s elapsed, stop watching menu');
        reset();
      }, 2000);
    },
    true
  );
}
