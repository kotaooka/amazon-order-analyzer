// 動作確認用のデモデータ（架空の注文）を Amazon の CSV と同じ見出しで作る。DOM に触れない。Node でも読み込み可
// 実在の人の購入データは使っていない。住所・支払い方法・追跡番号の列は入れない
(function (root) {
  'use strict';

  // 架空の商品：[名前, 部門, 価格の下限, 上限, 1 年あたりの回数の目安, 中古の割合]
  const ITEMS = [
    ['USB Type-Cケーブル 1m 2本セット', 'Electronics', 900, 1500, 1.2, 0],
    ['ワイヤレスマウス 静音', 'Personal Computers', 1800, 3500, 0.3, 0],
    ['外付けSSD 1TB', 'Personal Computers', 9000, 14000, 0.15, 0.1],
    ['27インチ モニター', 'Personal Computers', 24000, 38000, 0.08, 0.2],
    ['スマートフォン用 ガラスフィルム 2枚入り', 'Wireless Phone Accessory', 800, 1300, 0.8, 0],
    ['USB充電器 65W', 'Electronics', 3000, 4800, 0.25, 0],
    ['ノイズキャンセリング イヤホン', 'Electronics', 12000, 26000, 0.1, 0.15],
    ['ミラーレスカメラ用 交換レンズ', 'Camera', 30000, 65000, 0.06, 0.5],
    ['SDカード 128GB', 'Electronics', 2200, 3800, 0.2, 0],
    ['洗濯洗剤 詰め替え 大容量', 'Home', 900, 1400, 4, 0],
    ['シャンプー 詰め替え 600ml', 'Health and Beauty', 1100, 1800, 3, 0],
    ['歯ブラシ 替えブラシ 8本', 'Health and Beauty', 600, 1100, 1.5, 0],
    ['マルチビタミン 90日分', 'Health and Beauty', 900, 1600, 2.5, 0],
    ['炭酸水 500ml×24本', 'Grocery', 1500, 2200, 3, 0],
    ['ドリップコーヒー 100袋', 'Grocery', 1800, 2800, 2, 0],
    ['フライパン 26cm', 'Kitchen', 2500, 5000, 0.2, 0],
    ['保存容器 10個セット', 'Kitchen', 1200, 2400, 0.3, 0],
    ['ボックスシーツ シングル', 'Home', 2000, 3800, 0.3, 0],
    ['デスクライト LED', 'Home', 3500, 7000, 0.12, 0],
    ['ラチェットレンチ セット', 'Tools & Home Improvement', 2500, 6000, 0.15, 0],
    ['精密ドライバー セット', 'Tools & Home Improvement', 1500, 3200, 0.15, 0],
    ['ボールペン 替芯 10本', 'Office Product', 600, 1000, 1, 0],
    ['A4 コピー用紙 500枚', 'Office Product', 500, 900, 0.8, 0],
    ['ビジネスシャツ 長袖', 'Apparel', 2500, 4800, 0.6, 0],
    ['スニーカー', 'Shoes', 6000, 12000, 0.25, 0],
    ['ビジネスリュック', 'Luggage', 8000, 18000, 0.1, 0.1],
    ['技術書（単行本）', 'Tankobon Softcover', 2400, 4400, 1.5, 0.3],
    ['新書', 'Paperback Shinsho', 900, 1200, 1, 0.2],
    ['自転車用 チューブ 2本', 'Sports', 1200, 2000, 0.5, 0],
    ['車用 ワイパーブレード', 'Automotive', 1800, 3200, 0.4, 0],
    ['ボードゲーム', 'Toy', 3000, 6000, 0.15, 0]
  ];
  const DIGITAL = [['電子書籍（マンガ）', 400, 700, 4], ['電子書籍（ビジネス書）', 1200, 1900, 2], ['映画レンタル', 300, 500, 1.5]];

  // 種から決まる乱数（mulberry32）
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const iso = d => d.toISOString().replace('.000', '');

  // seed：乱数の種、end：最後の日（省略すると今日）。end の 3 年前の 1 月 1 日（日本時間）から作る
  function makeDemo(seed = 1, end = new Date()) {
    const r = rng(seed);
    const endT = end.getTime();
    const startT = Date.UTC(new Date(endT + 9 * 3600e3).getUTCFullYear() - 3, 0, 1) - 9 * 3600e3;
    const years = (endT - startT) / (365 * 864e5);
    // 注文する時刻（JST）：昼休みと夜に多い
    const HOURS = [0, 0, 0, 0, 0, 0, 1, 3, 4, 2, 2, 3, 8, 4, 3, 3, 3, 4, 6, 8, 10, 10, 7, 3];
    const hw = HOURS.reduce((s, x) => s + x, 0);
    const pickHour = () => { let x = r() * hw; for (let h = 0; h < 24; h++) { x -= HOURS[h]; if (x < 0) return h; } return 21; };
    const when = () => {
      const t = startT + r() * (endT - startT);
      const d = new Date(t);
      // JST の日付に、選んだ時刻を当てて UTC に戻す
      const j = new Date(t + 9 * 3600e3);
      return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), pickHour() - 9, Math.floor(r() * 60), Math.floor(r() * 60))) || d;
    };

    // ---- 物品の注文 ----
    const H = ['ASIN', 'Currency', 'Department', 'Order Date', 'Order ID', 'Order Status', 'Original Quantity', 'Product Condition', 'Product Name', 'Total Amount', 'Unit Price', 'Unit Price Tax', 'Website'];
    const lines = [];
    let oid = 1;
    const orderId = () => `D01-${String(1000000 + oid++).slice(1)}-${String(Math.floor(r() * 9e6) + 1e6)}`;
    ITEMS.forEach((it, k) => {
      const [name, dept, lo, hi, perYear, usedP] = it;
      const n = Math.max(1, Math.round(perYear * years * 1.6 * (0.6 + r() * 0.8)));
      for (let i = 0; i < n; i++) {
        const used = r() < usedP;
        let price = Math.round((lo + r() * (hi - lo)) / 10) * 10;
        if (used) price = Math.round(price * 0.7 / 10) * 10;
        const qty = r() < 0.08 ? 2 : 1;
        const unit = Math.round(price / 1.1), tax = price - unit;
        const cancel = r() < 0.01;
        lines.push([`B0DEMO${String(k).padStart(4, '0')}`, 'JPY', dept, iso(when()), orderId(), cancel ? 'Cancelled' : 'Closed', qty, used ? 'Used' : 'New', name, cancel ? 0 : price * qty, unit, tax, 'Amazon.co.jp']);
      }
    });
    // 同じ注文に 2 商品を入れる（まとめ買い）
    for (let i = 0; i + 1 < lines.length; i += 9) { lines[i + 1][3] = lines[i][3]; lines[i + 1][4] = lines[i][4]; }
    lines.sort((a, b) => (a[3] < b[3] ? 1 : -1));
    const orders = '﻿' + H.map(q).join(',') + '\n' + lines.map(l => l.map(q).join(',')).join('\n') + '\n';

    // ---- デジタル（プライム会費は月額、電子書籍など） ----
    const DH = ['Order ID', 'Order Date', 'Product Name', 'Component Type', 'Transaction Amount', 'Base Currency Code', 'Marketplace'];
    const dl = [];
    let did = 1;
    const did_ = () => `D01-DIG-${String(did++).padStart(6, '0')}`;
    for (let t = startT; t < endT; t += 30.4 * 864e5) {
      const id = did_(), d = iso(new Date(t));
      dl.push([id, d, 'Prime', 'Price Amount', 545, 'JPY', 'www.amazon.co.jp'], [id, d, 'Prime', 'Tax', 55, 'JPY', 'www.amazon.co.jp']);
    }
    for (const [name, lo, hi, perYear] of DIGITAL) {
      const n = Math.round(perYear * years * (0.6 + r() * 0.8));
      for (let i = 0; i < n; i++) {
        const id = did_(), d = iso(when()), p = Math.round((lo + r() * (hi - lo)) / 10) * 10, u = Math.round(p / 1.1);
        dl.push([id, d, name, 'Price Amount', u, 'JPY', 'www.amazon.co.jp'], [id, d, name, 'Tax', p - u, 'JPY', 'www.amazon.co.jp']);
      }
    }
    const digital = '﻿' + DH.map(q).join(',') + '\n' + dl.map(l => l.map(q).join(',')).join('\n') + '\n';

    // ---- Kindle の貸出 ----
    const BH = ['ASIN', 'Loan Creation Date', 'Loan Program', 'Loan Status', 'Product Name'];
    const bl = [];
    for (let i = 0; i < 40; i++) bl.push([`B0LOAN${i}`, iso(when()), r() < 0.7 ? 'Kindle Unlimited' : 'Prime Reading', 'RETURNED', `デモの本 ${i + 1}`]);
    const borrow = '﻿' + BH.map(q).join(',') + '\n' + bl.map(l => l.map(q).join(',')).join('\n') + '\n';

    // ---- 返品 ----
    const RH = ['Order ID', 'Date of Return', 'Return Amount', 'Return Reason', 'Return Resolution'];
    const rl = [0, 1].map(i => { const l = lines[10 + i * 30]; return [l[4], l[3], l[9], i ? 'Defective' : 'Not required', 'Refund']; });
    const returns = '﻿' + RH.map(q).join(',') + '\n' + rl.map(l => l.map(q).join(',')).join('\n') + '\n';

    return [
      { name: 'デモ/Order History.csv', text: orders },
      { name: 'デモ/Digital Content Orders.csv', text: digital },
      { name: 'デモ/Digital Borrowed Items.csv', text: borrow },
      { name: 'デモ/Returns Status.csv', text: returns }
    ];
  }

  const api = { makeDemo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmazonDemo = api;
})(typeof window !== 'undefined' ? window : globalThis);
