// Amazon注文履歴の読み込みと集計。DOM に触れない。Node でも読み込み可
// 入力：Amazon の「データのリクエスト」で受け取る Your Orders.zip（または中の CSV）
// 金額は CSV の通貨のまま扱う（日本の Amazon.co.jp なら円）
(function (root) {
  'use strict';

  // ================= CSV =================
  // RFC 4180 の CSV を行の配列（見出しをキーにしたオブジェクト）にする。先頭の BOM、"" のエスケープ、セル内の改行に対応
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], cell = '', q = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ',') { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map(h => h.trim());
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const a = rows[r];
      if (a.length === 1 && a[0] === '') continue; // 空行
      const o = {};
      headers.forEach((h, k) => { o[h] = a[k] === undefined ? '' : a[k]; });
      out.push(o);
    }
    return { headers, rows: out };
  }

  // ================= ZIP =================
  // 中央ディレクトリを読み、名前が .csv のものだけ取り出す（PDF の請求書などは読まない）
  // 圧縮方式は無圧縮（0）と deflate（8）。deflate はブラウザ・Node の DecompressionStream で展開する
  async function readZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // 中央ディレクトリの終端（EOCD）を後ろから探す
    let eocd = -1;
    for (let p = u8.length - 22; p >= Math.max(0, u8.length - 22 - 65535); p--) {
      if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
    }
    if (eocd < 0) throw new Error('ZIPファイルとして読めませんでした');
    let count = dv.getUint16(eocd + 10, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    // ZIP64（ファイルが多い・大きい）のとき
    if (cdOff === 0xFFFFFFFF || count === 0xFFFF) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(loc + 8, true));
        count = Number(dv.getBigUint64(z64 + 32, true));
        cdOff = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
    const utf8 = new TextDecoder('utf-8');
    const files = [];
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIPの目次が壊れています');
      const method = dv.getUint16(p + 10, true);
      let csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), comLen = dv.getUint16(p + 32, true);
      let lho = dv.getUint32(p + 42, true);
      const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 の拡張フィールド
      if (csize === 0xFFFFFFFF || lho === 0xFFFFFFFF) {
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = dv.getUint16(e, true), sz = dv.getUint16(e + 2, true);
          if (id === 0x0001) {
            let q = e + 4;
            if (dv.getUint32(p + 24, true) === 0xFFFFFFFF) q += 8; // 元のサイズ
            if (csize === 0xFFFFFFFF) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
            if (lho === 0xFFFFFFFF) { lho = Number(dv.getBigUint64(q, true)); }
          }
          e += 4 + sz;
        }
      }
      p += 46 + nameLen + extraLen + comLen;
      if (!/\.csv$/i.test(name)) continue;
      const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnl + lel;
      const data = u8.subarray(start, start + csize);
      let raw;
      if (method === 0) raw = data;
      else if (method === 8) raw = await inflateRaw(data);
      else throw new Error(`${name} は対応していない圧縮方式です`);
      files.push({ name, text: utf8.decode(raw) });
    }
    return files;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザはZIPの展開に対応していません。ZIPを展開してCSVを読み込んでください');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ================= 種類の判定と正規化 =================
  const has = (h, ...names) => names.every(n => h.includes(n));
  // 見出しから CSV の種類を決める（ファイル名に頼らない）
  function detectKind(headers) {
    if (has(headers, 'Order ID', 'Product Name', 'Order Status') && (headers.includes('Total Amount') || headers.includes('Total Owed'))) return 'orders';
    if (has(headers, 'Transaction Amount', 'Component Type', 'Order ID')) return 'digital';
    if (has(headers, 'Loan Program', 'Loan Creation Date')) return 'borrow';
    if (has(headers, 'Return Resolution', 'Order ID')) return 'returns';
    if (has(headers, 'Return Reason Code', 'Order ID')) return 'returnRequests';
    if (has(headers, 'Amount Refunded', 'Return Status')) return 'digitalReturns';
    return null;
  }
  const KIND_LABEL = {
    orders: '物品の注文', digital: 'デジタルの注文', borrow: 'Kindleの貸出',
    returns: '返品', returnRequests: '返品の依頼', digitalReturns: 'デジタルの返品'
  };

  const NA = /^(Not Available|Not Applicable|N\/A|)$/i;
  // "1,617" → 1617、"Not Available" → NaN
  function money(s) {
    const t = String(s ?? '').trim();
    if (NA.test(t)) return NaN;
    const v = Number(t.replace(/[,¥￥$€£\s]/g, ''));
    return Number.isFinite(v) ? v : NaN;
  }
  function date(s) {
    const t = String(s ?? '').trim();
    if (NA.test(t)) return null;
    const d = new Date(t);
    return isNaN(d) ? null : d;
  }
  const clean = s => (NA.test(String(s ?? '').trim()) ? '' : String(s).trim());

  function normOrders(rows) {
    const out = [];
    for (const r of rows) {
      const d = date(r['Order Date']);
      if (!d) continue;
      const qty = Number(r['Original Quantity'] ?? r['Quantity'] ?? 1) || 1;
      let amt = money(r['Total Amount'] ?? r['Total Owed']);
      if (!Number.isFinite(amt)) {
        const up = money(r['Unit Price']), tax = money(r['Unit Price Tax']);
        amt = Number.isFinite(up) ? (up + (Number.isFinite(tax) ? tax : 0)) * qty : 0;
      }
      const status = clean(r['Order Status']);
      out.push({
        id: clean(r['Order ID']), date: d, asin: clean(r['ASIN']), name: clean(r['Product Name']) || '（名前なし）',
        dept: clean(r['Department']), qty, amount: amt, currency: clean(r['Currency']) || '',
        used: /used|中古/i.test(r['Product Condition'] || ''), cancelled: /cancel/i.test(status), status
      });
    }
    return out;
  }
  // デジタルの注文は、1 件が「本体」「税」など複数の行に分かれている。Transaction Amount を足すと支払額になる（返金はマイナス）
  function normDigital(rows) {
    const out = [];
    for (const r of rows) {
      const d = date(r['Order Date']);
      if (!d) continue;
      const amt = money(r['Transaction Amount']);
      out.push({
        id: clean(r['Order ID']), date: d, name: clean(r['Product Name']) || '（名前なし）',
        amount: Number.isFinite(amt) ? amt : 0, currency: clean(r['Base Currency Code'] || r['Base Currency']) || ''
      });
    }
    return out;
  }
  function normBorrow(rows) {
    return rows.map(r => ({ date: date(r['Loan Creation Date']), program: clean(r['Loan Program']) || '不明', name: clean(r['Product Name']) }))
      .filter(r => r.date);
  }
  function normReturns(rows) {
    return rows.map(r => ({
      id: clean(r['Order ID']), date: date(r['Date of Return'] || r['Return Creation Date']),
      amount: money(r['Return Amount']), reason: clean(r['Return Reason']), resolution: clean(r['Return Resolution'])
    }));
  }

  // 読み込んだファイル（{name, text}）をまとめる。同じ種類のファイルが複数あれば足し合わせる
  function load(files) {
    const data = { orders: [], digital: [], borrow: [], returns: [], files: [] };
    for (const f of files) {
      const { headers, rows } = parseCSV(f.text);
      const kind = detectKind(headers);
      data.files.push({ name: f.name, kind, rows: rows.length });
      if (kind === 'orders') data.orders.push(...normOrders(rows));
      else if (kind === 'digital') data.digital.push(...normDigital(rows));
      else if (kind === 'borrow') data.borrow.push(...normBorrow(rows));
      else if (kind === 'returns') data.returns.push(...normReturns(rows));
    }
    return data;
  }

  // ================= カテゴリ =================
  // Amazon の Department（部門）を日本語の分類にまとめる。部門が空（Not Available）のときは商品名の言葉で推定する
  const CATS = ['PC・ガジェット', 'カメラ', 'オーディオ・楽器', '車・バイク・自転車', '衣類・服飾', '美容・健康', '食品・飲料', 'キッチン', '家具・日用品', '工具・DIY', '本', '文具・事務', 'ホビー・ゲーム', 'その他'];
  const DEPT = {
    'Personal Computers': 'PC・ガジェット', 'Electronics': 'PC・ガジェット', 'Wireless Phone Accessory': 'PC・ガジェット', 'Software Download': 'PC・ガジェット', 'Software': 'PC・ガジェット',
    'Camera': 'カメラ', 'Musical Instruments': 'オーディオ・楽器',
    'Automotive': '車・バイク・自転車', 'Sports': '車・バイク・自転車',
    'Apparel': '衣類・服飾', 'Shoes': '衣類・服飾', 'Watch': '衣類・服飾', 'Accessory': '衣類・服飾', 'Luggage': '衣類・服飾', 'Jewelry': '衣類・服飾',
    'Health and Beauty': '美容・健康', 'Beauty': '美容・健康', 'Drugstore': '美容・健康',
    'Grocery': '食品・飲料', 'Kitchen': 'キッチン', 'Home': '家具・日用品', 'Furniture': '家具・日用品', 'Pet Supplies': '家具・日用品', 'Baby Product': '家具・日用品',
    'Tools & Home Improvement': '工具・DIY', 'Tools & Hardware': '工具・DIY', 'Home Improvement': '工具・DIY',
    'Tankobon Hardcover': '本', 'Tankobon Softcover': '本', 'Mook': '本', 'Paperback Shinsho': '本', 'Paperback Bunko': '本', 'Book': '本', 'Magazine': '本', 'Comic': '本', 'Large Book': '本',
    'Office Product': '文具・事務', 'Toy': 'ホビー・ゲーム', 'Video Game': 'ホビー・ゲーム', 'Hobby': 'ホビー・ゲーム'
  };
  // 商品名の言葉（上から順に当てる）
  const WORDS = [
    ['カメラ', /カメラ|レンズ|一眼|ミラーレス|三脚|ストロボ|instax|チェキ|写ルンです|SDカード/i],
    ['オーディオ・楽器', /イヤホン|ヘッドホン|ヘッドフォン|スピーカー|オーディオ|イヤーピース|DAC|アンプ|マイク|ギター|ベース|ピック|弦|MIDI|キーボードスタンド/i],
    ['車・バイク・自転車', /車用|車載|カー用品|ワイパー|ウォッシャー|OBD|ブレーキ|タイヤ|ホイール|バッテリー.*車|洗車|ナンバー|自転車|サイクル|ロードバイク|チューブ.*バルブ|バイク用|ヘルメット/i],
    ['PC・ガジェット', /USB|HDMI|ケーブル|充電器|モバイルバッテリー|SSD|HDD|メモリ|CPU|マザーボード|グラフィック|ルーター|LAN|Wi-?Fi|マウス|キーボード|モニター|ディスプレイ|スマホ|iPhone|Android|Pixel|Xperia|Galaxy|ガラスフィルム|保護フィルム|タブレット|ノートパソコン|PC/i],
    ['美容・健康', /シャンプー|トリートメント|コンディショナー|ボディソープ|洗顔|化粧|乳液|美容液|クリーム|ヘア|歯ブラシ|歯磨き|サプリ|ビタミン|プロテイン|マスク|目薬|医薬品|香水|フレグランス|シェーバー|髭|爪/i],
    ['食品・飲料', /コーヒー|お茶|紅茶|ミネラルウォーター|天然水|飲料|ジュース|コーラ|ビール|お菓子|チョコ|米|食品|缶×|本入|カップ麺/i],
    ['キッチン', /フライパン|鍋|包丁|まな板|食器|グラス|マグ|タッパー|保存容器|水筒|ボトル/i],
    ['家具・日用品', /洗剤|柔軟剤|ティッシュ|トイレットペーパー|ハイター|漂白|掃除|クリーナー|シーツ|布団|枕|毛布|カバー|カーテン|ラグ|収納|ハンガー|ゴミ袋|椅子|チェア|テーブル|デスク|棚|ランプ|ライト|傘|耳栓/i],
    ['工具・DIY', /工具|ドライバー|レンチ|ソケット|ペンチ|ニッパー|トルク|ドリル|ビット|テープ|接着剤|グリス|結束バンド/i],
    ['衣類・服飾', /シャツ|パンツ|ジャケット|コート|スーツ|ソックス|靴下|下着|靴|スニーカー|ブーツ|ベルト|財布|バッグ|リュック|腕時計|帽子|キャップ|手袋/i],
    ['文具・事務', /ボールペン|ペン|ノート|手帳|ファイル|クリップ|付箋|封筒|文具|印鑑/i],
    ['本', /単行本|文庫|新書|雑誌|ムック|コミック|画集/i],
    ['ホビー・ゲーム', /プラモデル|フィギュア|ゲーム|トレカ|おもちゃ|パズル/i]
  ];
  function category(o) {
    // 部門「Electronics」はカメラやオーディオも含むので、商品名で分けられるものは先に分ける
    if (o.dept === 'Electronics') for (const [c, re] of WORDS.slice(0, 2)) if (re.test(o.name)) return c;
    if (o.dept && DEPT[o.dept]) return DEPT[o.dept];
    for (const [c, re] of WORDS) if (re.test(o.name)) return c;
    return 'その他';
  }

  // ================= 日時（タイムゾーン） =================
  const fmtCache = {};
  // 日時をタイムゾーン tz の年・月・日・時・曜日（0 = 月曜）に分ける
  function parts(d, tz) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }));
    const o = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[o.weekday];
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, wd, ym: `${o.year}-${o.month}`, ymd: `${o.year}-${o.month}-${o.day}` };
  }

  // ================= 集計 =================
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  function median(a) {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // 最も多い通貨（日本のアカウントなら JPY）
  function mainCurrency(rows) {
    const c = {};
    for (const r of rows) if (r.currency) c[r.currency] = (c[r.currency] || 0) + 1;
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '';
  }
  // 年月の列（'2024-11' から n か月さかのぼる）
  function monthsBack(ym, n) {
    let [y, m] = ym.split('-').map(Number);
    const out = [];
    for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, '0')}`); if (--m === 0) { m = 12; y--; } }
    return out;
  }

  // プライム会費（2026年11月時点の公表料金、税込）。会費が変わったら直す
  const PRIME = { monthly: 600, annual: 5900, asOf: '2026-11' };

  // period：'all'（全期間）・'last12'（基準日から 12 か月）・'2024' など年
  // now：'last12' の基準日（省略すると現在）。tz：集計に使うタイムゾーン
  function analyze(data, opt = {}) {
    const tz = opt.tz || 'Asia/Tokyo';
    const period = opt.period || 'all';
    const now = opt.now || new Date();
    const cur = mainCurrency(data.orders.length ? data.orders : data.digital);
    const all = data.orders.map(o => ({ ...o, p: parts(o.date, tz) }));
    const other = all.filter(o => o.currency && cur && o.currency !== cur).length;
    const valid = all.filter(o => !o.cancelled && (!o.currency || !cur || o.currency === cur));
    const cancelled = all.filter(o => o.cancelled).length;
    const since = new Date(now.getTime() - 365 * 864e5);
    const inPeriod = o => period === 'all' ? true : period === 'last12' ? (o.date >= since && o.date <= now) : String(o.p.y) === String(period);
    const rows = valid.filter(inPeriod);
    const dig = data.digital.filter(d => !d.currency || !cur || d.currency === cur).map(d => ({ ...d, p: parts(d.date, tz) }));
    const digIn = dig.filter(inPeriod);

    // 年別（期間によらず全期間）
    const years = [...new Set([...valid.map(o => o.p.y), ...dig.map(d => d.p.y)])].sort((a, b) => a - b);
    const yearly = years.map(y => {
      const r = valid.filter(o => o.p.y === y);
      return { year: y, amount: sum(r, o => o.amount), orders: new Set(r.map(o => o.id)).size, items: r.length, digital: sum(dig.filter(d => d.p.y === y), d => d.amount) };
    });

    // 月別：年を選んだら 1〜12 月、それ以外は最後の注文月までの 12（全期間は 36）か月
    let months;
    if (/^\d{4}$/.test(String(period))) months = Array.from({ length: 12 }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
    else {
      const last = period === 'last12' ? parts(now, tz).ym : (valid.length ? valid.reduce((a, o) => (o.p.ym > a ? o.p.ym : a), '0000-00') : parts(now, tz).ym);
      months = monthsBack(last, period === 'last12' ? 12 : 36);
    }
    const mm = {};
    for (const o of valid) mm[o.p.ym] = (mm[o.p.ym] || 0) + o.amount;
    const monthly = months.map(ym => ({ ym, amount: mm[ym] || 0 }));

    // カテゴリ
    const cm = {};
    for (const o of rows) { const c = category(o); (cm[c] || (cm[c] = { cat: c, amount: 0, items: 0 })); cm[c].amount += o.amount; cm[c].items++; }
    const categories = Object.values(cm).sort((a, b) => b.amount - a.amount);

    // 注文ごとの合計（中央値、時間帯・曜日の数え方に使う）
    const om = new Map();
    for (const o of rows) { const k = o.id || `${o.date.getTime()}`; if (!om.has(k)) om.set(k, { amount: 0, p: o.p }); om.get(k).amount += o.amount; }
    const orderList = [...om.values()];
    const hour = Array(24).fill(0), dow = Array(7).fill(0);
    for (const o of orderList) { hour[o.p.h]++; dow[o.p.wd]++; }

    // 高額の商品（1 行 = 1 商品）
    const top = [...rows].sort((a, b) => b.amount - a.amount).slice(0, 20)
      .map(o => ({ date: o.p.ymd, name: o.name, amount: o.amount, qty: o.qty, used: o.used, cat: category(o) }));

    // リピート購入：同じ ASIN（無ければ商品名）を 2 回以上買った商品
    const rm = new Map();
    for (const o of rows) {
      const k = o.asin || o.name;
      if (!rm.has(k)) rm.set(k, { name: o.name, count: 0, qty: 0, amount: 0, first: o.p.ymd, last: o.p.ymd, dates: [] });
      const r = rm.get(k); r.count++; r.qty += o.qty; r.amount += o.amount; r.dates.push(o.date.getTime());
      if (o.p.ymd < r.first) r.first = o.p.ymd; if (o.p.ymd > r.last) { r.last = o.p.ymd; r.name = o.name; }
    }
    const repeat = [...rm.values()].filter(r => r.count >= 2).map(r => {
      const d = r.dates.sort((a, b) => a - b);
      const gaps = d.slice(1).map((t, i) => (t - d[i]) / 864e5);
      return { name: r.name, count: r.count, qty: r.qty, amount: r.amount, first: r.first, last: r.last, interval: gaps.length ? median(gaps) : NaN };
    }).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 20);

    // デジタル：商品名ごと
    const dm = {};
    for (const d of digIn) { (dm[d.name] || (dm[d.name] = { name: d.name, amount: 0, orders: new Set() })); dm[d.name].amount += d.amount; dm[d.name].orders.add(d.id); }
    const digitalItems = Object.values(dm).filter(x => x.amount !== 0).map(x => ({ name: x.name, amount: x.amount, orders: x.orders.size })).sort((a, b) => b.amount - a.amount);

    // プライム会費：基準日から 12 か月の支払い
    const isPrime = n => /^(Amazon\s*)?Prime(\s*(会員|Membership|月額|年会費).*)?$/i.test(n) || /プライム会費|Prime Membership/i.test(n);
    const primePay = new Map();
    for (const d of dig) if (isPrime(d.name) && d.date >= since && d.date <= now) primePay.set(d.id, (primePay.get(d.id) || 0) + d.amount);
    const pays = [...primePay.values()].filter(v => v > 0);
    const prime = {
      payments: pays.length, amount: sum(pays, v => v),
      total: sum(dig.filter(d => isPrime(d.name)), d => d.amount),
      // 12 か月に 2 回以上払っていれば月額プランとみなす
      monthly: pays.length >= 2,
      price: PRIME
    };
    prime.saving = prime.monthly ? PRIME.monthly * 12 - PRIME.annual : 0;

    // Kindle の貸出
    const bIn = data.borrow.filter(b => period === 'all' ? true : period === 'last12' ? (b.date >= since && b.date <= now) : String(parts(b.date, tz).y) === String(period));
    const bp = {};
    for (const b of bIn) bp[b.program] = (bp[b.program] || 0) + 1;
    const borrow = { count: bIn.length, programs: Object.entries(bp).map(([program, count]) => ({ program, count })).sort((a, b) => b.count - a.count) };

    // 返品
    const ret = data.returns.filter(r => !r.date || period === 'all' || (period === 'last12' ? (r.date >= since && r.date <= now) : String(parts(r.date, tz).y) === String(period)));
    const returns = { count: ret.length, refund: sum(ret, r => (Number.isFinite(r.amount) ? r.amount : 0)), list: ret.map(r => ({ date: r.date ? parts(r.date, tz).ymd : '', reason: r.reason, resolution: r.resolution, amount: r.amount })) };

    const amounts = rows.map(o => o.amount);
    const usedRows = rows.filter(o => o.used);
    const total = sum(rows, o => o.amount);
    const firstDate = valid.length ? valid.reduce((a, o) => (o.date < a ? o.date : a), valid[0].date) : null;
    const lastDate = valid.length ? valid.reduce((a, o) => (o.date > a ? o.date : a), valid[0].date) : null;
    const kpi = {
      total, orders: om.size, items: rows.length,
      medianItem: median(amounts), medianOrder: median(orderList.map(o => o.amount)),
      used: sum(usedRows, o => o.amount), usedItems: usedRows.length, usedShare: total ? sum(usedRows, o => o.amount) / total : NaN,
      digital: sum(digIn, d => d.amount),
      cancelled, otherCurrency: other, currency: cur,
      first: firstDate ? parts(firstDate, tz).ymd : '', last: lastDate ? parts(lastDate, tz).ymd : '',
      perMonth: period === 'last12' ? total / 12 : NaN
    };
    return { period, tz, kpi, yearly, monthly, categories, hour, dow, top, repeat, digitalItems, prime, borrow, returns, years };
  }

  // 明細の一覧（検索・並べ替え用）
  function itemList(data, tz) {
    tz = tz || 'Asia/Tokyo';
    return data.orders.map(o => ({ date: parts(o.date, tz).ymd, name: o.name, cat: category(o), qty: o.qty, amount: o.amount, used: o.used, cancelled: o.cancelled, currency: o.currency }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  const api = { parseCSV, readZip, detectKind, KIND_LABEL, load, category, CATS, parts, analyze, itemList, money, median, PRIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AmazonOrder = api;
})(typeof window !== 'undefined' ? window : globalThis);
