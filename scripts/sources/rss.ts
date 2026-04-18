// 日本語 RSS 集約。GDELT は日本語記事が薄いので補完。
// 公開 RSS のみ、見出し・URL・発信時刻のみ保持。

import { XMLParser } from "fast-xml-parser";
import { fetchText, writeJson } from "../lib/io.ts";
import type { NewsItem } from "../lib/types.ts";

interface RssSource {
  name: string;    // 表示名
  url: string;
  lang: string;
}

const SOURCES: RssSource[] = [
  { name: "NHK",     url: "https://www3.nhk.or.jp/rss/news/cat0.xml",           lang: "ja" },
  { name: "NHK経済", url: "https://www3.nhk.or.jp/rss/news/cat5.xml",           lang: "ja" },
  { name: "NHK国際", url: "https://www3.nhk.or.jp/rss/news/cat6.xml",           lang: "ja" },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

interface RssItem {
  title?: string | { "#text"?: string };
  link?: string;
  pubDate?: string;
  description?: string;
}

function textOf(v: RssItem["title"]): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return (v["#text"] as string) ?? "";
  return "";
}

function parseDate(s?: string): string {
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function fetchRssJa(): Promise<void> {
  console.log("• RSS (ja)…");
  const items: NewsItem[] = [];

  for (const src of SOURCES) {
    try {
      const xml = await fetchText(src.url);
      const parsed = parser.parse(xml) as {
        rss?: { channel?: { item?: RssItem | RssItem[] } };
        "rdf:RDF"?: { item?: RssItem | RssItem[] };
      };
      const rawItems =
        parsed.rss?.channel?.item ??
        parsed["rdf:RDF"]?.item ??
        [];
      const list = Array.isArray(rawItems) ? rawItems : [rawItems];

      list.slice(0, 30).forEach((it, idx) => {
        const title = textOf(it.title).trim();
        const link = it.link ?? "";
        if (!title || !link) return;
        items.push({
          id: `${src.name}-${idx}-${link.slice(-24)}`,
          headline: title,
          sourceName: src.name,
          sourceUrl: link,
          publishedAt: parseDate(it.pubDate),
          countryCode: "JP",
          lang: src.lang,
        });
      });
    } catch (e) {
      console.warn(`  ! ${src.name}: ${(e as Error).message}`);
    }
  }

  // 新しい順
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  await writeJson("rss-ja.json", items.slice(0, 100));
}
