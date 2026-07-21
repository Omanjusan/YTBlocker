/** true にするとビルド後の拡張機能が devtools コンソールにデバッグログを出力する。 */
export const DEBUG = false;

/** DEBUG が true のときだけ `[Youtube Keyword Blocker]` プレフィックス付きでログ出力する。 */
export function debugLog(...args: unknown[]): void {
  if (!DEBUG) return;
  console.log('[Youtube Keyword Blocker]', ...args);
}
