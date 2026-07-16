import { addEntry, addLogs, generateId } from '../shared/storage';
import { debugLog } from '../shared/debug';
import { showToast } from './toast';

import type { BlockEntry, BlockLog } from '../shared/types';

export const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-reel-item-renderer',
  'ytd-shorts-lockup-view-model',     // 旧バージョン
  'ytm-shorts-lockup-view-model-v2',  // 検索結果ページ用 ← これが抜けてた
  'yt-lockup-view-model',             // 新UI汎用カード(watchページ関連動画など)
].join(', ');

/**
 * 広告枠のコンテナ要素。yt-lockup-view-model 等の通常カードと同じタグが
 * 広告枠内でも使われるため、これらの子孫にあるカードは処理対象から除外する。
 * 広告DOMを削除するとYouTube側の広告完了判定が壊れ、無限リロードを
 * 引き起こすことが実機検証で確認された。
 */
const AD_CONTAINER_SELECTOR = [
  'ytd-ad-slot-renderer',
  'ytd-in-feed-ad-layout-renderer',
  'ytd-promoted-video-renderer',
  'ytd-display-ad-renderer',
  'ytd-ad-renderer',
  'ytd-companion-slot-renderer',
].join(', ');

/** カードが広告枠の子孫かどうかを判定する。 */
export function isInsideAdContainer(card: Element): boolean {
  return !!card.closest(AD_CONTAINER_SELECTOR);
}

/**
 * Shadow DOM を再帰的に貫通して querySelector する。
 * YouTube の新UI(yt-lockup-view-model 等)はタイトル/チャンネル名が
 * shadow root の中に入っていることがあるため、通常の querySelector だけでは届かない。
 */
