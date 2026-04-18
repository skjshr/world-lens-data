// GDELT Doc API。15 分更新、キー不要、商用 OK。
// https://api.gdeltproject.org/api/v2/doc/doc
//
// 返す形は world-lens の NewsItem[]。見出し / URL / 発信時刻のみ保持（著作権配慮）。

import { fetchJson, writeJson } from "../lib/io.ts";
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
  // グローバルニュース（主要国、英語）
  const global = await fetchGdeltQuery(
    "sourcelang:english (domainis:bbc.co.uk OR domainis:reuters.com OR domainis:nytimes.com OR domainis:bloomberg.com)",
    75,
  );
  await writeJson("gdelt-global.json", global);

  // 日本関連（日本語）
  const jp = await fetchGdeltQuery("sourcelang:japanese", 75);
  await writeJson("gdelt-jp.json", jp);
}
