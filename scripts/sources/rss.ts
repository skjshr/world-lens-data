// 多言語 RSS 集約。
//
// 設計意図:
//   - GDELT は domain ベースで英語主要紙を拾えるが、言語分布に偏りが出やすい。
//     RSS は公式配信で品質が担保されており、countryCode / tier を確定値で付けられる。
//   - 各ソースに countryCode を割り当てる: publisher の本拠地。NewsItem.countryCode は
//     「発信地」に使われる（news タブの pulse ring は発信地で光る）ので、
//     publisher の国を入れるのがセマンティクスに合う。
//   - tier は現状 NewsItem の型に無い（types.ts 互換維持）が、並び順制御で同等に扱う:
//     信頼度の高いソースほど前に並べてから dedupe すると、残るものが自然に高品質になる。
//
// 新規ソース追加時の手順:
//   1. RSS URL が安定配信か確認（HEAD / GET 200 が返る、更新されている）
//   2. publisher の本拠地 ISO2 を countryCode に入れる
//   3. priority を 1〜10 で入れる（小さいほど優先、同順位は URL 順）
//   4. lang は表示用。NewsCard が lang ベースで切替をする想定

import { XMLParser } from "fast-xml-parser";
import { fetchText, writeJson } from "../lib/io.ts";
import { dedupeByHeadline } from "../lib/dedupe.ts";
import type { NewsItem } from "../lib/types.ts";

interface RssSource {
  name: string;        // sourceName に入る表示名
  url: string;
  lang: string;
  countryCode: string; // publisher 本拠地の ISO2
  priority: number;    // 小さいほど優先（dedupe 時に残る）
}

// 信頼度・国際性の高い順に並べる。dedupe が先頭優先なので、ここが実質のランキング。
//   - 1 位: 日本の一次（NHK）。日本語記事が dominant な地位なので上位に。
//   - 2 位: 海外主要英語メディア（BBC / NHK World / DW / Al Jazeera）
//   - 3 位: 英字紙（Guardian / France 24）
// 配信が 10+ 分ズレることは普通にあるので、新しさより信頼性を優先する（早さは GDELT 側の仕事）。
const SOURCES: RssSource[] = [
  // 日本の NHK（日本語）
  { name: "NHK",     url: "https://www3.nhk.or.jp/rss/news/cat0.xml", lang: "ja", countryCode: "JP", priority: 1 },
  { name: "NHK経済", url: "https://www3.nhk.or.jp/rss/news/cat5.xml", lang: "ja", countryCode: "JP", priority: 1 },
  { name: "NHK国際", url: "https://www3.nhk.or.jp/rss/news/cat6.xml", lang: "ja", countryCode: "JP", priority: 1 },

  // 国際主要（英語）— 国別に多様性を広げる目的
  //   NHK World English は公式 RSS フィードが見つからない（404）ため外した。
  //   代替として日本発の国際発信は NHK 国際（JP, ja）＋ GDELT の日本語クエリでカバー。
  { name: "BBC World",       url: "https://feeds.bbci.co.uk/news/world/rss.xml",                          lang: "en", countryCode: "GB", priority: 2 },
  { name: "DW",              url: "https://rss.dw.com/rdf/rss-en-all",                                    lang: "en", countryCode: "DE", priority: 2 },
  { name: "Al Jazeera",      url: "https://www.aljazeera.com/xml/rss/all.xml",                            lang: "en", countryCode: "QA", priority: 2 },
  { name: "France 24",       url: "https://www.france24.com/en/rss",                                      lang: "en", countryCode: "FR", priority: 3 },
  { name: "The Guardian",    url: "https://www.theguardian.com/world/rss",                                lang: "en", countryCode: "GB", priority: 3 },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

interface RssItem {
  title?: string | { "#text"?: string };
  link?: string | { "@_href"?: string };
  pubDate?: string;
  "dc:date"?: string;   // RDF 形式
  published?: string;   // Atom 形式
  updated?: string;
  description?: string;
}

function textOf(v: RssItem["title"]): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in v) return (v["#text"] as string) ?? "";
  return "";
}

function linkOf(v: RssItem["link"]): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "@_href" in v) return (v["@_href"] as string) ?? "";
  return "";
}

function parseDate(s?: string): string {
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export async function fetchRssJa(): Promise<void> {
  // 関数名は既存互換で残す（fetch.ts が import している）が、実体は「ja 限定」ではなく
  // 国際多言語ソースもまとめて取る。出力ファイル名も rss-ja.json のまま（client 側が参照中）。
  console.log(`• RSS (${SOURCES.length} sources)…`);
  const items: NewsItem[] = [];

  // 信頼度順で回す → dedupe が先優先なので、同じネタがあれば信頼度高いソースが残る
  const sorted = [...SOURCES].sort((a, b) => a.priority - b.priority);

  for (const src of sorted) {
    try {
      const xml = await fetchText(src.url);
      const parsed = parser.parse(xml) as {
        rss?: { channel?: { item?: RssItem | RssItem[] } };
        "rdf:RDF"?: { item?: RssItem | RssItem[] };
        feed?: { entry?: RssItem | RssItem[] };  // Atom
      };
      const rawItems =
        parsed.rss?.channel?.item ??
        parsed["rdf:RDF"]?.item ??
        parsed.feed?.entry ??
        [];
      const list = Array.isArray(rawItems) ? rawItems : [rawItems];

      let added = 0;
      list.slice(0, 30).forEach((it, idx) => {
        const title = textOf(it.title).trim();
        const link = linkOf(it.link);
        if (!title || !link) return;
        items.push({
          id: `${src.name}-${idx}-${link.slice(-24)}`,
          headline: title,
          sourceName: src.name,
          sourceUrl: link,
          publishedAt: parseDate(it.pubDate ?? it["dc:date"] ?? it.published ?? it.updated),
          countryCode: src.countryCode,
          lang: src.lang,
        });
        added++;
      });
      console.log(`  ✓ ${src.name}: ${added}`);
    } catch (e) {
      console.warn(`  ! ${src.name}: ${(e as Error).message}`);
    }
  }

  // 重複排除（正規化見出し先頭 48 字でショートサーキット）。
  // items は priority 順にソース単位で並んでいるので、信頼度の高いほうが残る。
  const deduped = dedupeByHeadline(items, (n) => n.headline);
  console.log(`  ↻ dedupe: ${items.length} → ${deduped.length}`);

  // 新しい順に並べ替えてから 100 件に絞る（client は BI カードで新しい順を期待）
  deduped.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  await writeJson("rss-ja.json", deduped.slice(0, 100));
}
