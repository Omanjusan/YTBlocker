/** ツールバーアイコンのクリックでオプションページを新規タブで開く。 */
browser.browserAction.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});
