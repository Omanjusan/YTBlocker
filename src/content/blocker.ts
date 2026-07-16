import { addEntry, addLogs, generateId } from '../shared/storage';
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

/**
 * yt-lockup-view-model のメタデータ行からプレーンテキストのチャンネル名を構造判定で取得する。
 * チャンネル名行は「Delimiter(•)を含まない行」、再生数・日付行は「Delimiterを含む行」という
 * 実測で確認した構造差を使う。チャンネル名行が省略されるカード(chページの自ch動画など)や
 * メン限カード(「◯週間前 に配信済み」のみでDelimiterなし)では誤採用せず空文字を返す。
 * クラス命名はYouTubeの版によってwiz形式(kebab-case)とcamelCase形式の両方が存在する。
 */
function getMetadataChannelText(card: Element): string {
  const meta = deepQuery(card, 'yt-content-metadata-view-model');
  if (!meta) return '';
  const rowSel = '.yt-content-metadata-view-model-wiz__metadata-row, .ytContentMetadataViewModelMetadataRow';
  const delimSel = '.yt-content-metadata-view-model-wiz__delimiter, .ytContentMetadataViewModelDelimiter';
  const rows = Array.from(meta.querySelectorAll(rowSel));
  if (rows.length < 2) return '';
  if (rows[0].querySelector(delimSel)) return '';
  if (!rows.slice(1).some((row) => row.querySelector(delimSel))) return '';
  return rows[0].textContent?.trim() ?? '';
}

/** 動画カード要素からチャンネル名を取得する。getVideoTitle と同様に複数構造をフォールバックで試す。 */
export function getChannelName(card: Element): string {
  const candidates = [
    'ytd-channel-name a',
    '#channel-name a',
    'ytd-channel-name yt-formatted-string',
    '#channel-name yt-formatted-string',
    'a[href*="/@"]',               // 新構造: @ハンドル形式(新UIカードのch名リンクもここで拾える)
    'a[href*="/channel/"]',
    'a[href*="/c/"]',
  ];
  for (const sel of candidates) {
    const text = deepQuery(card, sel)?.textContent?.trim();
    if (text) return text;
  }
  return getMetadataChannelText(card);
}

/**
 * 表示中ページが所有するチャンネルの名前を取得する。チャンネルページ以外では空文字。
 * chページの自ch動画カードはチャンネル名を持たないため、NG登録時の補完に使う(登録時のみ。
 * applyBlockListの非表示判定には使わない=NG済みchのページを開いてもカードは消さない)。
 */
export function getPageChannelName(): string {
  if (!/^\/(@|channel\/)/.test(location.pathname)) return '';
  const fromH1 = document.querySelector('yt-page-header-view-model h1')?.textContent?.trim();
  if (fromH1) return fromH1;
  return document.title.replace(/ - YouTube$/, '').trim();
}

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
