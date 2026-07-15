// ツールバーアイコンのポップアップ: 登録済みルール件数の表示とオプションページへの導線のみを担う
import { getEntries } from '../shared/storage';
import { applyStaticI18n, getLanguage } from '../shared/i18n';

const countEl = document.getElementById('count')!;
const openBtn = document.getElementById('open-options')!;

getLanguage().then(applyStaticI18n);

/** ポップアップを開いた時点の登録済みNGエントリ件数を取得し、バッジ表示する。 */
getEntries().then((entries) => {
  countEl.textContent = String(entries.length);
});

/** 「設定」ボタン押下でオプションページを新規タブで開く。 */
openBtn.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});
