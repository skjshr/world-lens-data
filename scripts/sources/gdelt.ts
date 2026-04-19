// GDELT Doc API。15 分更新、キー不要、商用 OK。
// https://api.gdeltproject.org/api/v2/doc/doc
//
// 返す形は world-lens の NewsItem[]。見出し / URL / 発信時刻のみ保持（著作権配慮）。

import { fetchJson, writeJson } from "../lib/io.ts";
import { dedupeByHeadline } from "../lib/dedupe.ts";
import type { NewsItem } from "../lib/types.ts";

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;      // "20260418T093000Z"
  socialimage?: string;
  domain?: string;
  language?: string;     // "Japanese" / "English" 等
  sourcecountry?: string; // "Japan" / "United States" 等
  tone?: string | number;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

function parseSeenDate(s: string): string {
  // "20260418T093000Z" → "2026-04-18T09:30:00Z"
  if (!/^\d{8}T\d{6}Z$/.test(s)) return new Date().toISOString();
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
}

// 大雑把な言語→コード
function langCode(lang?: string): string {
  if (!lang) return "en";
  const l = lang.toLowerCase();
  if (l.startsWith("jap")) return "ja";
  if (l.startsWith("eng")) return "en";
  if (l.startsWith("chi")) return "zh";
  if (l.startsWith("kor")) return "ko";
  return lang;
}

// GDELT の sourcecountry は英語国名。ISO2 に粗く変換（主要国のみ、残りは unknown）
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "Japan": "JP",
  "United States": "US",
  "United Kingdom": "GB",
  "Germany": "DE",
  "France": "FR",
  "China": "CN",
  "South Korea": "KR",
  "India": "IN",
  "Brazil": "BR",
  "Australia": "AU",
};

function toNewsItem(a: GdeltArticle, idx: number): NewsItem {
  return {
    id: `gdelt-${a.seendate}-${idx}`,
    headline: a.title,
    sourceName: a.domain ?? "GDELT",
    sourceUrl: a.url,
    publishedAt: parseSeenDate(a.seendate),
    countryCode: COUNTRY_NAME_TO_CODE[a.sourcecountry ?? ""] ?? "XX",
    tone: typeof a.tone === "string" ? Number(a.tone) : a.tone,
    lang: langCode(a.language),
  };
}

async function fetchGdeltQuery(query: string, maxRecords: number): Promise<NewsItem[]> {
  const url =
    `https://api.gdeltproject.org/api/v2/doc/doc` +
    `?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&maxrecords=${maxRecords}&format=json&sort=DateDesc`;
  try {
    const body = await fetchJson<GdeltResponse>(url);
    return (body.articles ?? []).map(toNewsItem);
  } catch (e) {
    console.warn(`  ! GDELT query "${query}": ${(e as Error).message}`);
    return [];
  }
}

export async function fetchGdelt(): Promise<void> {
  console.log("• GDELT (news)…");
  // グローバルニュース（主要国、英語）。domain 多様性を広げて国の偏りを減らす:
  //   BBC(GB) / Reuters(GB) / NYT(US) / Bloomberg(US) / AP(US) / WSJ(US)
  //   Guardian(GB) / Al Jazeera(QA) / DW(DE) / France24(FR) / Le Monde(FR)
  //   South China Morning Post(HK) / Times of India(IN) / Straits Times(SG)
  const global = await fetchGdeltQuery(
    "sourcelang:english (" +
      [
        "domainis:bbc.co.uk",
        "domainis:reuters.com",
        "domainis:nytimes.com",
        "domainis:bloomberg.com",
        "domainis:apnews.com",
        "domainis:wsj.com",
        "domainis:theguardian.com",
        "domainis:aljazeera.com",
        "domainis:dw.com",
        "domainis:france24.com",
        "domainis:lemonde.fr",
        "domainis:scmp.com",
        "domainis:timesofindia.indiatimes.com",
        "domainis:straitstimes.com",
      ].join(" OR ") +
      ")",
    100,
  );
  // dedupe: 同じ事件が別 domain で多重に入るのを server 側で刈る。
  // GDELT は DateDesc で降順返却なので、最も早く出した domain が採用される。
  const globalDedup = dedupeByHeadline(global, (n) => n.headline);
  console.log(`  ↻ global dedupe: ${global.length} → ${globalDedup.length}`);
  // 取得失敗（0 件 = 429 / timeout）では既存 snapshot を上書きしない。
  //   以前は空配列を平気で書き込み、サイトから GDELT ニュースが消える事故が起きていた。
  //   レート制限は次回 cron（15 分後）で自然回復するので、前回値を残すのが安全。
  if (globalDedup.length > 0) {
    await writeJson("gdelt-global.json", globalDedup.slice(0, 80));
  } else {
    console.log("  ⏭ gdelt-global 取得 0 件、既存 snapshot を維持");
  }

  // 日本関連（日本語）
  const jp = await fetchGdeltQuery("sourcelang:japanese", 100);
  const jpDedup = dedupeByHeadline(jp, (n) => n.headline);
  console.log(`  ↻ jp dedupe: ${jp.length} → ${jpDedup.length}`);
  if (jpDedup.length > 0) {
    await writeJson("gdelt-jp.json", jpDedup.slice(0, 80));
  } else {
    console.log("  ⏭ gdelt-jp 取得 0 件、既存 snapshot を維持");
  }
}
