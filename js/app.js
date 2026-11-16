// 画面処理：ファイルの読み込み、集計の表示（グラフ・表）、明細、テーマ、条件の保存、Service Worker の登録
// 読み込んだ注文データはメモリにだけ置き、保存も送信もしない
(function () {
  'use strict';
  const AO = window.AmazonOrder, DEMO = window.AmazonDemo;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (v, d = 0) => !Number.isFinite(v) ? '―' : v.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
  function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2400); }
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境 */ } } };
  // 保存するのは表示の条件だけ（期間・タイムゾーン・タブ）。注文データは保存しない
  const KEY = 'amazon-order-analyzer-inputs';
  const st = { period: 'all', tz: 'Asia/Tokyo', tab: 'main', q: '', qCat: '', qSort: 'date', ...(store.get(KEY) || {}) };
  const save = () => store.set(KEY, { period: st.period, tz: st.tz, tab: st.tab, qSort: st.qSort });

  let data = null, res = null, cur = '';
  // 通貨の表示（円は ¥、それ以外は通貨コードを後ろに付ける）
  const money = v => !Number.isFinite(v) ? '―' : cur === 'JPY' || !cur ? `¥${fmt(Math.round(v))}` : `${fmt(v, 2)} ${cur}`;
  const short = v => {
    if (!Number.isFinite(v)) return '';
    if (cur && cur !== 'JPY') return Math.abs(v) >= 1000 ? fmt(v / 1000, 1) + 'k' : fmt(v);
    return Math.abs(v) >= 10000 ? fmt(v / 10000, Math.abs(v) >= 1e6 ? 0 : 1) + '万' : fmt(v);
  };

  // ---- タイムゾーンの選択肢 ----
  const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
  const TZS = [['Asia/Tokyo', '日本時間（JST）'], ['UTC', '世界標準時（UTC）']];
  if (localTz && !TZS.some(t => t[0] === localTz)) TZS.push([localTz, `この端末の時間（${localTz}）`]);
  $('tz').innerHTML = TZS.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  if (!TZS.some(t => t[0] === st.tz)) st.tz = 'Asia/Tokyo';
  $('tz').value = st.tz;

  // ---- 読み込み ----
  async function readFiles(list) {
    const files = [];
    for (const f of list) {
      try {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
          const inner = await AO.readZip(await f.arrayBuffer());
          files.push(...inner);
        } else if (/\.csv$/i.test(f.name) || /csv|text/.test(f.type)) {
          files.push({ name: f.name, text: await f.text() });
        } else toast(`${f.name} はZIPでもCSVでもないので読みません`);
      } catch (e) { toast(`${f.name}：${e.message}`); }
    }
    if (!files.length) return;
    setData(AO.load(files));
  }
  function setData(d) {
    data = d;
    if (!data.orders.length && !data.digital.length) {
      toast('注文履歴のCSVが見つかりませんでした。Order History.csvを含むZIPか、そのCSVを選んでください');
    }
    // 期間の選択肢が無くなったら全期間に戻す
    renderAll();
  }
  $('file').addEventListener('change', e => { readFiles([...e.target.files]); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => readFiles([...e.dataTransfer.files]));
  $('demo').addEventListener('click', () => { setData(AO.load(DEMO.makeDemo(20261116, new Date()))); toast('架空の注文データを入れました'); });
  $('clear').addEventListener('click', () => { data = null; res = null; renderAll(); toast('データを消しました'); });
  $('period').addEventListener('change', e => { st.period = e.target.value; save(); renderAll(); });
  $('tz').addEventListener('change', e => { st.tz = e.target.value; save(); renderAll(); });

  // ---- 表示 ----
  function periodOptions() {
    const years = res ? res.years : [];
    const opts = [['all', '全期間'], ['last12', '直近12か月'], ...[...years].reverse().map(y => [String(y), `${y}年`])];
    if (!opts.some(o => o[0] === st.period)) st.period = 'all';
    $('period').innerHTML = opts.map(([v, t]) => `<option value="${v}"${v === st.period ? ' selected' : ''}>${t}</option>`).join('');
  }
  const periodLabel = () => st.period === 'all' ? '全期間' : st.period === 'last12' ? '直近12か月' : `${st.period}年`;

  function renderAll() {
    const has = !!(data && (data.orders.length || data.digital.length));
    $('clear').hidden = !data;
    $('loadHint').hidden = !!data; // 読み込んだ後は説明を畳んで、スマホで結果を上に出す
    $('optBox').hidden = !has;
    renderFiles();
    if (!has) {
      res = null; periodOptions();
      $('emptyBox').hidden = false;
      ['kpiBox', 'yearBox', 'monthBox', 'catBox', 'timeBox', 'repBox', 'topBox', 'digBox'].forEach(id => { $(id).hidden = true; });
      renderItems();
      return;
    }
    res = AO.analyze(data, { period: 'all', tz: st.tz }); // 期間の選択肢を作るため
    periodOptions();
    res = AO.analyze(data, { period: st.period, tz: st.tz });
    cur = res.kpi.currency;
    $('emptyBox').hidden = true;
    renderKpi(); renderYear(); renderMonth(); renderCat(); renderTime(); renderRepeat(); renderTop(); renderDigital(); renderItems();
  }

  function renderFiles() {
    if (!data) { $('files').innerHTML = ''; return; }
    $('files').innerHTML = data.files.map(f => `<li><span class="fn" title="${esc(f.name)}">${esc(f.name.split('/').pop())}</span>` +
      (f.kind ? `<span class="k">${esc(AO.KIND_LABEL[f.kind])}</span><span class="n">${fmt(f.rows)}行</span>` : '<span class="k no">使わない</span>') + '</li>').join('');
  }

  function renderKpi() {
    const k = res.kpi;
    $('kpiBox').hidden = false;
    $('kpiTitle').textContent = `購入額（${periodLabel()}）`;
    $('kpiRange').textContent = k.first ? `読み込んだ注文：${k.first}〜${k.last}（${cur || '通貨不明'}）` : '';
    const cells = [
      ['main', '物品の合計', money(k.total), `${fmt(k.orders)}注文・${fmt(k.items)}点`],
      ['', st.period === 'last12' ? '1か月あたり' : '1注文あたり（中央値）', st.period === 'last12' ? money(k.perMonth) : money(k.medianOrder), st.period === 'last12' ? `1注文の中央値 ${money(k.medianOrder)}` : `1点の中央値 ${money(k.medianItem)}`],
      ['', '中古品', money(k.used), `${fmt(k.usedItems)}点・${Number.isFinite(k.usedShare) ? fmt(k.usedShare * 100, 1) : '―'}%`],
      ['', 'デジタル', money(k.digital), '会費・電子書籍など']
    ];
    $('kpi').innerHTML = cells.map(([c, l, v, s]) => `<div class="${c}"><span>${l}</span><b>${v}</b><small>${s}</small></div>`).join('');
    // 注意・気づき
    const m = [];
    if (k.cancelled) m.push(['info', `キャンセルした${fmt(k.cancelled)}点は、金額と件数に含めていません。`]);
    if (k.otherCurrency) m.push(['warn', `${cur}以外の通貨の注文が${fmt(k.otherCurrency)}点あります。通貨を混ぜて足さないよう、${cur}の注文だけを集計しています。`]);
    const p = res.prime;
    if (p.monthly && cur === 'JPY') m.push(['ok', `プライム会費を月額で払っています（直近12か月に${p.payments}回・${money(p.amount)}）。年間プラン（${fmt(p.price.annual)}円）にすると、1年で${fmt(p.saving)}円安くなります（${p.price.asOf.replace('-', '年')}月時点の公表料金）。`]);
    if (!data.orders.length) m.push(['warn', '物品の注文（Order History.csv）が読み込まれていません。デジタルだけを集計しています。']);
    $('msgs').innerHTML = m.map(([c, t]) => `<div class="msg ${c}">${esc(t)}</div>`).join('');
  }

  // ---- 縦棒グラフ ----
  // rows：{label, v, v2（積み上げ）, tip, sel}。o.values で棒の上に値、o.sparse で空でない目盛りだけ出す
  // o.readout：棒に触れたとき・押したときに値を書く要素（スマホでも値が読めるように）
  function vbars(el, rows, o) {
    const W = Math.max(280, el.clientWidth || 600), H = o.h || 200, m = { t: o.values ? 22 : 14, r: 8, b: 22, l: 44 };
    const max = Math.max(1, ...rows.map(r => r.v + (r.v2 || 0)));
    const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
    const y = v => H - m.b - (v / top) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / rows.length, gap = Math.min(8, bw * 0.28);
    const anySel = rows.some(r => r.sel);
    let s = '';
    for (let v = 0; v <= top + 1e-9; v += step) s += `<line class="gl" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 3.5}" text-anchor="end">${o.yfmt ? o.yfmt(v) : short(v)}</text>`;
    const every = Math.max(1, Math.ceil(rows.length / Math.floor((W - m.l) / (o.labW || 34))));
    const showVal = o.values && bw >= 30;
    rows.forEach((r, i) => {
      const x = m.l + i * bw + gap / 2, w = Math.max(1, bw - gap);
      const dim = anySel && !r.sel ? ' dim' : '';
      s += `<rect class="bar${dim}" x="${x}" y="${y(r.v)}" width="${w}" height="${Math.max(0, y(0) - y(r.v))}"/>`;
      if (r.v2) s += `<rect class="bar2${dim}" x="${x}" y="${y(r.v + r.v2)}" width="${w}" height="${Math.max(0, y(r.v) - y(r.v + r.v2))}"/>`;
      if (showVal && r.v + (r.v2 || 0) > 0) s += `<text class="val${dim}" x="${x + w / 2}" y="${y(r.v + (r.v2 || 0)) - 5}" text-anchor="middle">${o.vfmt ? o.vfmt(r.v + (r.v2 || 0)) : short(r.v + (r.v2 || 0))}</text>`;
      if (o.sparse ? r.label : i % every === 0) s += `<text class="${r.sel ? 'val' : ''}" x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(r.label)}</text>`;
      s += `<rect class="hit" data-i="${i}" x="${m.l + i * bw}" y="${m.t}" width="${bw}" height="${H - m.t - m.b}"><title>${esc(r.tip)}</title></rect>`;
    });
    if (o.avg) { const a = rows.reduce((t, r) => t + r.v, 0) / rows.length; s += `<line class="avg" x1="${m.l}" x2="${W - m.r}" y1="${y(a)}" y2="${y(a)}"/>`; }
    s += `<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label)}">${s}</svg>`;
    const ro = o.readout ? $(o.readout) : null;
    const base = ro ? (o.readoutDefault || '') : '';
    if (ro) ro.textContent = base;
    el.querySelectorAll('.hit').forEach(h => {
      const r = rows[+h.dataset.i];
      if (ro) { h.addEventListener('pointerenter', () => { ro.textContent = r.tip; }); h.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') ro.textContent = base; }); }
      h.addEventListener('click', () => { if (ro) ro.textContent = r.tip; if (o.onPick) o.onPick(r); });
    });
  }
  function niceStep(x) {
    if (!(x > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(x)), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function renderYear() {
    $('yearBox').hidden = false;
    const rows = res.yearly.map(y => ({ label: `'${String(y.year).slice(2)}`, v: y.amount, v2: Math.max(0, y.digital), sel: String(y.year) === st.period, year: y.year,
      tip: `${y.year}年　物品 ${money(y.amount)}（${fmt(y.orders)}注文・${fmt(y.items)}点）　デジタル ${money(y.digital)}` }));
    vbars($('figYear'), rows, { label: '年別の購入額', labW: 30, values: true, readout: 'roYear', readoutDefault: /^\d{4}$/.test(st.period) ? `${st.period}年だけを集計しています。もう一度押すと全期間に戻ります。` : '棒を押すと、その年だけを集計します。',
      onPick: r => { st.period = st.period === String(r.year) ? 'all' : String(r.year); save(); renderAll(); } });
  }
  function renderMonth() {
    $('monthBox').hidden = false;
    $('monthTitle').textContent = /^\d{4}$/.test(st.period) ? `月別の購入額（${st.period}年）` : st.period === 'last12' ? '月別の購入額（直近12か月）' : '月別の購入額（最後の注文から36か月）';
    const n = res.monthly.length;
    // 12 か月なら「1月」…、36 か月なら 1 月の位置にだけ年を書く
    const rows = res.monthly.map(x => ({ label: n <= 12 ? `${+x.ym.slice(5)}月` : (x.ym.endsWith('-01') ? x.ym.slice(0, 4) : ''), v: x.amount, tip: `${x.ym.replace('-', '年')}月　${money(x.amount)}` }));
    const avg = rows.reduce((t, r) => t + r.v, 0) / (rows.length || 1);
    vbars($('figMonth'), rows, { label: '月別の購入額', avg: true, labW: 30, sparse: n > 12, values: n <= 12, readout: 'roMonth', readoutDefault: `点線は平均の${money(avg)}です。棒に触れると、その月の金額を出します。` });
  }
  function renderCat() {
    $('catBox').hidden = !res.categories.length;
    const rows = res.categories, el = $('figCat');
    const W = Math.max(280, el.clientWidth || 600), rh = 24, H = rows.length * rh + 8;
    const total = rows.reduce((t, r) => t + r.amount, 0) || 1;
    const lw = 118, vw = 132, max = Math.max(1, ...rows.map(r => r.amount));
    const x = v => lw + (v / max) * (W - lw - vw);
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="カテゴリ別の購入額">` + rows.map((r, i) => {
      const yy = 4 + i * rh;
      return `<text class="lab" x="4" y="${yy + 15}">${esc(r.cat)}</text><rect class="bar" x="${lw}" y="${yy + 4}" width="${Math.max(1, x(r.amount) - lw)}" height="${rh - 8}"/>` +
        `<text class="val" x="${x(r.amount) + 6}" y="${yy + 15}">${short(r.amount)}・${fmt(r.amount / total * 100, 0)}%・${fmt(r.items)}点</text>` +
        `<rect class="hit" x="0" y="${yy}" width="${W}" height="${rh}"><title>${esc(r.cat)}　${money(r.amount)}（${fmt(r.amount / total * 100, 1)}%）${fmt(r.items)}点</title></rect>`;
    }).join('') + '</svg>';
  }
  function renderTime() {
    $('timeBox').hidden = false;
    const H = res.hour, D = res.dow, DN = ['月', '火', '水', '木', '金', '土', '日'];
    const tot0 = H.reduce((a, b) => a + b, 0) || 1;
    vbars($('figHour'), H.map((v, h) => ({ label: String(h), v, tip: `${h}時台　${fmt(v)}注文（${fmt(v / tot0 * 100, 0)}%）` })), { label: '時間帯別の注文数', labW: 22, yfmt: v => fmt(v), h: 170 });
    vbars($('figDow'), D.map((v, i) => ({ label: DN[i], v, tip: `${DN[i]}曜日　${fmt(v)}注文（${fmt(v / tot0 * 100, 0)}%）` })), { label: '曜日別の注文数', yfmt: v => fmt(v), vfmt: v => fmt(v), values: true, h: 170 });
    const tot = H.reduce((a, b) => a + b, 0);
    const top3 = H.map((v, h) => [v, h]).sort((a, b) => b[0] - a[0]).slice(0, 3).filter(x => x[0] > 0).map(x => `${x[1]}時台`);
    $('hourNote').textContent = tot ? `多いのは${top3.join('・')}です。` : '';
    const dmax = D.indexOf(Math.max(...D)), dmin = D.indexOf(Math.min(...D));
    $('dowNote').textContent = tot ? `最も多いのは${DN[dmax]}曜日、少ないのは${DN[dmin]}曜日です。` : '';
  }
  // 長い表は 10 行まで出し、ボタンで全部を出す
  const openAll = { rep: false, top: false };
  function moreBtn(id, key, total) {
    const b = $(id);
    b.hidden = total <= 10;
    b.textContent = openAll[key] ? '10件だけ表示する' : `すべて表示する（${total}件）`;
    b.onclick = () => { openAll[key] = !openAll[key]; key === 'rep' ? renderRepeat() : renderTop(); };
  }
  function renderRepeat() {
    const all = res.repeat, r = openAll.rep ? all : all.slice(0, 10);
    moreBtn('repMore', 'rep', all.length);
    $('repBox').hidden = !all.length;
    $('repTable').innerHTML = '<thead><tr><th>商品</th><th class="r">回数</th><th class="r">合計</th><th class="r">間隔</th><th class="r">最後</th></tr></thead><tbody>' +
      r.map(x => `<tr><td class="nm">${esc(x.name)}</td><td class="r">${fmt(x.count)}回</td><td class="r">${money(x.amount)}</td><td class="r">${Number.isFinite(x.interval) ? fmt(x.interval) + '日' : '―'}</td><td class="d">${esc(x.last)}</td></tr>`).join('') + '</tbody>';
  }
  function renderTop() {
    const all = res.top, r = openAll.top ? all : all.slice(0, 10);
    moreBtn('topMore', 'top', all.length);
    $('topBox').hidden = !all.length;
    $('topTable').innerHTML = '<thead><tr><th>日付</th><th>商品</th><th class="r">金額</th></tr></thead><tbody>' +
      r.map(x => `<tr><td class="d">${esc(x.date)}</td><td class="nm">${esc(x.name)}${x.used ? '<span class="tag">中古</span>' : ''}${x.qty > 1 ? `<span class="tag">${fmt(x.qty)}個</span>` : ''}<span class="tag">${esc(x.cat)}</span></td><td class="r">${money(x.amount)}</td></tr>`).join('') + '</tbody>';
  }
  function renderDigital() {
    const d = res.digitalItems.slice(0, 10), b = res.borrow, rt = res.returns, p = res.prime;
    const show = d.length || b.count || rt.count || p.total;
    $('digBox').hidden = !show;
    const tiles = [
      ['デジタルの支払い', money(res.kpi.digital), `${periodLabel()}・返金を差し引いた額`],
      ['プライム会費の累計', p.total ? money(p.total) : '―', p.monthly ? '月額プランで支払い中' : (p.total ? '全期間の合計' : '支払いの記録なし')],
      ['Kindleの貸出', `${fmt(b.count)}<small>冊</small>`, b.programs.length ? b.programs.map(x => `${esc(x.program)} ${fmt(x.count)}`).join('・') : '貸出の記録なし'],
      ['返品', `${fmt(rt.count)}<small>件</small>`, rt.count ? `返金 ${money(rt.refund)}` : '返品の記録なし']
    ];
    let h = `<div class="kpi four">${tiles.map(([l, v, sub]) => `<div><span>${l}</span><b>${v}</b><small>${sub}</small></div>`).join('')}</div>`;
    if (d.length) h += '<h3>支払いの多いデジタルの商品・サービス</h3><div class="scroll"><table class="list"><thead><tr><th>商品・サービス</th><th class="r">回数</th><th class="r">合計</th></tr></thead><tbody>' +
      d.map(x => `<tr><td class="nm">${esc(x.name)}</td><td class="r">${fmt(x.orders)}回</td><td class="r">${money(x.amount)}</td></tr>`).join('') + '</tbody></table></div>';
    if (b.count) h += '<p class="hint">Kindleの貸出は読み放題（Kindle Unlimited・Prime Reading）で読んだ本で、支払いはありません。</p>';
    $('digOut').innerHTML = h;
  }

  // ---- 明細 ----
  let itemRows = [];
  function renderItems() {
    const cats = AO.CATS;
    if (!$('qCat').options.length) $('qCat').innerHTML = '<option value="">すべて</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
    $('qSort').value = st.qSort;
    if (!data || !data.orders.length) { itemRows = []; $('itemTable').innerHTML = ''; $('itemCount').textContent = ''; return; }
    const now = new Date(), since = new Date(now.getTime() - 365 * 864e5);
    let rows = AO.itemList(data, st.tz).filter(r => {
      if (st.period === 'all') return true;
      if (st.period === 'last12') { const d = new Date(r.date + 'T00:00:00'); return d >= since && d <= now; }
      return r.date.startsWith(st.period + '-');
    });
    const q = $('q').value.trim().toLowerCase(), qc = $('qCat').value;
    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));
    if (qc) rows = rows.filter(r => r.cat === qc);
    if (st.qSort === 'amount') rows.sort((a, b) => b.amount - a.amount);
    else if (st.qSort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    itemRows = rows;
    const valid = rows.filter(r => !r.cancelled);
    $('itemCount').textContent = `${periodLabel()}・${fmt(rows.length)}点・合計 ${money(valid.reduce((t, r) => t + r.amount, 0))}`;
    $('itemTable').innerHTML = '<thead><tr><th>日付</th><th>商品</th><th>カテゴリ</th><th class="r">数</th><th class="r">金額</th></tr></thead><tbody>' +
      rows.slice(0, 1000).map(r => `<tr${r.cancelled ? ' class="cx"' : ''}><td class="d">${esc(r.date)}</td><td class="nm">${esc(r.name)}${r.used ? '<span class="tag">中古</span>' : ''}</td><td>${esc(r.cat)}</td><td class="r">${fmt(r.qty)}</td><td class="r">${money(r.amount)}</td></tr>`).join('') + '</tbody>';
  }
  $('q').addEventListener('input', renderItems);
  $('qCat').addEventListener('change', renderItems);
  $('qSort').addEventListener('change', e => { st.qSort = e.target.value; save(); renderItems(); });

  // ---- コピー（Excel 用、タブ区切り） ----
  function copyRows(rows) {
    if (!rows.length) { toast('先に注文履歴を読み込んでください'); return; }
    const text = rows.map(r => r.map(c => String(c).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
    const done = () => toast('コピーしました。Excelに貼り付けられます');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* 失敗 */ }
      ta.remove(); toast(ok ? 'コピーしました。Excelに貼り付けられます' : 'コピーできませんでした。表を選んでコピーしてください');
    }
  }
  $('copyYear').addEventListener('click', () => copyRows(res ? [['年', '物品の金額', '注文数', '点数', 'デジタルの金額'], ...res.yearly.map(y => [y.year, y.amount, y.orders, y.items, y.digital])] : []));
  $('copyItems').addEventListener('click', () => copyRows(itemRows.length ? [['日付', '商品', 'カテゴリ', '数', '金額', '中古', 'キャンセル'], ...itemRows.map(r => [r.date, r.name, r.cat, r.qty, r.amount, r.used ? '中古' : '', r.cancelled ? 'キャンセル' : ''])] : []));

  // ---- タブ ----
  function setTab(t) {
    st.tab = t; save();
    document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $('mainPanel').hidden = t !== 'main'; $('itemsPanel').hidden = t !== 'items'; $('explainPanel').hidden = t !== 'explain';
    if (t === 'main' && res) renderAll();
  }
  document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---- テーマ ----
  const THEME_LABEL = { auto: '表示：自動', light: '表示：ライト', dark: '表示：ダーク' };
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    $('themeBtn').textContent = THEME_LABEL[t];
  }
  let theme = 'auto';
  try { theme = localStorage.getItem('qc-workbench-theme') || 'auto'; } catch (e) { /* 保存できない環境 */ }
  if (!THEME_LABEL[theme]) theme = 'auto';
  applyTheme(theme);
  $('themeBtn').addEventListener('click', () => {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    try { if (theme === 'auto') localStorage.removeItem('qc-workbench-theme'); else localStorage.setItem('qc-workbench-theme', theme); } catch (e) { /* 保存できない環境 */ }
    applyTheme(theme);
  });

  const setHdr = () => document.documentElement.style.setProperty('--hdr', document.querySelector('header.top').offsetHeight + 'px');
  setHdr();
  // 幅が変わったらグラフを描き直す
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { setHdr(); if (res && st.tab === 'main') { renderYear(); renderMonth(); renderCat(); renderTime(); } }, 150); });

  setTab(['main', 'items', 'explain'].includes(st.tab) ? st.tab : 'main');
  renderAll();

  // ---- オフライン対応 ----
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing; if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('新しい版を取り込みました。開き直すと反映されます'); });
        });
      }).catch(() => { /* 登録できない環境 */ });
    });
  }
})();
