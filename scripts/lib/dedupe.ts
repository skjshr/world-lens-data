// 見出しベースの server-side 重複排除。
//
// 設計意図:
//   - 複数ソース（GDELT / NHK / BBC / DW / Al Jazeera 等）を束ねると同じ事件が必ず多重に入る。
//     これを client 側だけで弾くと「どのソースが落ちるか」がタブを開くたびに変わり、
//     BI カードの順位が安定しない。publish 段で決定的に落とす。
//   - 完全一致ではなく「正規化 + 先頭 48 字で比較」する shingle 風のやり方。
//     cosine 類似度や MinHash までは要らない。見出しは冒頭が一番強い情報を持ち、
//     そこが一致していれば派生の言い換えとみなして実用上問題ない。
//   - 残すのは「より早いもの / より信頼できるソース」。tier の高いものが残るよう、
//     入力順は呼び出し側で事前ソート済み前提にする（scripts/fetch.ts でコントロール）。
//
// なぜ cosine 類似度を選ばなかったか:
//   - Node 22 の stdlib 範囲で cosine をやるには vectorization が要り、
//     TF-IDF 辞書を都度作ると 15 分 cron の中で CPU 時間がかさむ。
//   - 正規化 prefix 比較は O(n) + 定数で済み、snapshot 規模（数百件）で十分。
//   - より精密な判定が必要になったら shingle + Jaccard を後付けできる、その下地になる。

/** 見出しを正規化: 小文字化 / 記号・空白除去 / 全角半角を片寄せ */
function normalizeHeadline(s: string): string {
  return s
    .toLowerCase()
    // 全角英数 → 半角
    .replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    // 記号・空白・句読点を全削除（意味に影響しない差異を吸収）
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    // zero-width や制御文字
    .replace(/[\u200B-\u200F\uFEFF]/g, "");
}

/**
 * 見出しの先頭 48 字 (正規化後) をキーに重複を弾く。
 * 先に出てきたものを採用する（入力順 = 信頼度順が望ましい）。
 *
 * @param items     NewsItem 配列（順番が優先度）
 * @param getText   キー文字列の取り出し（見出し or title 等）
 * @param keyLength 何文字で shingle を作るか。48 は日本語 2 文節 / 英語 7-9 語相当
 */
export function dedupeByHeadline<T>(
  items: T[],
  getText: (item: T) => string,
  keyLength = 48,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const key = normalizeHeadline(getText(it) ?? "").slice(0, keyLength);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
