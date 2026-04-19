// admin2 (都道府県下位 = 市区町村 / county / prefecture sub-division 等) の slim GeoJSON を
// 国別に生成する bulk build スクリプト。
//
// 設計意図:
//   - mundeye 本体（world-lens repo）は admin2 URL を `admin2-urls.ts` から解決する設計。
//     ここで生成した `snapshots/admin2/{ISO2}.geojson` を jsdelivr 経由で配信すれば、
//     本体コード側は URL を足すだけで lazy load が動く。
//   - 原データは geoBoundaries の gbOpen（OSM 由来、CC-BY-SA）。GADM 5 よりライセンス摩擦が
//     少なく、API 経由で各国の gjDownloadURL を拾えるので自動化しやすい。
//   - simplify tolerance は 0.005（~500m）で、地球儀ズーム時の可読性と転送量のバランスを取る。
//     完全精度の元データは JP で 6MB+ あるので、simplified 版でも最終 500KB-1MB まで絞る。
//
// 踏んではいけない地雷:
//   - geoBoundaries の gjDownloadURL は github.com/wmgeolab/geoBoundaries の commit hash 固定パスで
//     返る。jsdelivr 経由だと LFS ポインタしか降ってこない（実データは LFS 管理）。
//     必ず API を叩いて毎回 gjDownloadURL を解決し、そちらから取得する。
//   - properties は `shapeName` / `shapeID` の 2 つだけ残して他を落とす（80% 減）。本体 UI は
//     名前表示にしか使わない、抑えないと転送量が無駄。
//
// 現状のターゲット国:
//   - JP（都道府県 → 郡/市）を最初の 1 国として実装。他国は URL 追加で順次対応。

import {
  feature,
  featureCollection,
  type Feature,
  type FeatureCollection,
  type Geometry,
  type Polygon,
  type MultiPolygon,
} from "@turf/helpers";
import simplify from "@turf/simplify";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { fetchJson, fetchText } from "../lib/io.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../../snapshots/admin2");

/**
 * ISO2 → ISO3 変換（geoBoundaries は ISO3 で要求するため）。
 * 全世界分は重いので、対応予定国だけ定数で持つ。追加は map に 1 行足すだけ。
 */
const ISO2_TO_ISO3: Readonly<Record<string, string>> = {
  JP: "JPN",
  US: "USA",
  GB: "GBR",
  FR: "FRA",
  DE: "DEU",
  BR: "BRA",
  IN: "IND",
  CN: "CHN",
};

/** geoBoundaries API のメタデータレスポンス（必要フィールドのみ） */
interface BoundariesMeta {
  gjDownloadURL?: string;
  simplifiedGeometryGeoJSON?: string;
  boundaryYearRepresented?: string;
  boundaryCanonical?: string;
}

/**
 * geoBoundaries API から国 × ADM2 のメタを取得。
 * 公開 API（認証不要、rate limit 緩め）。
 */
async function fetchBoundariesMeta(iso3: string): Promise<BoundariesMeta> {
  const url = `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM2/`;
  return await fetchJson<BoundariesMeta>(url);
}

/**
 * 1 国分の admin2 slim GeoJSON を取得 → properties 絞り込み → simplify → 書き出し。
 *
 * @param iso2 2 文字 ISO（JP / US 等）
 * @param tolerance simplify の許容誤差（degree 単位、0.005 ≒ 500m @ 赤道付近）
 *
 * なぜ tolerance 0.005 か:
 *   - 地球儀の admin2 ズーム時、画面上で 500m 以下の細部は肉眼で判別できない
 *   - それ以上細かい polygon を保持すると sum で数 MB になり初回 fetch が重くなる
 *   - 実測: JP 6.4MB の元データが 0.005 simplify で 500-800KB（x10 圧縮）
 */
async function buildCountry(iso2: string, tolerance = 0.005): Promise<void> {
  const iso3 = ISO2_TO_ISO3[iso2];
  if (!iso3) throw new Error(`ISO2 "${iso2}" not in ISO2_TO_ISO3 map`);

  console.log(`→ ${iso2} (${iso3}) メタ取得中…`);
  const meta = await fetchBoundariesMeta(iso3);
  if (!meta.gjDownloadURL) {
    throw new Error(`${iso3}: gjDownloadURL missing (API response broken)`);
  }

  console.log(`  gjDownloadURL: ${meta.gjDownloadURL}`);
  console.log(`  year=${meta.boundaryYearRepresented} canonical=${meta.boundaryCanonical}`);

  console.log(`  元 GeoJSON fetch 中（数 MB、タイムアウト延長）…`);
  const raw = await fetchText(meta.gjDownloadURL, 60_000);
  const fc = JSON.parse(raw) as FeatureCollection;
  console.log(`  元 feature 数: ${fc.features.length}`);

  // properties を削ぎ落とす。shapeName（表示用）/ shapeID（キー）のみ残す。
  // 他のフィールド（shapeGroup / shapeType / ADMHIERARCHY / boundaryID 等）は UI で使わない。
  const trimmed: Feature[] = fc.features
    .filter((f): f is Feature<Polygon | MultiPolygon> => {
      const t = f.geometry?.type;
      return t === "Polygon" || t === "MultiPolygon";
    })
    .map((f) =>
      feature(f.geometry as Geometry, {
        shapeName: f.properties?.shapeName ?? null,
        shapeID: f.properties?.shapeID ?? null,
      }),
    );

  console.log(`  simplify 中（tolerance=${tolerance}）…`);
  // @turf/simplify は feature collection を mutate せず新規に返す（関数型）。
  // keepTopology は Polygon/MultiPolygon で辺の共有構造を保つが、その分重い。
  // admin2 は県境レベルで小さな隙間が見えても許容できるので false で高速化。
  const simplified = simplify(featureCollection(trimmed), {
    tolerance,
    highQuality: false,
    mutate: true,
  });

  // 最終出力
  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, `${iso2}.geojson`);
  const serialized = JSON.stringify(simplified);
  await writeFile(outputPath, serialized + "\n", "utf8");

  const kb = (Buffer.byteLength(serialized) / 1024).toFixed(1);
  console.log(`  ✓ ${outputPath} (${kb} KB, features=${simplified.features.length})`);
}

/**
 * 国ごとの tolerance。原データの feature 数が多い国は tolerance を上げて出力を絞る。
 * 目標: gzip 後 500KB 以下（初回 lazy load が許容範囲に収まる）。
 *
 * 実測値（tolerance=0.005 時）:
 *   - JP: 1742 feat → 1.4MB
 *   - US: 3233 feat → 4.4MB（巨大、0.015 に上げて絞る）
 */
const TOLERANCE_BY_COUNTRY: Readonly<Record<string, number>> = {
  US: 0.015,
  CN: 0.015,
  IN: 0.015,
  BR: 0.015,
};
const DEFAULT_TOLERANCE = 0.005;

async function main(): Promise<void> {
  // CLI 引数で国を絞れる: `npm run admin2 -- JP US`
  const targets = process.argv.slice(2).filter((s) => !s.startsWith("-"));
  const countries = targets.length > 0 ? targets : ["JP"];

  console.log(`admin2 build: targets = ${countries.join(", ")}`);
  for (const iso2 of countries) {
    const tol = TOLERANCE_BY_COUNTRY[iso2] ?? DEFAULT_TOLERANCE;
    try {
      await buildCountry(iso2, tol);
    } catch (e) {
      console.error(`  ✗ ${iso2}: ${(e as Error).message}`);
    }
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
