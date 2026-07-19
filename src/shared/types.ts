/** ブロックルールの適用対象。'both' は動画タイトル・チャンネル名のどちらか一致すればブロック。 */
export type MatchTarget = 'video' | 'channel' | 'both';
/** 'exact' は完全一致、'partial' は部分一致、'regex' は正規表現マッチ(`/pattern/flags` 形式にも対応)。 */
export type MatchType = 'exact' | 'partial' | 'regex';

/** ユーザーが登録したブロックルール1件分。 */
export interface BlockEntry {
  id: string;
  target: MatchTarget;
  matchType: MatchType;
  /** マッチ対象の文字列(完全一致テキスト or 正規表現パターン)。 */
  value: string;
  createdAt: number;
}

/** ルール1件の保存形式。オブジェクトではなくタプルにしてキー名分のバイトを節約する。 [id, code, value, createdAt]
 * code は target/matchType を合成した数値(storage.ts の packTargetMatch を参照)。 */
export type StoredEntry = [string, number, string, number];

/** 削除済みルールの墓標。 [id, deletedAt]
 * 同期では「キーの消失」に意味を持たせず、墓標の存在だけが削除を意味する(誤削除の伝搬防止)。 */
export type Tombstone = [string, number];

/** 実際にブロックが発動した際の履歴1件分(オプションページの「ログ」欄に表示)。 */
export interface BlockLog {
  videoTitle: string;
  channelName: string;
  /** どのルールにマッチしてブロックされたかを示す値。 */
  matchedValue: string;
  blockedAt: number;
}
