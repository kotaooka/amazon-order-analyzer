# 開発者向け情報（amazon-order-analyzer）

利用者向けの説明は [README.md](README.md) にあります。

## ファイル構成

```
index.html             画面（スタイルを含む）。解説は docs/explanation.md から埋め込む
js/amazon-order.js     読み込みと集計（CSV・ZIP の読み取り、CSV の種類の判定、カテゴリの推定、期間・タイムゾーン別の集計）。Node でも読み込み可
js/demo.js             「例を入れる」の架空のデータ（Amazon の CSV と同じ見出し）。Node でも読み込み可
js/app.js              画面処理（読み込み、グラフ、表、明細、テーマ、条件の保存、Service Worker の登録）
sw.js                  オフライン用のキャッシュ処理（Service Worker）
manifest.webmanifest   アプリとして追加するための設定
og.png                 SNS 共有用の画像（tools/screenshots.py で作る）
icons/                 アプリアイコン（tools/make_icons.py で作る）
docs/explanation.md    「解説」タブの原稿
docs/screenshots/      README 用のスクリーンショット（tools/screenshots.py で撮る）
tools/build.py         解説を index.html に埋め込む
tests/test.js          検算テスト
.github/workflows/     push 時の自動テスト
```

## 更新して公開するとき

- `index.html`・`js/`・`icons/` を変更したら、**`sw.js` 先頭の `VERSION` を必ず上げてから** push してください。上げないと、すでに使っている人の端末に古いファイルが残り続けます
- 画面の見た目を変えたときは、`docs/screenshots/` の画像と `og.png` も撮り直してください（撮影手順は `tools/screenshots.py` の先頭）。**撮るのは「例を入れる」の架空のデータだけ**にし、自分の注文履歴を読み込んだ画面は撮らないでください
- 解説を直すときは `docs/explanation.md` を編集し、`python tools/build.py`（`pip install markdown`）で index.html に埋め込んでください。埋め込み忘れは CI で検出します
- GitHub Pages は main ブランチのルートを公開しています

## 個人のデータを入れないために

- `.gitignore` で `*.zip`・`*.csv` と、Amazon の ZIP を展開したときのフォルダを除外しています。テストのデータは `tests/test.js` の中に書いた架空の値だけです
- 画面は読み込んだデータを localStorage にも IndexedDB にも保存しません。保存するのは `amazon-order-analyzer-inputs`（期間・タイムゾーン・タブ・明細の並べ方）だけです
- 外部の JS・解析タグは読み込みません（Google Fonts の CSS と字体だけ）

## テスト

```
node tests/test.js    # 不一致があれば終了コード 1
```

Node 18 以上（ZIP の deflate の展開に `DecompressionStream` を使うため）。

## 実装のメモ

- **CSV の種類**：ファイル名ではなく見出しで判定します（`detectKind`）。Order History は `Order ID`・`Product Name`・`Order Status` と `Total Amount`（古い形式は `Total Owed`）があるもの
- **ZIP**：中央ディレクトリを読み、`.csv` だけを取り出します。無圧縮（0）と deflate（8）、ZIP64 に対応。deflate は `DecompressionStream('deflate-raw')` で展開します
- **金額**：`Total Amount` は商品ごとの支払額（数量分、税・送料・割引込み）。`Shipment Item Subtotal` は出荷単位の値で、同じ出荷の商品で重複するので使いません
- **日時**：CSV は UTC。`Intl.DateTimeFormat` の `timeZone` で年・月・日・時・曜日に分けます
- **カテゴリ**：`DEPT`（部門 → 分類）を先に当て、部門が空なら `WORDS`（商品名の正規表現）を上から順に当てます。部門が Electronics でも、商品名がカメラ・オーディオなら先にそちらに分けます
- **プライム会費**：`PRIME`（月額・年間の会費と時点）。会費が変わったらここと解説・README を直します
- **入力の保存**：localStorage のキー `amazon-order-analyzer-inputs`。読み書きはすべて try/catch で囲み、保存できない環境でも動きます
- **テーマ**：QC Workbench の全ツールで共通のキー `qc-workbench-theme`
