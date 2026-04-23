// Wikipedia Pageviews API + OnThisDay API。キー不要、無料。
// https://wikimedia.org/api/rest_v1/
//
// Pageviews: 国別の人気記事 TOP 10
// OnThisDay: 今日の歴史イベント

import { fetchJson, writeJson, sleep } from "../lib/io.ts";
import { COUNTRY_META } from "../lib/countries.ts";

// --- Pageviews: 国別 TOP ---

interface WikiPageview {
  article: string;
  views: number;
  rank: number;
}

interface WikiPageviewsResponse {
  items?: Array<{
    articles?: WikiPageview[];
  }>;
}

// Wikimedia API の国コード（ISO 3166-1 alpha-2 の一部は異なる）
const WIKI_COUNTRY_MAP: Record<string, string> = {
  JP: "JP", US: "US", GB: "GB", DE: "DE", FR: "FR",
  CN: "CN", KR: "KR", IN: "IN", BR: "BR", AU: "AU",
};

// Wikipedia の言語コード
const WIKI_LANG_MAP: Record<string, string> = {
  JP: "ja", US: "en", GB: "en", DE: "de", FR: "fr",
  CN: "zh", KR: "ko", IN: "en", BR: "pt", AU: "en",
};

interface WikiTrendItem {
  rank: number;
  title: string;
  views: number;
  url: string;
  delta: number | null;
}

export async function fetchWikipediaPageviews(): Promise<void> {
  console.log("• Wikipedia Pageviews (top articles per country)…");
  const result: Record<string, WikiTrendItem[]> = {};

  // Pageviews API は 1-2 日遅れでデータが入る。2日前から試行して最初に成功した日を使う
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  const year = twoDaysAgo.getFullYear();
  const month = String(twoDaysAgo.getMonth() + 1).padStart(2, "0");
  const day = String(twoDaysAgo.getDate()).padStart(2, "0");

  for (const [code, wikiCode] of Object.entries(WIKI_COUNTRY_MAP)) {
    try {
      const lang = WIKI_LANG_MAP[code] ?? "en";
      const url =
        `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country` +
        `/${wikiCode}/all-access/${year}/${month}/${day}`;

      const body = await fetchJson<WikiPageviewsResponse>(url);
      const articles = body?.items?.[0]?.articles ?? [];

      // "Main_Page" や "Special:" 等のシステムページを除外
      const filtered = articles
        .filter((a) => !a.article.startsWith("Special:") && a.article !== "Main_Page" && a.article !== "メインページ")
        .slice(0, 10);

      result[code] = filtered.map((a, i) => ({
        rank: i + 1,
        title: a.article.replace(/_/g, " "),
        views: a.views,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(a.article)}`,
        delta: null,
      }));

      console.log(`  ${code}: ${result[code].length} articles`);
    } catch (e) {
      console.warn(`  ! Wikipedia ${code}: ${(e as Error).message}`);
    }
    await sleep(200);
  }

  if (Object.keys(result).length > 0) {
    await writeJson("wikipedia-pageviews.json", result);
  }
}

// --- OnThisDay ---

interface WikiOnThisDay {
  text: string;
  year: number;
  pages?: Array<{ title: string }>;
}

interface WikiOnThisDayResponse {
  events?: WikiOnThisDay[];
  births?: WikiOnThisDay[];
  selected?: WikiOnThisDay[];
}

interface HistoryEventItem {
  year: number;
  text: string;
  category: string;
}

export async function fetchWikipediaOnThisDay(): Promise<void> {
  console.log("• Wikipedia OnThisDay…");
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const result: Record<string, HistoryEventItem[]> = {};

  for (const lang of ["ja", "en"]) {
    try {
      // /events/ エンドポイントで歴史イベントのみ取得（/all/ はオブジェクト形式で扱いにくい）
      const url = `https://api.wikimedia.org/feed/v1/wikipedia/${lang}/onthisday/events/${month}/${day}`;
      const body = await fetchJson<{ events?: WikiOnThisDay[] }>(url);

      const events = (body?.events ?? [])
        .filter((e) => e.text && e.year)
        .sort((a, b) => b.year - a.year)
        .slice(0, 8)
        .map((e) => ({
          year: e.year,
          text: e.text,
          category: "other" as string,
        }));

      result[lang] = events;
      console.log(`  ${lang}: ${events.length} events`);
    } catch (e) {
      console.warn(`  ! OnThisDay ${lang}: ${(e as Error).message}`);
    }
    await sleep(200);
  }

  if (Object.keys(result).length > 0) {
    await writeJson("wikipedia-onthisday.json", result);
  }
}
