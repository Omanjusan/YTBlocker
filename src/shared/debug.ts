/** true にするとビルド後の拡張機能が devtools コンソールにデバッグログを出力する。 */
export const DEBUG = true; // TODO(diag): チャンネル名抽出調査が終わったらfalseへ戻す

/** DEBUG が true のときだけ `[YTBlocker]` プレフィックス付きでログ出力する。 */
export function debugLog(...args: unknown[]): void {
  if (!DEBUG) return;
  console.log('[YTBlocker]', ...args);
}
