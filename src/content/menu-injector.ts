import { blockAndLog, CARD_SELECTOR, getChannelName, getVideoTitle } from './blocker';
import { debugLog } from '../shared/debug';

type OnAdded = () => void;

let pendingCard: Element | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let menuObserver: MutationObserver | null = null;
let injectAttempts = 0;

/** 三点メニュー監視の途中状態(監視中のカード・MutationObserver・タイムアウト)を全て破棄する。 */
function reset(): void {
  if (cleanupTimer !== null) clearTimeout(cleanupTimer);
  menuObserver?.disconnect();
  menuObserver = null;
  pendingCard = null;
  cleanupTimer = null;
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

      menuObserver = new MutationObserver(() => {
        if (!pendingCard) return;
        const listbox = findMenuListbox();
        if (!listbox) return;

        // 空のlistboxに注入するとYouTube(Polymer)側の項目構築で上書き消去されるため、
        // ネイティブ項目が流し込まれるまで注入を待つ
        const nativeItem = listbox.querySelector(
          'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item, yt-list-item-view-model'
        );
        if (!nativeItem) {
          debugLog('menuObserver: listbox found but no native items yet, waiting');
          return;
        }

        // 注入済みで生き残っていれば何もしない。消されていたら再注入(上限付き)
        if (listbox.querySelector('.ytblocker-item')) return;
        if (injectAttempts >= 3) {
          debugLog('menuObserver: inject attempts exhausted, giving up');
          reset();
          return;
        }
        injectAttempts++;
        debugLog('menuObserver: injecting (attempt', injectAttempts, ')');
        injectItems(pendingCard, listbox, onAdded);
        // 即resetせず監視を継続し、YouTube側に消された場合は次のmutationで再注入する。
        // 監視はcleanupTimerで終了する。
      });

      menuObserver.observe(document.body, { childList: true, subtree: true });
      debugLog('menuObserver: observing for card', card.tagName);

      cleanupTimer = setTimeout(() => {
        debugLog('cleanupTimer: 2s elapsed, stop watching menu');
        reset();
      }, 2000);
    },
    true
  );
}
