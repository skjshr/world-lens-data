# world-lens-data

[`world-lens`](https://github.com/skjshr/world-lens) のデータスナップショット専用リポジトリ。
GitHub Actions が 15 分ごとに外部 API から取得 → `snapshots/` に commit、jsdelivr 経由で配信する。

## 配信エンドポイント

```
https://cdn.jsdelivr.net/gh/skjshr/world-lens-data@main/snapshots/<name>.json
```

Actions は commit 直後に jsdelivr purge を叩くので、**push から数秒で全エッジに反映**される。

## 取得中のソース

| ファイル | ソース | 更新頻度 | キー |
|---|---|---|---|
| `snapshots/gdelt-global.json` | GDELT Doc API | 15 分 | 不要 |
| `snapshots/gdelt-jp.json` | GDELT Doc API（JP フィルタ） | 15 分 | 不要 |
| `snapshots/rss-ja.json` | NHK / 日経 / 朝日 RSS | 15 分 | 不要 |
| `snapshots/open-meteo.json` | Open-Meteo | 15 分 | 不要 |
| `snapshots/world-bank-population.json` | World Bank Open Data | 週 1 | 不要 |
| `snapshots/fred-stock.json` | FRED（S&P500 / Dow / NASDAQ / Nikkei225） | 15 分 | 不要 |
| `snapshots/fred-forex.json` | FRED 為替（USD/JPY 他 6 ペア） | 15 分 | 不要 |
| `snapshots/fred-commodities.json` | FRED 商品（WTI / Brent 原油） | 15 分 | 不要 |
| `snapshots/fred-rates.json` | FRED 米国債利回り（2Y / 10Y / 30Y） | 15 分 | 不要 |
| `snapshots/stooq-stock.json` | Stooq（FTSE / DAX / HSI）latest endpoint | 15 分 | 不要 |
| `snapshots/updated-at.json` | 各 source の最終更新時刻 | 実行毎 | - |

### 株価指数について
FRED には米国主要指数 + Nikkei225 のみ、欧州 / 香港は Stooq の latest endpoint（apikey 不要で
close のみ取得可）で補完する。Stooq の「歴史データ endpoint」は 2026 に apikey 必須化されたが、
最新スナップショット endpoint は未だ無料で叩ける。前日比は前回実行時 snapshot の close を
前日 close として計算している（hourly 更新なので大きな誤差は出ない）。

## 運用

- **cron**: 15 分ごと（`.github/workflows/fetch.yml`）
- **権限**: Actions は `contents: write` のみ
- **著作権**: ニュースは見出し + 元 URL + 発信時刻のみ保持、全文は持たない
- **失敗時**: 成功した source のみ commit、失敗 source は既存 JSON を保持

## ローカル実行

```bash
npm ci
npm run fetch         # すべて取得
npm run fetch -- gdelt rss   # 特定ソースのみ
```

## ライセンス

本 repo のスクリプトは MIT。`snapshots/` 内のデータは各元ソースのライセンスに従う
（GDELT: public domain、RSS: 各社の利用規約、Open-Meteo / World Bank: CC BY / 無料利用可）。
