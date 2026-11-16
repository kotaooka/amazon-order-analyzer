// 検算テスト：CSV・ZIP の読み込みと、手で計算できる小さなデータでの集計。node tests/test.js
// 公表値のある計算ではないので、期待値はこのファイルに書いたデータから手計算した値（コメントに計算を書く）
'use strict';
const zlib = require('zlib');
const A = require('../js/amazon-order.js');
const D = require('../js/demo.js');
let fail = 0, n = 0;
function ok(name, cond, info = '') { n++; if (!cond) { fail++; console.log(`✕ ${name} ${info}`); } }
function eq(name, got, want, tol = 0) { ok(name, Math.abs(got - want) <= tol, `: ${got} ≠ ${want}`); }
function same(name, got, want) { ok(name, JSON.stringify(got) === JSON.stringify(want), `: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }

// ---- CSV の読み込み ----
{
  const t = '﻿a,"b c",d\r\n1,"x, ""y""",3\r\n2,"改\n行",\r\n\r\n';
  const r = A.parseCSV(t);
  same('CSV 見出し（BOM を除く）', r.headers, ['a', 'b c', 'd']);
  eq('CSV 行数（空行を除く）', r.rows.length, 2);
  same('CSV 引用符とカンマ', r.rows[0]['b c'], 'x, "y"');
  same('CSV セル内の改行', r.rows[1]['b c'], '改\n行');
  same('CSV 最後の空セル', r.rows[1].d, '');
}

// ---- 金額の読み取り ----
eq('金額 3 桁区切り', A.money('1,617'), 1617);
eq('金額 マイナス', A.money('-267'), -267);
ok('金額 Not Available は数でない', Number.isNaN(A.money('Not Available')));

// ---- テスト用の注文データ（Amazon の Order History.csv と同じ見出し） ----
const H = ['ASIN', 'Currency', 'Department', 'Order Date', 'Order ID', 'Order Status', 'Original Quantity', 'Product Condition', 'Product Name', 'Total Amount', 'Unit Price', 'Unit Price Tax'];
const row = a => a.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
const ORD = [
  // ASIN, 通貨, 部門, 日時(UTC), 注文, 状態, 数, 状態, 名前, 合計, 単価, 税
  ['A1', 'JPY', 'Electronics', '2024-12-31T16:30:00Z', 'O1', 'Closed', 1, 'New', 'USBケーブル 1m', '1,100', '1000', '100'], // JST 2025-01-01 01:30（水）
  ['A2', 'JPY', 'Kitchen', '2024-12-31T16:30:00Z', 'O1', 'Closed', 2, 'New', 'フライパン 26cm', '4,400', '2000', '200'],  // 同じ注文
  ['A1', 'JPY', 'Electronics', '2025-03-10T03:00:00Z', 'O2', 'Closed', 1, 'New', 'USBケーブル 1m', '1,100', '1000', '100'],  // JST 2025-03-10 12:00（月）
  ['A3', 'JPY', 'Not Available', '2025-03-20T11:00:00Z', 'O3', 'Closed', 1, 'Used', 'ミラーレス一眼 ボディ', '50,000', '45455', '4545'], // JST 20:00（木）、中古、部門なし→商品名でカメラ
  ['A1', 'JPY', 'Electronics', '2025-06-08T03:00:00Z', 'O4', 'Closed', 1, 'New', 'USBケーブル 1m', 'Not Available', '1000', '100'], // 合計なし→(1000+100)×1。JST 12:00（日）
  ['A4', 'JPY', 'Toy', '2025-07-01T03:00:00Z', 'O5', 'Cancelled', 1, 'New', 'パズル', '0', '0', '0'],      // キャンセル→除外
  ['A5', 'USD', 'Book', '2025-07-02T03:00:00Z', 'O6', 'Closed', 1, 'New', 'Paperback', '20', '20', '0'],     // 別の通貨→除外
  ['A6', 'JPY', 'Health and Beauty', '2024-05-05T01:00:00Z', 'O7', 'Closed', 1, 'New', 'シャンプー 詰め替え', '880', '800', '80'] // JST 2024-05-05 10:00（日）
];
const ordersCsv = '﻿' + row(H) + '\r\n' + ORD.map(row).join('\r\n') + '\r\n';
const DH = ['Order ID', 'Order Date', 'Product Name', 'Component Type', 'Transaction Amount', 'Base Currency Code'];
const DIG = [
  ['D1', '2025-01-05T12:00:00Z', 'Prime', 'Price Amount', '545', 'JPY'], ['D1', '2025-01-05T12:00:00Z', 'Prime', 'Tax', '55', 'JPY'],
  ['D2', '2025-02-05T12:00:00Z', 'Prime', 'Price Amount', '545', 'JPY'], ['D2', '2025-02-05T12:00:00Z', 'Prime', 'Tax', '55', 'JPY'],
  ['D3', '2025-02-10T12:00:00Z', 'ある電子書籍', 'Price Amount', '900', 'JPY'], ['D3', '2025-02-10T12:00:00Z', 'ある電子書籍', 'Tax', '90', 'JPY'],
  ['D4', '2025-02-11T12:00:00Z', 'ある電子書籍', 'Price Amount', '-990', 'JPY'] // 返金
];
const digCsv = row(DH) + '\n' + DIG.map(row).join('\n') + '\n';
const borrowCsv = row(['ASIN', 'Loan Creation Date', 'Loan Program', 'Product Name']) + '\n' +
  [['B1', '2025-01-01T00:00:00Z', 'Kindle Unlimited', 'x'], ['B2', '2025-02-01T00:00:00Z', 'Kindle Unlimited', 'y'], ['B3', '2024-02-01T00:00:00Z', 'Prime Reading', 'z']].map(row).join('\n');
const retCsv = row(['Order ID', 'Date of Return', 'Return Amount', 'Return Reason', 'Return Resolution']) + '\n' + row(['O3', '2025-04-01T00:00:00Z', '1,000', 'Defective', 'Refund']);

// ---- 種類の判定 ----
same('種類 注文', A.detectKind(A.parseCSV(ordersCsv).headers), 'orders');
same('種類 デジタル', A.detectKind(A.parseCSV(digCsv).headers), 'digital');
same('種類 貸出', A.detectKind(A.parseCSV(borrowCsv).headers), 'borrow');
same('種類 返品', A.detectKind(A.parseCSV(retCsv).headers), 'returns');
same('種類 不明', A.detectKind(['x', 'y']), null);

const data = A.load([{ name: 'o.csv', text: ordersCsv }, { name: 'd.csv', text: digCsv }, { name: 'b.csv', text: borrowCsv }, { name: 'r.csv', text: retCsv }]);
const NOW = new Date('2025-12-30T15:00:00Z'); // JST 2025-12-31 00:00

// ---- 全期間 ----
{
  const r = A.analyze(data, { period: 'all', now: NOW, tz: 'Asia/Tokyo' });
  // 有効 6 行：1100 + 4400 + 1100 + 50000 + 1100 + 880 = 58580
  eq('全期間 合計', r.kpi.total, 58580);
  eq('全期間 商品数', r.kpi.items, 6);
  eq('全期間 注文数（O1 は 2 商品で 1 注文）', r.kpi.orders, 5);
  eq('キャンセル件数', r.kpi.cancelled, 1);
  eq('別通貨の件数', r.kpi.otherCurrency, 1);
  same('主な通貨', r.kpi.currency, 'JPY');
  // 注文の合計 [5500, 1100, 50000, 1100, 880] の中央値 = 1100
  eq('注文の中央値', r.kpi.medianOrder, 1100);
  // 商品 [1100, 4400, 1100, 50000, 1100, 880] の中央値 = (1100 + 1100) / 2 = 1100
  eq('商品の中央値', r.kpi.medianItem, 1100);
  eq('中古の金額', r.kpi.used, 50000);
  eq('中古の割合', r.kpi.usedShare, 50000 / 58580, 1e-12);
  // 年別：2024 = 880（JST で 12/31 16:30Z は 2025 年）、2025 = 57700
  same('年別の年', r.yearly.map(y => y.year), [2024, 2025]);
  eq('2024 年', r.yearly[0].amount, 880);
  eq('2025 年', r.yearly[1].amount, 57700);
  // デジタル 2025 = 600 + 600 + 990 − 990 = 1200
  eq('2025 年 デジタル', r.yearly[1].digital, 1200);
  eq('デジタル合計', r.kpi.digital, 1200);
  // 時間帯（注文ごと）：01 時 1、12 時 2、20 時 1、10 時 1
  eq('1 時台', r.hour[1], 1); eq('12 時台', r.hour[12], 2); eq('20 時台', r.hour[20], 1); eq('10 時台', r.hour[10], 1);
  // 曜日（0 = 月）：2025-01-01 水、03-10 月、03-20 木、06-08 日、2024-05-05 日
  same('曜日', r.dow, [1, 0, 1, 1, 0, 0, 2]);
  // カテゴリ：カメラ 50000、PC 3300、キッチン 4400、美容・健康 880
  const c = Object.fromEntries(r.categories.map(x => [x.cat, x.amount]));
  same('カテゴリ', c, { 'カメラ': 50000, 'キッチン': 4400, 'PC・ガジェット': 3300, '美容・健康': 880 });
  // リピート：A1 が 3 回、間隔 2025-01-01 01:30 → 03-10 12:00 → 06-08 12:00 JST
  eq('リピート 件数', r.repeat.length, 1);
  eq('リピート 回数', r.repeat[0].count, 3);
  eq('リピート 金額', r.repeat[0].amount, 3300);
  // 間隔：68.4375 日と 90 日の中央値 = 79.21875 日
  eq('リピート 間隔の中央値', r.repeat[0].interval, (68.4375 + 90) / 2, 1e-9);
  same('高額の 1 位', r.top[0].name, 'ミラーレス一眼 ボディ');
  ok('高額の 1 位は中古', r.top[0].used === true);
  // プライム：基準日から 12 か月に 2 回 → 月額プラン、600 × 12 − 5900 = 1300
  eq('プライムの支払い回数', r.prime.payments, 2);
  ok('月額プランとみなす', r.prime.monthly);
  eq('年間プランとの差', r.prime.saving, 1300);
  eq('貸出', r.borrow.count, 3);
  eq('返品の件数', r.returns.count, 1);
  eq('返金額', r.returns.refund, 1000);
}

// ---- 年を選ぶ ----
{
  const r = A.analyze(data, { period: '2025', now: NOW });
  eq('2025 年 合計', r.kpi.total, 57700);
  eq('2025 年 月の数', r.monthly.length, 12);
  eq('2025 年 3 月', r.monthly[2].amount, 51100);
  eq('2025 年 貸出', r.borrow.count, 2);
}
// ---- 直近 12 か月（2024-12-31 00:00 JST 〜 2025-12-31 00:00 JST） ----
{
  const r = A.analyze(data, { period: 'last12', now: NOW });
  eq('直近 12 か月 合計', r.kpi.total, 57700);
  eq('直近 12 か月 月平均', r.kpi.perMonth, 57700 / 12, 1e-9);
  same('直近 12 か月 最後の月', r.monthly[11].ym, '2025-12');
}
// ---- タイムゾーンを変える（UTC では 12/31 16:30Z は 2024 年） ----
{
  const r = A.analyze(data, { period: 'all', now: NOW, tz: 'UTC' });
  eq('UTC 2024 年', r.yearly[0].amount, 880 + 1100 + 4400);
}

// ---- ZIP（無圧縮と deflate を 1 つずつ入れて作る） ----
function makeZip(entries) {
  const locals = [], cds = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.text, 'utf8');
    const data = e.deflate ? zlib.deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(e.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(e.deflate ? 8 : 0, 10);
    cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(off, 42);
    locals.push(lh, name, data); cds.push(cd, name);
    off += 30 + name.length + data.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10);
  eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cdBuf, eo]);
}

(async () => {
  const zip = makeZip([
    { name: 'Your Amazon Orders/Order History.csv', text: ordersCsv, deflate: true },
    { name: 'Additional Data/invoice.pdf', text: '%PDF-1.4', deflate: false },
    { name: 'Your Amazon Orders/Digital Content Orders.csv', text: digCsv, deflate: false }
  ]);
  const files = await A.readZip(zip);
  same('ZIP CSV だけ取り出す', files.map(f => f.name), ['Your Amazon Orders/Order History.csv', 'Your Amazon Orders/Digital Content Orders.csv']);
  same('ZIP deflate の中身（BOM は除く）', files[0].text.replace(/^\uFEFF/, ''), ordersCsv.replace(/^\uFEFF/, ''));
  same('ZIP 無圧縮の中身', files[1].text, digCsv);
  let threw = false;
  try { await A.readZip(Buffer.from('not a zip file at all, just text..........')); } catch (e) { threw = true; }
  ok('ZIP でないファイルはエラー', threw);

  // ---- デモデータ：同じ種から同じデータができ、読み込める ----
  const END = new Date('2025-12-31T00:00:00Z');
  const d1 = D.makeDemo(7, END), d2 = D.makeDemo(7, END);
  same('デモ 再現性', d1.map(f => f.text.length), d2.map(f => f.text.length));
  const dd = A.load(d1);
  ok('デモ 注文を読める', dd.orders.length > 100);
  ok('デモ デジタルを読める', dd.digital.length > 10);
  ok('デモ 住所・カード番号を含まない', d1.every(f => !/Address|Payment Method/i.test(f.text.split('\n')[0])));

  console.log(fail ? `✕ ${fail}/${n} 件が不一致` : `✓ ${n} 件すべて一致`);
  process.exit(fail ? 1 : 0);
})();