function deepQuery(root: Element | ShadowRoot, selector: string): Element | null {
  const hit = (root as Element).querySelector?.(selector);
  if (hit) return hit;
  for (const el of (root as Element).querySelectorAll?.('*') ?? []) {
    if (el.shadowRoot) {
      const found = deepQuery(el.shadowRoot as unknown as Element, selector);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 動画カード要素からタイトルを取得する。
 * YouTube側のDOM構造が新旧複数存在するため、上から順に候補セレクタを試し
 * 最初にヒットしたテキストを採用するフォールバック方式にしている。
 */
export function getVideoTitle(card: Element): string {
  const candidates = [
    'h3 a#video-title',            // 旧構造
    'a#video-title',
    '#video-title',
    'h3 .title',
    'h3 a[href*="/watch?v="]',     // 新構造: h3 内のタイトルリンク
    'h3 a[href*="/shorts/"]',      // 新構造: h3 内のショートリンク
    'h3',                          // 新構造フォールバック
  ];
  for (const sel of candidates) {
    const text = deepQuery(card, sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

/** 動画カード要素からチャンネル名を取得する。getVideoTitle と同様に複数構造をフォールバックで試す。 */
export function getChannelName(card: Element): string {
  const candidates = [
    'ytd-channel-name a',
    '#channel-name a',
    'ytd-channel-name yt-formatted-string',
    '#channel-name yt-formatted-string',
    'a[href*="/@"]',               // 新構造: @ハンドル形式
    'a[href*="/channel/"]',
    'a[href*="/c/"]',
    // yt-lockup-view-model: チャンネル名がリンクではなくプレーンテキストで
    // メタデータ行(1行目)に入っている。クラス命名はYouTubeの版によって
    // wiz形式(kebab-case)とcamelCase形式の両方が存在する
    '.yt-content-metadata-view-model-wiz__metadata-text',
    '.ytContentMetadataViewModelMetadataText',
    'yt-content-metadata-view-model span[role="text"]',
  ];
  for (const sel of candidates) {
    const text = deepQuery(card, sel)?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

// ---- ここから一時計測コード(チャンネル名抽出調査用、調査完了後に削除) ----

/** shadow DOMも貫通して selector に一致する全要素を集める。 */
function collectDeep(root: Element | ShadowRoot, selector: string, out: Element[]): void {
  (root as Element).querySelectorAll?.(selector).forEach((el) => out.push(el));
  for (const el of (root as Element).querySelectorAll?.('*') ?? []) {
    if (el.shadowRoot) collectDeep(el.shadowRoot as unknown as Element, selector, out);
  }
}

/** カード内のメタデータブロックのDOM構造とチャンネルリンク候補をログする。 */
export function dumpCardMetadata(card: Element): void {
  debugLog('[meta] card:', card.tagName);

  const metas: Element[] = [];
  collectDeep(card, 'yt-content-metadata-view-model', metas);
  debugLog('[meta] metadata blocks:', metas.length);
  metas.forEach((meta, mi) => {
    Array.from(meta.children).forEach((row, ri) => {
      debugLog(`[meta] block${mi} row${ri}:`, (row as HTMLElement).outerHTML.slice(0, 500));
    });
  });

  const links: Element[] = [];
  collectDeep(card, 'a[href*="/@"], a[href*="/channel/"]', links);
  debugLog('[meta] channel-ish links:', links.length);
  links.forEach((a, i) => {
    debugLog(`[meta] link${i}:`, a.getAttribute('href'), '| text:', a.textContent?.trim().slice(0, 40) || '-');
  });
}

// ---- 一時計測コードここまで ----

/**
 * ルール登録・ログ保存・カード除去・トースト表示までを一括で行う。
 * menu-injector(三点メニュー)から呼ばれる。
 */
export async function blockAndLog(
  card: Element,
  target: 'video' | 'channel',
  value: string,
  title: string,
  channel: string,
  onAdded: () => void
): Promise<void> {
  const id = generateId();
  await addEntry({ id, target, matchType: 'exact', value, createdAt: Date.now() });
  await addLogs([{ videoTitle: title, channelName: channel, matchedValue: value, blockedAt: Date.now() }]);
  card.remove();
  onAdded();
  showToast(value, id);
}

/** カード要素がショート動画かどうかを判定する。 */
export function isShorts(card: Element): boolean {
  if (card.tagName === 'YTD-REEL-ITEM-RENDERER') return true;
  return !!card.querySelector('a[href*="/shorts/"]');
}

/**
 * value が entry にマッチするか判定する。
 * regex の場合、value が `/pattern/flags` 形式ならパターン+フラグとして、
 * そうでなければ文字列全体を正規表現として解釈する。不正な正規表現は false 扱い。
 */
function entryMatches(value: string, entry: BlockEntry): boolean {
  if (!value) return false;
  if (entry.matchType === 'exact') return value === entry.value;
  try {
    const m = entry.value.match(/^\/(.+)\/([gimsuy]*)$/);
    return m ? new RegExp(m[1], m[2]).test(value) : new RegExp(entry.value).test(value);
  } catch {
    return false;
  }
}

/**
 * 現在DOM上にある全カードにブロックルールを適用し、マッチしたものを削除する。
 * ショート一括ブロックが有効な場合はルールに関わらずショートを先に除去する。
 * @returns 実際にブロックされた項目のログ配列(呼び出し側で storage に保存する)。
 */
export function applyBlockList(entries: BlockEntry[], blockShorts: boolean): BlockLog[] {
  const logged: BlockLog[] = [];

  document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
    // ytd-rich-item-renderer の中に yt-lockup-view-model が入る等、カード同士が
    // 入れ子になることがある。親の除去で切り離された子を処理するとログが
    // 二重記録されるため、既にDOMから外れたカードはスキップする
    if (!card.isConnected) return;

    // 広告枠内のカードは削除しない(YouTube側の広告完了判定を壊し、
    // 無限リロードを引き起こすため)
    if (isInsideAdContainer(card)) return;

    if (blockShorts && isShorts(card)) {
      card.remove();
      return;
    }

    if (entries.length === 0) return;

    const title   = getVideoTitle(card);
    const channel = getChannelName(card);

    const matchedEntry = entries.find((entry) => {
      if (entry.target === 'video')   return entryMatches(title, entry);
      if (entry.target === 'channel') return entryMatches(channel, entry);
      return entryMatches(title, entry) || entryMatches(channel, entry);
    });

    if (matchedEntry) {
      card.remove();
      logged.push({ videoTitle: title, channelName: channel, matchedValue: matchedEntry.value, blockedAt: Date.now() });
    }
  });

  return logged;
}
