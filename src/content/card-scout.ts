import { CARD_SELECTOR } from './blocker';

/**
 * 観測モード(スカウト)。
 * 「動画へのリンクを内包しているのに CARD_SELECTOR で捕捉できていない
 * カスタム要素」を探し、devtools コンソールに報告する調査専用モジュール。
 * ブロック動作には一切関与しない(報告のみ)。
 *
 * コンソールのフィルタ欄に「SCOUT」と入力すれば観測ログだけに絞れる。
 */

/** 報告済みの祖先チェーン。同じ構造をセッション中に二度報告しないための重複抑制。 */
const seen = new Set<string>();

/** YouTube のカスタム要素とみなすタグ名プレフィックス。 */
const CUSTOM_TAG = /^(ytd|yt|ytm)-/;

/** 報告するチェーンに含める祖先カスタム要素の最大数(内側から数える)。 */
const CHAIN_MAX = 4;

/** 動画視聴ページ/ショートへのリンクを指すセレクタ。 */
const VIDEO_LINK_SELECTOR = 'a[href*="/watch?"], a[href*="/shorts/"]';

/**
 * Shadow DOM 境界を越えて親要素を辿る。
 * shadow root 直下まで来たら host 要素へ抜ける。
 */
function parentOf(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Shadow DOM を再帰的に降りながら動画リンクを収集する。 */
function collectVideoLinks(root: ParentNode, out: Element[]): void {
  root.querySelectorAll(VIDEO_LINK_SELECTOR).forEach((a) => out.push(a));
  root.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot) collectVideoLinks(el.shadowRoot, out);
  });
}

/**
 * ドキュメント全体を走査し、既知カードに属さない動画リンクの
 * 祖先カスタム要素チェーンをコンソールに報告する。
 * 観測モード ON のときだけ呼び出される想定。
 */
export function scoutScan(): void {
  const links: Element[] = [];
  collectVideoLinks(document, links);

  links.forEach((link) => {
    const chain: string[] = [];
    let covered = false;

    // ルートまで辿り、途中で既知カードに包まれていれば対応済みとして除外
    for (let el: Element | null = parentOf(link); el; el = parentOf(el)) {
      if (el.matches(CARD_SELECTOR)) { covered = true; break; }
      const tag = el.tagName.toLowerCase();
      if (CUSTOM_TAG.test(tag) && chain.length < CHAIN_MAX) chain.push(tag);
    }
    if (covered || chain.length === 0) return;

    const key = chain.join(' < ');
    if (seen.has(key)) return;
    seen.add(key);
    console.log(`[YTBlocker:SCOUT] 未対応カード候補: ${key} @ ${location.pathname}`);
  });
}
