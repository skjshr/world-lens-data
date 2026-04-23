// Windy Webcams API v3。65,000台の世界ライブカメラ。
// https://api.windy.com/webcams/api/v3/docs
//
// 国別にカメラを取得し、座標・サムネイル・プレイヤーURL付きの JSON を出力する。
// APIキーは GitHub Secrets の WINDY_API_KEY から環境変数で渡される。
//
// 無料枠の制限:
//   - 画像 URL は 15 分で失効（mundeye-data の 15 分 cron と相性良い）
//   - オフセット上限 1,000 → 国別に分けて取得することで回避
//   - 低解像度のみ

import { writeJson, sleep } from "../lib/io.ts";
import { COUNTRY_META } from "../lib/countries.ts";

const API_KEY = process.env.WINDY_API_KEY ?? "";
const BASE = "https://api.windy.com/webcams/api/v3/webcams";

interface WindyWebcam {
  webcamId: number;
  title: string;
  status: string;
  location: {
    city: string;
    region: string;
    country: string;
    countryCode: string;
    latitude: number;
    longitude: number;
  };
  images?: {
    current?: {
      icon?: string;
      thumbnail?: string;
      preview?: string;
    };
  };
  player?: {
    day?: { embed?: string; link?: string };
    lifetime?: { embed?: string; link?: string };
  };
}

interface WindyResponse {
  webcams?: WindyWebcam[];
  total?: number;
}

// フロントの LiveCamera 型に合わせた出力
interface CameraOutput {
  id: string;
  name: string;
  city: string;
  countryCode: string;
  lat: number;
  lng: number;
  thumbnailUrl: string;
  playerUrl: string;
  category: string;
}

async function fetchWindy(url: string): Promise<WindyResponse> {
  const res = await fetch(url, {
    headers: {
      "x-windy-api-key": API_KEY,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Windy HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json() as Promise<WindyResponse>;
}

export async function fetchWindyWebcams(): Promise<void> {
  if (!API_KEY) {
    console.log("• Windy Webcams: WINDY_API_KEY not set, skipping");
    return;
  }

  console.log("• Windy Webcams (worldwide)…");
  const allCameras: CameraOutput[] = [];

  // 国別に取得して合計を増やす（オフセット 1,000 制限の回避策）
  const countryCodes = Object.keys(COUNTRY_META);

  for (const code of countryCodes) {
    // 各国 50件×最大20ページ = 最大1,000件/国
    for (let offset = 0; offset < 1000; offset += 50) {
      try {
        const url = `${BASE}?country=${code}&include=images,location,player&limit=50&offset=${offset}`;
        const data = await fetchWindy(url);
        const webcams = data.webcams ?? [];
        if (webcams.length === 0) break;

        for (const cam of webcams) {
          if (cam.status !== "active") continue;
          allCameras.push({
            id: `windy-${cam.webcamId}`,
            name: cam.title,
            city: cam.location?.city ?? cam.location?.region ?? "",
            countryCode: cam.location?.countryCode?.toUpperCase() ?? code,
            lat: cam.location?.latitude ?? 0,
            lng: cam.location?.longitude ?? 0,
            thumbnailUrl: cam.images?.current?.preview ?? cam.images?.current?.thumbnail ?? "",
            playerUrl: cam.player?.lifetime?.embed ?? cam.player?.day?.embed ?? "",
            category: "city",
          });
        }

        // 50件未満なら最終ページ
        if (webcams.length < 50) break;
      } catch (e) {
        console.warn(`  ! Windy ${code} offset=${offset}: ${(e as Error).message}`);
        break;
      }
      await sleep(300);
    }
    console.log(`  ${code}: ${allCameras.length} total`);
  }

  // 主要国以外も追加: continent 単位で広くカバー（各大陸最大500件）
  const existingIds = new Set(allCameras.map((c) => c.id));
  for (const continent of ["AF", "SA", "OC", "EU", "AS", "NA"]) {
    for (let offset = 0; offset < 500; offset += 50) {
      try {
        const url = `${BASE}?continent=${continent}&include=images,location,player&limit=50&offset=${offset}`;
        const data = await fetchWindy(url);
        const webcams = data.webcams ?? [];
        if (webcams.length === 0) break;

        for (const cam of webcams) {
          if (cam.status !== "active") continue;
          const id = `windy-${cam.webcamId}`;
          if (existingIds.has(id)) continue;
          existingIds.add(id);
          allCameras.push({
            id,
            name: cam.title,
            city: cam.location?.city ?? cam.location?.region ?? "",
            countryCode: cam.location?.countryCode?.toUpperCase() ?? "",
            lat: cam.location?.latitude ?? 0,
            lng: cam.location?.longitude ?? 0,
            thumbnailUrl: cam.images?.current?.preview ?? cam.images?.current?.thumbnail ?? "",
            playerUrl: cam.player?.lifetime?.embed ?? cam.player?.day?.embed ?? "",
            category: "city",
          });
        }
        if (webcams.length < 50) break;
      } catch (e) {
        console.warn(`  ! Windy continent ${continent} offset=${offset}: ${(e as Error).message}`);
        break;
      }
      await sleep(300);
    }
    console.log(`  continent ${continent}: ${allCameras.length} total`);
  }

  if (allCameras.length > 0) {
    await writeJson("windy-webcams.json", allCameras);
    console.log(`  ✓ Total: ${allCameras.length} cameras saved`);
  } else {
    console.log("  ⏭ No cameras retrieved, keeping existing snapshot");
  }
}
