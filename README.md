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

### 株価指数について
Stooq は 2026 に API key 必須化されたため停止中。
代替候補: **FRED**（主要指数のみ、key 無料取得） / **Alpha Vantage**（free tier、1 日 25 req）。
どちらも GitHub Secrets で key を保持し、Phase B で接続予定。
| `snapshots/updated-at.json` | 各 source の最終更新時刻 | 実行毎 | - |

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
