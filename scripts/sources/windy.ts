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
    try {
      const url = `${BASE}?country=${code}&include=images,location,player&limit=100`;
      const data = await fetchWindy(url);
      const webcams = data.webcams ?? [];

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

      console.log(`  ${code}: ${webcams.length} cameras (${allCameras.length} total)`);
    } catch (e) {
      console.warn(`  ! Windy ${code}: ${(e as Error).message}`);
    }
    await sleep(300);
  }

  // 主要国以外も追加: continent 単位で広くカバー
  for (const continent of ["AF", "SA", "OC"]) {
    try {
      const url = `${BASE}?continent=${continent}&include=images,location,player&limit=200`;
      const data = await fetchWindy(url);
      const webcams = data.webcams ?? [];

      for (const cam of webcams) {
        if (cam.status !== "active") continue;
        // 既に追加済みならスキップ
        if (allCameras.some((c) => c.id === `windy-${cam.webcamId}`)) continue;
        allCameras.push({
          id: `windy-${cam.webcamId}`,
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
      console.log(`  continent ${continent}: +${webcams.length} (${allCameras.length} total)`);
    } catch (e) {
      console.warn(`  ! Windy continent ${continent}: ${(e as Error).message}`);
    }
    await sleep(500);
  }

  if (allCameras.length > 0) {
    await writeJson("windy-webcams.json", allCameras);
    console.log(`  ✓ Total: ${allCameras.length} cameras saved`);
  } else {
    console.log("  ⏭ No cameras retrieved, keeping existing snapshot");
  }
}
