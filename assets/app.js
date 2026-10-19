(function () {
'use strict';
const D = window.NSDATA;
const TX = D.tx, BUD = D.budgets, EMPS = D.emps, VEND = D.vendors, FLAGS = D.flags, F = D.F;
const MONTHS = [...new Set(TX.map(t => t.m))].sort();
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const mlabel = m => MN[+m.slice(5, 7) - 1] + ' ' + m.slice(2, 4);
const empName = {}; TX.forEach(t => empName[t.eid] = t.emp);
const vendMaster = {}; VEND.forEach(v => vendMaster[v.name] = v);

/* ---------- formatting ---------- */
const nf = new Intl.NumberFormat('en-IN');
const full = n => nf.format(Math.round(n));
const inr = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; if (a >= 1e7) return s + 'INR ' + (a / 1e7).toFixed(2) + ' Cr'; if (a >= 1e5) return s + 'INR ' + (a / 1e5).toFixed(1) + ' L'; return s + 'INR ' + full(a); };
const short = n => { const a = Math.abs(n); if (a >= 1e7) return (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + ' Cr'; if (a >= 1e5) return (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + ' L'; if (a >= 1e3) return (a / 1e3).toFixed(0) + 'k'; return String(Math.round(a)); };
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const sgn = x => (x >= 0 ? '+' : '-') + Math.abs(x * 100).toFixed(1) + '%';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trunc = (s, n) => s.length > n ? s.slice(0, n - 1) + '...' : s;
const sum = (L, f) => { let a = 0; for (const t of L) a += f ? f(t) : t.amt; return a; };
const sevOf = sc => sc >= 7 ? 'h' : sc >= 4 ? 'm' : 'l';
const SEVN = { h: 'High', m: 'Medium', l: 'Low' };
const GREY = ['#f1f1f2', '#c3c3c8', '#9a9aa1', '#74747b', '#4d4d54', '#35353b'];

/* ---------- state ---------- */
const DIMS = [
  { k: 'm', label: 'Month', get: t => t.m, name: mlabel },
  { k: 'dept', label: 'Department', get: t => t.dept },
  { k: 'site', label: 'Site', get: t => t.site },
  { k: 'proj', label: 'Project', get: t => t.proj },
  { k: 'eid', label: 'Employee', get: t => t.eid, name: id => empName[id] + ' (' + id + ')' },
  { k: 'vendor', label: 'Vendor', get: t => t.vendor },
  { k: 'cat', label: 'Category', get: t => t.cat },
  { k: 'pay', label: 'Payment method', get: t => t.pay },
  { k: 'appr', label: 'Approval', get: t => t.appr },
  { k: 'st', label: 'Status', get: t => t.st },
];
const DIM = {}; DIMS.forEach(d => DIM[d.k] = d);
const S = { basis: 'effective', view: 'overview', f: {}, open: null, fq: '' };
DIMS.forEach(d => S.f[d.k] = new Set());
const TS = {};                       // table sort state
const EX = { flags: new Set(), sev: 'all', q: '', page: 0 };
const VIEWS = [
  ['overview', 'Overview'], ['budget', 'Budget'], ['spend', 'Spend breakdown'], ['vendors', 'Vendors'],
  ['people', 'People'], ['controls', 'Controls'], ['exceptions', 'Exceptions'], ['findings', 'Findings'], ['notes', 'Data notes']
];

function sel(only) {
  const act = DIMS.filter(d => S.f[d.k].size && (!only || only.includes(d.k)));
  return TX.filter(t => (S.basis === 'all' || t.eff) && act.every(d => S.f[d.k].has(d.get(t))));
}
const except = (...ks) => DIMS.map(d => d.k).filter(k => !ks.includes(k));
const inSet = (k, v) => !S.f[k].size || S.f[k].has(v);
function groupBy(L, kf, vf) {
  const m = new Map();
  for (const t of L) { const k = kf(t); let o = m.get(k); if (!o) { o = { k, v: 0, n: 0, rows: [] }; m.set(k, o); } o.v += vf ? vf(t) : t.amt; o.n++; o.rows.push(t); }
  return [...m.values()];
}
const desc = (a, b) => b.v - a.v;

/* ---------- chart primitives (inline SVG) ---------- */
const CH = {};
function chart(id, fn) { if (fn) CH[id] = fn; return `<div class="chart" data-chart="${id}"></div>`; }
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const tipA = s => `data-tip="${esc(s)}"`;

function barV(w, h, items, o = {}) {
  const ml = 46, mr = o.pctLine ? 38 : 10, mt = 12, mb = 24, iw = w - ml - mr, ih = h - mt - mb;
  const max = niceMax(Math.max(1, ...items.map(i => i.v), ...(o.line && !o.pctLine ? o.line.map(l => l.v) : [0])));
  const bw = iw / items.length, bwid = Math.min(54, bw * 0.62);
  let s = `<svg width="${w}" height="${h}" role="img">`;
  for (let i = 0; i <= 4; i++) {
    const y = mt + ih - ih * i / 4;
    s += `<line class="grid" x1="${ml}" x2="${w - mr}" y1="${y}" y2="${y}"/><text x="${ml - 8}" y="${y + 4}" text-anchor="end">${o.axisFmt ? o.axisFmt(max * i / 4) : short(max * i / 4)}</text>`;
    if (o.pctLine) s += `<text x="${w - mr + 6}" y="${y + 4}">${i * 25}%</text>`;
  }
  items.forEach((it, i) => {
    const x = ml + bw * i + (bw - bwid) / 2, bh = ih * it.v / max, y = mt + ih - bh;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bwid.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" fill="${it.dim ? '#3a3a40' : (it.fill || '#cfcfd4')}" rx="1" ${tipA(it.tip)} ${it.f ? `data-f="${it.f}"` : ''}/>`;
    s += `<text x="${x + bwid / 2}" y="${h - 8}" text-anchor="middle" ${it.dim ? '' : 'class="t2"'}>${esc(it.label)}</text>`;
    if (o.valLabels) s += `<text x="${x + bwid / 2}" y="${y - 5}" text-anchor="middle" class="t2">${o.valLabels(it)}</text>`;
  });
  if (o.line) {
    const pts = o.line.map((l, i) => { const x = ml + bw * i + bw / 2, y = o.pctLine ? mt + ih - ih * Math.min(1, l.v) : mt + ih - ih * l.v / max; return [x, y, l]; }).filter(p => p[2].v != null && !isNaN(p[2].v));
    if (pts.length > 1) s += `<polyline fill="none" stroke="#ffffff" stroke-width="1.6" stroke-dasharray="${o.pctLine ? '0' : '5 3'}" points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`;
    pts.forEach(p => s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#0a0a0b" stroke="#fff" stroke-width="1.5" ${tipA(p[2].tip || '')}/>`);
  }
  return s + '</svg>';
}
function barH(w, items, o = {}) {
  const rowH = o.rowH || 26, lw = o.lw || Math.min(160, Math.round(w * 0.38)), vw = o.vw || 84, iw = Math.max(20, w - lw - vw), h = items.length * rowH + 4;
  const max = Math.max(1, ...items.map(i => i.v));
  let s = `<svg width="${w}" height="${h}" role="img">`;
  items.forEach((it, i) => {
    const y = i * rowH + 2, bw = iw * it.v / max;
    s += `<g ${it.f ? `data-f="${it.f}"` : ''} ${tipA(it.tip || '')}><rect x="0" y="${y}" width="${w}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="0" y="${y + rowH / 2 + 4}" class="${it.dim ? '' : 't2'}">${esc(trunc(it.label, Math.floor(lw / 6.4)))}</text>`;
    s += `<rect x="${lw}" y="${y + 6}" width="${Math.max(1, bw).toFixed(1)}" height="${rowH - 12}" fill="${it.dim ? '#3a3a40' : (it.fill || '#cfcfd4')}" rx="1"/>`;
    s += `<text x="${lw + bw + 8}" y="${y + rowH / 2 + 4}" class="${it.dim ? '' : 't1'}">${esc(it.text != null ? it.text : (o.fmt || inr)(it.v))}</text></g>`;
  });
  return s + '</svg>';
}
function bullet(w, h, items) {             // outline = budget, fill = actual
  const ml = 46, mr = 10, mt = 12, mb = 24, iw = w - ml - mr, ih = h - mt - mb;
  const max = niceMax(Math.max(1, ...items.map(i => Math.max(i.budget, i.actual))));
  const bw = iw / items.length, bwid = Math.min(60, bw * 0.7);
  let s = `<svg width="${w}" height="${h}">`;
  for (let i = 0; i <= 4; i++) { const y = mt + ih - ih * i / 4; s += `<line class="grid" x1="${ml}" x2="${w - mr}" y1="${y}" y2="${y}"/><text x="${ml - 8}" y="${y + 4}" text-anchor="end">${short(max * i / 4)}</text>`; }
  items.forEach((it, i) => {
    const x = ml + bw * i + (bw - bwid) / 2, bh = ih * it.budget / max, ah = ih * it.actual / max;
    s += `<rect x="${x}" y="${mt + ih - bh}" width="${bwid}" height="${bh}" fill="none" stroke="#6f6f76" stroke-width="1" ${tipA(it.tip)} ${it.f ? `data-f="${it.f}"` : ''}/>`;
    s += `<rect x="${x + bwid * 0.22}" y="${mt + ih - ah}" width="${bwid * 0.56}" height="${ah}" fill="${it.dim ? '#3a3a40' : '#f1f1f2'}" ${tipA(it.tip)} ${it.f ? `data-f="${it.f}"` : ''}/>`;
    s += `<text x="${x + bwid / 2}" y="${h - 8}" text-anchor="middle" class="t2">${esc(it.label)}</text>`;
  });
  return s + '</svg>';
}
function stackV(w, h, items, names) {      // items [{label, parts[], tip[]}]
  const ml = 46, mr = 10, mt = 12, mb = 24, iw = w - ml - mr, ih = h - mt - mb;
  const max = niceMax(Math.max(1, ...items.map(i => i.parts.reduce((a, b) => a + b, 0))));
  const bw = iw / items.length, bwid = Math.min(54, bw * 0.62);
  let s = `<svg width="${w}" height="${h}">`;
  for (let i = 0; i <= 4; i++) { const y = mt + ih - ih * i / 4; s += `<line class="grid" x1="${ml}" x2="${w - mr}" y1="${y}" y2="${y}"/><text x="${ml - 8}" y="${y + 4}" text-anchor="end">${short(max * i / 4)}</text>`; }
  items.forEach((it, i) => {
    let acc = 0; const x = ml + bw * i + (bw - bwid) / 2;
    it.parts.forEach((p, j) => { const ph = ih * p / max; s += `<rect x="${x}" y="${mt + ih - ih * acc / max - ph}" width="${bwid}" height="${ph}" fill="${GREY[j]}" stroke="#0a0a0b" stroke-width="1" ${tipA(it.label + ' | ' + names[j] + ': ' + inr(p))}/>`; acc += p; });
    s += `<text x="${x + bwid / 2}" y="${h - 8}" text-anchor="middle" class="t2">${esc(it.label)}</text>`;
  });
  return s + '</svg>';
}
const legend = names => `<div class="legend">${names.map((n, i) => `<span><i style="background:${GREY[i]}"></i>${esc(n)}</span>`).join('')}</div>`;
function strip(parts, names) {              // parts: numbers
  const tot = parts.reduce((a, b) => a + b, 0) || 1;
  return `<div class="strip">${parts.map((p, i) => p > 0 ? `<div style="width:${p / tot * 100}%;background:${GREY[i]}" ${tipA(names[i] + ': ' + p.toLocaleString('en-IN') + ' (' + pct(p / tot) + ')')}></div>` : '').join('')}</div>`;
}
function heat(rows, cols, val, cell, maxv, o = {}) {
  let h = `<table class="heat"><thead><tr><th class="rl"></th>${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}${o.total ? '<th>Total</th>' : ''}</tr></thead><tbody>`;
  rows.forEach(r => {
    h += `<tr><td class="rl">${esc(r.label)}</td>`;
    let tot = 0;
    cols.forEach(c => {
      const v = val(r, c); tot += v || 0;
      if (v == null) { h += '<td style="color:#4d4d54">-</td>'; return; }
      const a = Math.min(1, v / maxv) * 0.62;
      const over = o.over && o.over(r, c, v);
      h += `<td class="${over ? 'over' : ''}" style="background:rgba(255,255,255,${a.toFixed(3)});color:${a > 0.34 ? '#0a0a0b' : '#b4b4ba'}" ${tipA(o.tip ? o.tip(r, c, v) : '')}>${cell(v)}</td>`;
    });
    if (o.total) h += `<td style="color:#f1f1f2">${o.total(tot)}</td>`;
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

/* ---------- table ---------- */
function table(id, cols, rows, o = {}) {
  const st = TS[id] || (TS[id] = { k: o.sort || cols[0].k, d: o.dir || -1 });
  const col = cols.find(c => c.k === st.k) || cols[0];
  const sorted = rows.slice().sort((a, b) => { const x = col.v(a), y = col.v(b); return (typeof x === 'string' ? x.localeCompare(y) : (x - y)) * st.d; });
  const view = o.limit ? sorted.slice(o.offset || 0, (o.offset || 0) + o.limit) : sorted;
  let h = `<div class="tw" style="${o.maxH ? 'max-height:' + o.maxH : ''}"><table><thead><tr>`;
  cols.forEach(c => h += `<th class="${c.a === 'r' ? 'r' : ''} ${c.k === st.k ? 'sorted' : ''}" data-sort="${id}|${c.k}">${esc(c.t)}${c.k === st.k ? `<span class="ar">${st.d > 0 ? 'ASC' : 'DESC'}</span>` : ''}</th>`);
  h += '</tr></thead><tbody>';
  view.forEach(r => {
    const attr = o.rowAttr ? o.rowAttr(r) : '';
    h += `<tr class="${attr ? 'click' : ''}" ${attr}>` + cols.map(c => `<td class="${c.a === 'r' ? 'r num' : ''} ${c.s ? 'strong' : ''}">${c.f ? c.f(r) : esc(c.v(r))}</td>`).join('') + '</tr>';
  });
  if (!view.length) h += `<tr><td colspan="${cols.length}" class="empty">No records for the current filters</td></tr>`;
  return h + '</tbody></table></div>';
}
const miniBar = (v, max) => `<span class="bartrack"><span class="bar" style="width:${Math.min(100, max ? v / max * 100 : 0)}%"></span></span>`;
const panel = (title, body, o = {}) => `<section class="panel ${o.cls || ''}"><div class="ph"><h3>${title}</h3>${o.sub ? `<div class="sub">${o.sub}</div>` : ''}</div>${body}</section>`;
const kpi = (k, v, s, go) => go ? `<button class="kpi" data-go="${go}"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s || ''}</div></button>` : `<div class="kpi"><div class="k">${k}</div><div class="v num">${v}</div><div class="s">${s || ''}</div></div>`;
const tag = (t, hi) => `<span class="tag ${hi ? 'hi' : ''}">${esc(t)}</span>`;
const fdim = (k, v) => `${k}|${esc(v)}`;

/* ---------- derived helpers ---------- */
function monthSeries(L) {
  const m = {}; MONTHS.forEach(x => m[x] = { v: 0, n: 0 });
  L.forEach(t => { m[t.m].v += t.amt; m[t.m].n++; });
  return MONTHS.map(x => ({ m: x, v: m[x].v, n: m[x].n }));
}
function budCalc() {
  const A = sel(['m', 'dept', 'site']);
  const am = new Map(); A.forEach(t => { const k = t.m + '|' + t.dept + '|' + t.site; am.set(k, (am.get(k) || 0) + t.amt); });
  const cells = BUD.filter(b => inSet('m', b.m) && inSet('dept', b.dept) && inSet('site', b.site)).map(b => ({ ...b, a: am.get(b.m + '|' + b.dept + '|' + b.site) || 0 }));
  const other = DIMS.some(d => !['m', 'dept', 'site'].includes(d.k) && S.f[d.k].size);
  return { cells, tb: sum(cells, c => c.b), ta: sum(cells, c => c.a), other };
}
function splitClusters(L) {
  const g = groupBy(L.filter(t => t.vid && !t.dupcopy), t => t.eid + '|' + t.vid + '|' + t.date);
  return g.filter(x => x.n > 1 && x.v >= 50000).map(x => ({ emp: x.rows[0].emp, eid: x.rows[0].eid, vendor: x.rows[0].vendor, date: x.rows[0].date, n: x.n, v: x.v, rows: x.rows, near: x.rows.every(r => r.amt >= 49000 && r.amt < 50000) })).sort(desc);
}
const isPaidNoAppr = t => t.st === 'Completed' && (t.appr === 'Pending' || t.appr === 'Rejected');
const median = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const bucketTat = L => { const b = [[0, 4, '0-4h'], [4, 8, '4-8h'], [8, 12, '8-12h'], [12, 24, '12-24h'], [24, 48, '24-48h'], [48, 72, '48-72h'], [72, 1e9, '72h+']]; return b.map(x => ({ label: x[2], v: L.filter(t => t.tat != null && t.tat >= x[0] && t.tat < x[1]).length })); };

/* ---------- VIEW: overview ---------- */
function vOverview() {
  const T = sel(), tot = sum(T), Tm = sel(except('m'));
  const ser = monthSeries(Tm);
  const mset = S.f.m;
  const tmonths = [...new Set(T.map(t => t.m))].sort();
  const last = tmonths[tmonths.length - 1], li = MONTHS.indexOf(last);
  const cur = last ? sum(T.filter(t => t.m === last)) : 0;
  const prev = li > 0 ? ser[li - 1].v : 0;
  const mom = prev ? cur / prev - 1 : null;
  const bc = budCalc();
  const pend = T.filter(t => t.appr === 'Pending'), aged = T.filter(t => t.fl.includes('AGE'));
  const nap = T.filter(isPaidNoAppr), pol = T.filter(t => !t.pol), nrc = T.filter(t => !t.rc);
  const tats = T.filter(t => t.tat != null).map(t => t.tat);
  const kp = [
    kpi(S.basis === 'all' ? 'Total spend (all records)' : 'Net spend', inr(tot), `<b>${full(T.length)}</b> transactions, average ${inr(T.length ? tot / T.length : 0)}`),
    kpi(last ? mlabel(last) + ' spend' : 'Latest month', inr(cur), mom == null ? 'No prior month' : `<b>${sgn(mom)}</b> versus ${mlabel(MONTHS[li - 1])}`),
    kpi('Budget utilisation', bc.tb ? pct(bc.ta / bc.tb, 1) : 'n/a', `${inr(bc.ta)} of ${inr(bc.tb)} budgeted`, 'budget'),
    kpi('Awaiting approval', full(pend.length), `<b>${inr(sum(pend))}</b> value, ${aged.length} older than 30 days`, 'exceptions'),
    kpi('Completed without approval', full(nap.length), `<b>${inr(sum(nap))}</b> paid while pending or rejected`, 'exceptions'),
    kpi('Policy non-compliant', inr(sum(pol)), `<b>${full(pol.length)}</b> transactions, ${pct(tot ? sum(pol) / tot : 0)} of spend`, 'controls'),
    kpi('Missing receipts', full(nrc.length), `<b>${inr(sum(nrc))}</b> without supporting document`, 'controls'),
    kpi('Median approval time', tats.length ? median(tats).toFixed(1) + ' h' : 'n/a', tats.length ? `<b>${pct(tats.filter(x => x > 24).length / tats.length, 0)}</b> took over 24 hours` : '', 'controls')
  ];
  // alerts
  const A = [];
  const nrej = nap.filter(t => t.appr === 'Rejected');
  if (nap.length) A.push({ s: 'h', t: `${nap.length} transactions completed without valid approval`, d: `${inr(sum(nap))} in total. ${nap.length - nrej.length} were still pending approval and ${nrej.length} had been rejected.`, go: 'exceptions', ex: 'NAP,REJ' });
  const dcp = sel().filter(t => t.dupcopy).concat(S.basis === 'all' ? [] : TX.filter(t => t.dupcopy && DIMS.every(d => !S.f[d.k].size || S.f[d.k].has(d.get(t)))).filter(t => !sel().includes(t)));
  if (dcp.length) A.push({ s: 'h', t: `${dcp.length} duplicate records share an invoice ID with an earlier record`, d: `${inr(sum(dcp))} of potential double payment. Duplicates are excluded from net spend.`, go: 'exceptions', ex: 'DUP' });
  const spl = splitClusters(T);
  if (spl.length) A.push({ s: 'h', t: `${spl.length} same-day split payment clusters to one vendor`, d: `${spl.filter(c => c.near).length} clusters are made of payments just under 50,000 each. Combined value ${inr(sum(spl, c => c.v))}.`, go: 'exceptions', ex: 'SPL,NLM' });
  const vg = groupBy(T.filter(t => t.vid), t => t.vendor).sort(desc);
  if (vg.length && tot) { const sh = vg[0].v / tot; if (sh > 0.15) A.push({ s: sh > 0.22 ? 'h' : 'm', t: `${vg[0].k} accounts for ${pct(sh)} of spend`, d: `Top three vendors hold ${pct(vg.slice(0, 3).reduce((a, b) => a + b.v, 0) / tot)}. Check contract coverage and rate benchmarks.`, go: 'vendors' }); }
  if (!mset.size || mset.size > 1) { const idx = MONTHS.indexOf(last); if (idx >= 3) { const base = (ser[idx - 1].v + ser[idx - 2].v + ser[idx - 3].v) / 3; const c2 = ser[idx].v; if (base && c2 / base > 1.3) A.push({ s: c2 / base > 1.5 ? 'h' : 'm', t: `${mlabel(last)} spend is ${sgn(c2 / base - 1)} above the prior three-month average`, d: `${inr(c2)} against a ${inr(base)} average. See the category and vendor split for the driver.`, go: 'spend' }); } }
  const ovr = bc.cells.reduce((m, c) => { const k = c.dept; m[k] = m[k] || { b: 0, a: 0 }; m[k].b += c.b; m[k].a += c.a; return m; }, {});
  const ovd = Object.entries(ovr).filter(([, x]) => x.a > x.b);
  if (ovd.length) A.push({ s: 'm', t: `${ovd.length} department${ovd.length > 1 ? 's' : ''} above budget in the selected period`, d: ovd.map(([k, x]) => `${k} ${pct(x.a / x.b, 0)}`).join(', ') + '.', go: 'budget' });
  const rmb = T.filter(t => t.fl.includes('RMB'));
  if (rmb.length) A.push({ s: 'm', t: `${rmb.length} large vendor payments routed through reimbursement`, d: `${inr(sum(rmb))} paid to registered vendors as employee claims, bypassing the AP route.`, go: 'exceptions', ex: 'RMB' });
  if (nrc.length / (T.length || 1) > 0.1) A.push({ s: 'm', t: `${pct(nrc.length / T.length)} of transactions have no receipt`, d: `${inr(sum(nrc))} unsupported. ${nrc.filter(t => t.pol).length} of them were not flagged by the policy check.`, go: 'controls' });
  if (aged.length) A.push({ s: 'm', t: `${aged.length} approvals have been pending for over 30 days`, d: `${inr(sum(aged))} in the queue as of ${D.asof}.`, go: 'exceptions', ex: 'AGE' });
  A.sort((a, b) => 'hml'.indexOf(a.s) - 'hml'.indexOf(b.s));
  const alerts = A.length ? A.slice(0, 7).map(a => `<div class="alert"><span class="sev ${a.s}">${SEVN[a.s]}</span><div><div class="t">${esc(a.t)}</div><div class="d">${esc(a.d)}</div></div><button class="btn" data-go="${a.go}" ${a.ex ? `data-ex="${a.ex}"` : ''}>Review</button></div>`).join('') : '<div class="empty">No alerts for the current selection</div>';
  // charts
  const ma = ser.map((x, i) => ({ v: i >= 2 ? (ser[i].v + ser[i - 1].v + ser[i - 2].v) / 3 : null, tip: i >= 2 ? '3-month average ' + mlabel(x.m) + ': ' + inr((ser[i].v + ser[i - 1].v + ser[i - 2].v) / 3) : '' }));
  const items = ser.map((x, i) => ({ label: mlabel(x.m).slice(0, 3), v: x.v, f: fdim('m', x.m), dim: mset.size && !mset.has(x.m), tip: `${mlabel(x.m)}: ${inr(x.v)} | ${x.n} transactions${i ? ' | ' + (ser[i - 1].v ? sgn(x.v / ser[i - 1].v - 1) + ' vs prior month' : '') : ''}` }));
  CH.trend = w => barV(w, 270, items, { line: ma });
  const mrow = `<div style="display:grid;grid-template-columns:46px repeat(${ser.length},1fr);margin-right:10px;font-size:11px;color:#7d7d85;margin-top:2px"><span></span>${ser.map((x, i) => `<span style="text-align:center">${i && ser[i - 1].v ? sgn(x.v / ser[i - 1].v - 1) : '-'}</span>`).join('')}</div>`;
  const dbar = (k, lim) => groupBy(T, t => t[k]).sort(desc).slice(0, lim || 20).map(x => ({ label: x.k, v: x.v, f: fdim(k, x.k), dim: S.f[k].size && !S.f[k].has(x.k), tip: `${x.k}: ${inr(x.v)} | ${x.n} transactions | ${pct(x.v / tot)} of spend`, text: inr(x.v) }));
  const d1 = dbar('dept'), d2 = dbar('site'), d3 = dbar('pay');
  CH.odept = w => barH(w, d1); CH.osite = w => barH(w, d2); CH.opay = w => barH(w, d3);
  const stat = ['Approved', 'Auto-approved', 'Pending', 'Rejected'].map(k => T.filter(t => t.appr === k).length);
  const st2 = ['Completed', 'Pending', 'Declined', 'Reversed'].map(k => T.filter(t => t.st === k).length);
  const big = T.slice().sort((a, b) => b.amt - a.amt).slice(0, 6);
  const topTx = `<div class="lbl" style="margin:20px 0 6px">Largest transactions in selection</div>` + table('bigtx', [
    { k: 'id', t: 'ID', v: r => r.id, f: r => `<span class="mono">${r.id}</span>` }, { k: 'date', t: 'Date', v: r => r.date }, { k: 'emp', t: 'Employee', v: r => r.emp, s: 1 },
    { k: 'vendor', t: 'Vendor', v: r => r.vendor }, { k: 'pay', t: 'Method', v: r => r.pay }, { k: 'appr', t: 'Approval', v: r => r.appr }, { k: 'amt', t: 'Amount', v: r => r.amt, a: 'r', f: r => inr(r.amt) }
  ], big, { sort: 'amt', rowAttr: r => `data-tx="${r.id}"` });
  return `<div class="grid g4 mb">${kp.slice(0, 4).join('')}</div><div class="grid g4 mb">${kp.slice(4).join('')}</div>
  <div class="grid g21 mb">${panel('Monthly spend', chart('trend') + mrow + `<div class="legend"><span><i style="background:#cfcfd4"></i>Spend</span><span><i style="background:#fff;height:2px;vertical-align:3px"></i>3-month average</span><span>Percentages show month-on-month change. Click a bar to filter by month.</span></div>` + topTx, { sub: 'Responds to every filter except month, so the trend stays visible' })}
  ${panel('Needs attention', alerts, { sub: 'Generated from the current selection' })}</div>
  <div class="grid g3 mb">${panel('By department', chart('odept'), { sub: 'Click a bar to filter' })}${panel('By site', chart('osite'), { sub: 'Click a bar to filter' })}${panel('By payment method', chart('opay') + `<div style="margin-top:18px"><div class="lbl" style="margin-bottom:6px">Approval status</div>${strip(stat, ['Approved', 'Auto-approved', 'Pending', 'Rejected'])}${legend(['Approved', 'Auto-approved', 'Pending', 'Rejected'])}</div><div style="margin-top:14px"><div class="lbl" style="margin-bottom:6px">Transaction status</div>${strip(st2, ['Completed', 'Pending', 'Declined', 'Reversed'])}${legend(['Completed', 'Pending', 'Declined', 'Reversed'])}</div>`, { sub: 'Click a bar to filter' })}</div>`;
}

/* ---------- VIEW: budget ---------- */
function vBudget() {
  const bc = budCalc(), { cells } = bc;
  const util = bc.tb ? bc.ta / bc.tb : 0;
  const over = cells.filter(c => c.a > c.b);
  const note = `<div class="note">Budgets are defined per department, site and month, so this view responds to the month, department and site filters only${bc.other ? '. Other active filters are ignored here' : ''}. Actuals follow the selected basis. Operations, Procurement and Projects carry budgets at all eight locations; the other five departments are budgeted at HQ only.</div>`;
  const kp = `<div class="grid g5 mb">${kpi('Budget', inr(bc.tb), 'Selected months, departments and sites')}${kpi('Actual', inr(bc.ta), S.basis === 'all' ? 'All records' : 'Net spend')}${kpi('Variance', inr(bc.tb - bc.ta), (bc.tb - bc.ta >= 0 ? 'Under' : 'Over') + ' budget')}${kpi('Utilisation', pct(util), 'Actual divided by budget')}${kpi('Budget lines over 100%', full(over.length), `of ${full(cells.length)} department-site-month lines`)}</div>`;
  const ms = MONTHS.map(m => { const c = cells.filter(x => x.m === m); const b = sum(c, x => x.b), a = sum(c, x => x.a); return { label: mlabel(m).slice(0, 3), budget: b, actual: a, dim: false, f: fdim('m', m), tip: `${mlabel(m)} | Budget ${inr(b)} | Actual ${inr(a)} | Utilisation ${b ? pct(a / b) : 'n/a'}` }; });
  CH.bm = w => bullet(w, 260, ms);
  const depts = [...new Set(BUD.map(b => b.dept))].sort();
  const sites = [...new Set(BUD.map(b => b.site))].sort();
  const rowsOf = (key, list) => list.map(k => { const c = cells.filter(x => x[key] === k); return { k, b: sum(c, x => x.b), a: sum(c, x => x.a), over: c.filter(x => x.a > x.b).length, n: c.length }; }).filter(r => r.b > 0);
  const st = r => r.a > r.b ? 'Over budget' : r.a / r.b < 0.25 ? 'Under-utilised' : 'Within budget';
  const cols = key => [
    { k: 'k', t: key === 'dept' ? 'Department' : 'Site', v: r => r.k, s: 1 },
    { k: 'b', t: 'Budget', v: r => r.b, f: r => inr(r.b), a: 'r' },
    { k: 'a', t: 'Actual', v: r => r.a, f: r => inr(r.a), a: 'r' },
    { k: 'var', t: 'Variance', v: r => r.b - r.a, f: r => inr(r.b - r.a), a: 'r' },
    { k: 'u', t: 'Utilisation', v: r => r.a / r.b, f: r => miniBar(r.a / r.b, 1.2) + pct(r.a / r.b), a: 'r' },
    { k: 'o', t: 'Lines over', v: r => r.over, f: r => `${r.over} of ${r.n}`, a: 'r' },
    { k: 's', t: 'Status', v: r => st(r), f: r => tag(st(r), st(r) === 'Over budget') }
  ];
  const hm = depts.map(d => ({ label: d, d }));
  const hv = (r, c) => { const x = cells.filter(z => z.dept === r.d && z.m === c.m); const b = sum(x, z => z.b); return b ? sum(x, z => z.a) / b : null; };
  const heatHtml = heat(hm, MONTHS.map(m => ({ label: mlabel(m).slice(0, 3), m })), hv, v => Math.round(v * 100) + '%', 1.0, { over: (r, c, v) => v > 1, tip: (r, c, v) => `${r.d} ${mlabel(c.m)}: ${pct(v)} of budget` });
  const top = cells.filter(c => c.a > c.b).map(c => ({ ...c, ex: c.a - c.b })).sort((a, b) => b.ex - a.ex);
  const topTbl = table('bover', [
    { k: 'm', t: 'Month', v: r => r.m, f: r => mlabel(r.m) }, { k: 'dept', t: 'Department', v: r => r.dept, s: 1 }, { k: 'site', t: 'Site', v: r => r.site },
    { k: 'b', t: 'Budget', v: r => r.b, f: r => inr(r.b), a: 'r' }, { k: 'a', t: 'Actual', v: r => r.a, f: r => inr(r.a), a: 'r' },
    { k: 'ex', t: 'Overspend', v: r => r.ex, f: r => inr(r.ex), a: 'r' }, { k: 'u', t: 'Utilisation', v: r => r.a / r.b, f: r => pct(r.a / r.b, 0), a: 'r' }
  ], top, { sort: 'ex', maxH: '340px', rowAttr: r => `data-f="dept|${esc(r.dept)}"` });
  return note + kp + `<div class="grid g21 mb">${panel('Budget against actual by month', chart('bm') + `<div class="legend"><span><i style="border:1px solid #6f6f76;background:none"></i>Budget</span><span><i style="background:#f1f1f2"></i>Actual</span></div>`, { sub: 'Outline is budget, solid bar is actual spend' })}
  ${panel('Utilisation heatmap', heatHtml, { sub: 'Solid white cells are over 100% of budget' })}</div>
  <div class="grid g2 mb">${panel('By department', table('bdept', cols('dept'), rowsOf('dept', depts), { sort: 'u', rowAttr: r => `data-f="dept|${esc(r.k)}"` }), { sub: 'Click a row to filter' })}
  ${panel('By site', table('bsite', cols('site'), rowsOf('site', sites), { sort: 'u', rowAttr: r => `data-f="site|${esc(r.k)}"` }), { sub: 'Click a row to filter' })}</div>
  ${panel('Budget lines over 100%', top.length ? topTbl : '<div class="empty">No budget line exceeds its budget in this selection</div>', { sub: 'Department, site and month combinations where actual spend exceeded budget' })}`;
}

/* ---------- VIEW: spend breakdown ---------- */
function vSpend() {
  const T = sel(), tot = sum(T) || 1, Tm = sel(except('m'));
  const rec = T.filter(t => t.rec === 'Recurring'), fx = T.filter(t => t.cur !== 'INR'), wk = T.filter(t => t.wk);
  const cg = groupBy(T, t => t.cat).sort(desc);
  const kp = `<div class="grid g4 mb">${kpi('Largest category', cg[0] ? esc(cg[0].k) : 'n/a', cg[0] ? `<b>${inr(cg[0].v)}</b>, ${pct(cg[0].v / tot)} of spend` : '')}${kpi('Recurring spend', inr(sum(rec)), `<b>${pct(sum(rec) / tot)}</b> of spend across ${rec.length} subscription payments`)}${kpi('Foreign currency spend', inr(sum(fx)), `<b>${pct(sum(fx) / tot)}</b> of spend, ${fx.length} USD and SGD transactions`)}${kpi('Weekend spend', inr(sum(wk)), `<b>${pct(sum(wk) / tot)}</b> of spend, ${wk.length} transactions`)}</div>`;
  const mk = (k, rows) => rows.map(x => ({ label: x.k, v: x.v, f: fdim(k, x.k), dim: S.f[k].size && !S.f[k].has(x.k), tip: `${x.k}: ${inr(x.v)} | ${x.n} transactions | ${pct(x.v / tot)}`, text: inr(x.v) }));
  const catI = mk('cat', cg), projI = mk('proj', groupBy(T, t => t.proj).sort(desc));
  CH.scat = w => barH(w, catI, { rowH: 25 }); CH.sproj = w => barH(w, projI);
  const tg = groupBy(T, t => t.type).sort(desc).map(x => ({ label: x.k, v: x.v, tip: `${x.k}: ${inr(x.v)} | ${x.n} transactions`, text: inr(x.v) }));
  CH.stype = w => barH(w, tg);
  const PM = ['UPI', 'Reimbursement', 'Card', 'Vendor Payment'];
  const stk = MONTHS.map(m => ({ label: mlabel(m).slice(0, 3), parts: PM.map(p => sum(Tm.filter(t => t.m === m && t.pay === p))) }));
  CH.sstack = w => stackV(w, 260, stk, PM);
  // heatmap site x month
  const sites = [...new Set(TX.map(t => t.site))].sort(); const mx = {};
  Tm.forEach(t => { mx[t.site + '|' + t.m] = (mx[t.site + '|' + t.m] || 0) + t.amt; });
  const mxv = Math.max(1, ...Object.values(mx));
  const hm = heat(sites.map(s => ({ label: s })), MONTHS.map(m => ({ label: mlabel(m).slice(0, 3), m })), (r, c) => mx[r.label + '|' + c.m] || 0, v => v ? short(v) : '-', mxv, { total: v => short(v), tip: (r, c, v) => `${r.label} ${mlabel(c.m)}: ${inr(v)}` });
  // movers
  const tm = [...new Set(T.map(t => t.m))].sort(), lm = tm[tm.length - 1], pi = MONTHS.indexOf(lm) - 1, pm = pi >= 0 ? MONTHS[pi] : null;
  const cats = [...new Set(TX.map(t => t.cat))];
  const mv = lm && pm ? cats.map(c => { const a = sum(T.filter(t => t.m === lm && t.cat === c)), b = sum(Tm.filter(t => t.m === pm && t.cat === c)); return { k: c, a, b, d: a - b }; }).filter(r => r.a || r.b) : [];
  const mvTbl = mv.length ? table('movers', [
    { k: 'k', t: 'Category', v: r => r.k, s: 1 }, { k: 'b', t: pm ? mlabel(pm) : '', v: r => r.b, f: r => inr(r.b), a: 'r' }, { k: 'a', t: mlabel(lm), v: r => r.a, f: r => inr(r.a), a: 'r' },
    { k: 'd', t: 'Change', v: r => r.d, f: r => (r.d >= 0 ? '+' : '') + inr(r.d), a: 'r' }, { k: 'p', t: 'Change %', v: r => r.b ? r.a / r.b - 1 : (r.a ? 9 : 0), f: r => r.b ? sgn(r.a / r.b - 1) : 'new', a: 'r' }
  ], mv, { sort: 'd', maxH: '420px', rowAttr: r => `data-f="cat|${esc(r.k)}"` }) : '<div class="empty">Month-on-month comparison needs at least two months</div>';
  // recurring
  const rg = groupBy(rec, t => t.vendor).sort(desc);
  const rtbl = rg.length ? table('recur', [
    { k: 'k', t: 'Vendor', v: r => r.k, s: 1 }, { k: 'n', t: 'Payments', v: r => r.n, a: 'r', f: r => r.n }, { k: 'v', t: 'Total', v: r => r.v, f: r => inr(r.v), a: 'r' },
    { k: 'avg', t: 'Average', v: r => r.v / r.n, f: r => inr(r.v / r.n), a: 'r' },
    { k: 'sd', t: 'Spread', v: r => Math.max(...r.rows.map(x => x.amt)) - Math.min(...r.rows.map(x => x.amt)), f: r => inr(Math.max(...r.rows.map(x => x.amt)) - Math.min(...r.rows.map(x => x.amt))), a: 'r' }
  ], rg, { rowAttr: r => `data-f="vendor|${esc(r.k)}"` }) : '<div class="empty">No recurring spend in this selection</div>';
  const cg2 = groupBy(T, t => t.cur).sort(desc);
  const ctbl = table('cur', [
    { k: 'k', t: 'Currency', v: r => r.k, s: 1 }, { k: 'n', t: 'Transactions', v: r => r.n, a: 'r', f: r => r.n }, { k: 'o', t: 'Original amount', v: r => sum(r.rows, x => x.orig), a: 'r', f: r => full(sum(r.rows, x => x.orig)) },
    { k: 'fx', t: 'FX rate', v: r => r.rows[0].fx, a: 'r', f: r => r.rows[0].fx }, { k: 'v', t: 'INR value', v: r => r.v, a: 'r', f: r => inr(r.v) }
  ], cg2);
  const dw = [0, 1, 2, 3, 4, 5, 6].map(i => ({ label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], v: sum(T.filter(t => ((new Date(t.date).getUTCDay() + 6) % 7) === i)) }));
  CH.sdow = w => barV(w, 200, dw.map(x => ({ label: x.label, v: x.v, tip: x.label + ': ' + inr(x.v) })));
  return kp + `<div class="grid g2 mb">${panel('By category', chart('scat'), { sub: 'Click a bar to filter' })}<div class="grid" style="gap:14px;align-content:start">${panel('By project or cost centre', chart('sproj'), { sub: 'Corporate is non-project overhead' })}${panel('By transaction type', chart('stype'))}</div></div>
  <div class="grid g2 mb">${panel('Monthly spend by payment method', chart('sstack') + legend(PM), { sub: 'Ignores the month filter' })}${panel('Spend by weekday', chart('sdow'), { sub: 'Based on transaction date' })}</div>
  ${panel('Site by month', hm, { sub: 'Darker cells carry more spend. Ignores the month filter.', cls: 'mb' })}
  <div class="grid g2 mb" style="margin-top:14px">${panel('Category movers', mvTbl, { sub: lm && pm ? `${mlabel(lm)} against ${mlabel(pm)}` : '' })}<div class="grid" style="gap:14px;align-content:start">${panel('Recurring spend', rtbl, { sub: 'Subscriptions and repeating payments' })}${panel('Currency exposure', ctbl, { sub: 'A single fixed rate is used for each currency across all months' })}</div></div>`;
}

/* ---------- VIEW: vendors ---------- */
function vendorRows(T) {
  return groupBy(T, t => t.vendor).map(x => { const m = vendMaster[x.k] || {}; const n = x.n;
    return { ...x, cat: m.cat || 'No vendor ID', crit: m.crit || 'Unregistered', terms: m.terms || '-', reg: !!m.cat,
      vp: x.rows.filter(t => t.pay === 'Vendor Payment').length / n, nc: x.rows.filter(t => !t.pol).length / n, nr: x.rows.filter(t => !t.rc).length / n, avg: x.v / n,
      nonap: sum(x.rows.filter(t => t.pay !== 'Vendor Payment')) / (x.v || 1) }; }).sort(desc);
}
function vVendors() {
  const T = sel(), tot = sum(T) || 1, vr = vendorRows(T), named = vr.filter(v => v.reg), unreg = vr.filter(v => !v.reg);
  const top = n => named.slice(0, n).reduce((a, b) => a + b.v, 0) / tot;
  const nt = sum(named, x => x.v) || 1; const hhi = named.reduce((a, b) => a + Math.pow(b.v / nt, 2), 0) * 10000;
  const kp = `<div class="grid g5 mb">${kpi('Active vendors', named.length, `${unreg.length} unregistered payee groups`)}${kpi('Top vendor share', pct(top(1)), named[0] ? esc(named[0].k) : '')}${kpi('Top 3 share', pct(top(3)), 'Share of total spend')}${kpi('Top 5 share', pct(top(5)), 'Share of total spend')}${kpi('Spend with no vendor ID', inr(sum(unreg, x => x.v)), `<b>${pct(sum(unreg, x => x.v) / tot)}</b> of spend, ${unreg.reduce((a, b) => a + b.n, 0)} transactions`)}</div>`;
  const p = named.slice(0, 12); let cum = 0;
  const items = p.map(x => ({ label: trunc(x.k.split(' ')[0], 9), v: x.v, f: fdim('vendor', x.k), dim: S.f.vendor.size && !S.f.vendor.has(x.k), tip: `${x.k}: ${inr(x.v)} | ${pct(x.v / tot)} of spend | ${x.n} transactions` }));
  const line = p.map(x => { cum += x.v; return { v: cum / nt, tip: `Cumulative share of vendor spend: ${pct(cum / nt)}` }; });
  CH.pareto = w => barV(w, 290, items, { line, pctLine: true });
  const mixNames = ['Vendor Payment', 'Card', 'UPI', 'Reimbursement'];
  const mixRows = named.slice(0, 8);
  const mix = mixRows.map(x => `<div style="display:grid;grid-template-columns:150px 1fr 60px;gap:12px;align-items:center;margin:10px 0"><span style="font-size:12px;color:#b4b4ba">${esc(trunc(x.k, 22))}</span>${strip(mixNames.map(n => sum(x.rows.filter(t => t.pay === n))), mixNames)}<span class="num" style="font-size:12px;color:#7d7d85;text-align:right">${pct(1 - x.nonap, 0)} AP</span></div>`).join('');
  const cols = [
    { k: 'k', t: 'Vendor', v: r => r.k, s: 1 }, { k: 'cat', t: 'Category', v: r => r.cat }, { k: 'crit', t: 'Criticality', v: r => r.crit }, { k: 'terms', t: 'Terms', v: r => r.terms },
    { k: 'v', t: 'Spend', v: r => r.v, f: r => inr(r.v), a: 'r' }, { k: 'sh', t: 'Share', v: r => r.v, f: r => miniBar(r.v, vr[0] ? vr[0].v : 1) + pct(r.v / tot), a: 'r' },
    { k: 'n', t: 'Txns', v: r => r.n, a: 'r', f: r => r.n }, { k: 'avg', t: 'Average', v: r => r.avg, f: r => inr(r.avg), a: 'r' },
    { k: 'vp', t: 'Via AP route', v: r => 1 - r.nonap, f: r => pct(1 - r.nonap, 0), a: 'r' }, { k: 'nc', t: 'Non-compliant', v: r => r.nc, f: r => pct(r.nc, 0), a: 'r' }, { k: 'nr', t: 'No receipt', v: r => r.nr, f: r => pct(r.nr, 0), a: 'r' }
  ];
  return kp + `<div class="grid g21 mb">${panel('Vendor concentration', chart('pareto') + `<div class="legend"><span><i style="background:#cfcfd4"></i>Spend</span><span><i style="background:#fff;height:2px;vertical-align:3px"></i>Cumulative share</span><span>Herfindahl index ${Math.round(hhi)} across registered vendors</span></div>`, { sub: 'Top 12 registered vendors. Click a bar to filter.' })}
  ${panel('Payment route by vendor', mix + legend(mixNames), { sub: 'Share of vendor spend paid through each route. AP means the Vendor Payment route.' })}</div>
  ${panel('Vendor register', table('vend', cols, vr, { sort: 'v', maxH: '520px', rowAttr: r => r.reg ? `data-f="vendor|${esc(r.k)}"` : '' }), { sub: 'Click a row to filter. Via AP route is the share of spend paid as Vendor Payment rather than card, UPI or reimbursement.', cls: 'flush' })}`;
}

/* ---------- VIEW: people ---------- */
function peopleRows(T) {
  const em = {}; EMPS.forEach(e => em[e.id] = e);
  return groupBy(T, t => t.eid).map(x => { const e = em[x.k] || {}; const pm = groupBy(x.rows, t => t.pay).sort(desc)[0];
    return { ...x, id: x.k, name: x.rows[0].emp, dept: x.rows[0].dept, site: x.rows[0].site, role: x.rows[0].role, prim: e.method || '-', top: pm ? pm.k : '-', topSh: pm ? pm.v / x.v : 0,
      nr: x.rows.filter(t => !t.rc).length, nc: x.rows.filter(t => !t.pol).length, np: x.rows.filter(isPaidNoAppr).length, risk: sum(x.rows, t => t.sc), avg: x.v / x.n }; }).sort(desc);
}
let PQ = '';
function peopleTable() {
  const T = sel(), pr = peopleRows(T).filter(r => !PQ || (r.name + ' ' + r.id + ' ' + r.dept + ' ' + r.site).toLowerCase().includes(PQ.toLowerCase()));
  return table('people', [
    { k: 'name', t: 'Employee', v: r => r.name, s: 1 }, { k: 'dept', t: 'Department', v: r => r.dept }, { k: 'site', t: 'Site', v: r => r.site }, { k: 'role', t: 'Role', v: r => r.role },
    { k: 'v', t: 'Spend', v: r => r.v, f: r => inr(r.v), a: 'r' }, { k: 'n', t: 'Txns', v: r => r.n, a: 'r', f: r => r.n }, { k: 'avg', t: 'Average', v: r => r.avg, f: r => inr(r.avg), a: 'r' },
    { k: 'top', t: 'Main method', v: r => r.top, f: r => `${esc(r.top)} ${pct(r.topSh, 0)}` }, { k: 'prim', t: 'Declared method', v: r => r.prim },
    { k: 'nr', t: 'No receipt', v: r => r.nr, a: 'r', f: r => r.nr }, { k: 'nc', t: 'Non-compliant', v: r => r.nc, a: 'r', f: r => r.nc }, { k: 'np', t: 'Paid unapproved', v: r => r.np, a: 'r', f: r => r.np },
    { k: 'risk', t: 'Risk points', v: r => r.risk, a: 'r', f: r => `<b style="color:#f1f1f2">${r.risk}</b>` }
  ], pr, { sort: 'v', maxH: '600px', rowAttr: r => `data-f="eid|${esc(r.id)}"` });
}
function vPeople() {
  const T = sel(), tot = sum(T) || 1, pr = peopleRows(T);
  const t10 = pr.slice(0, 10), r10 = pr.slice().sort((a, b) => b.risk - a.risk).slice(0, 10);
  CH.ptop = w => barH(w, t10.map(x => ({ label: x.name, v: x.v, f: fdim('eid', x.id), dim: S.f.eid.size && !S.f.eid.has(x.id), tip: `${x.name} | ${x.dept} | ${x.site}: ${inr(x.v)} | ${x.n} transactions`, text: inr(x.v) })));
  CH.prisk = w => barH(w, r10.map(x => ({ label: x.name, v: x.risk, f: fdim('eid', x.id), tip: `${x.name}: ${x.risk} risk points across ${x.n} transactions`, text: x.risk + ' pts', fill: '#9a9aa1' })), { fmt: v => v });
  const kp = `<div class="grid g4 mb">${kpi('Employees transacting', pr.length, `of ${EMPS.length} on the employee register`)}${kpi('Top 10 share of spend', pct(t10.reduce((a, b) => a + b.v, 0) / tot), 'Ten highest spenders')}${kpi('Average per employee', inr(pr.length ? tot / pr.length : 0), 'Net of selected filters')}${kpi('Employees with exceptions', pr.filter(r => r.risk > 0).length, `${pr.filter(r => r.risk >= 20).length} with 20 or more risk points`)}</div>`;
  return kp + `<div class="grid g2 mb">${panel('Top spenders', chart('ptop'), { sub: 'Click a bar to filter by employee' })}${panel('Highest risk points', chart('prisk'), { sub: 'Sum of exception weights across the employee transactions' })}</div>
  <section class="panel flush"><div class="ph"><h3>Employee register</h3><div class="sub">Main method is the payment route used most often. Declared method comes from the employee master. Click a row to filter.</div></div>
  <div class="toolbar"><input type="text" id="pe-q" placeholder="Search name, ID, department or site" value="${esc(PQ)}"></div><div id="pe-wrap">${peopleTable()}</div></section>`;
}

/* ---------- VIEW: controls ---------- */
function vControls() {
  const T = sel(), tot = sum(T) || 1, n = T.length || 1;
  const ap = ['Approved', 'Auto-approved', 'Pending', 'Rejected'].map(k => ({ k, rows: T.filter(t => t.appr === k) }));
  const tats = T.filter(t => t.tat != null).map(t => t.tat);
  const kp = `<div class="grid g5 mb">${ap.map(a => kpi(a.k, full(a.rows.length), `<b>${inr(sum(a.rows))}</b>, ${pct(a.rows.length / n, 0)} of transactions`)).join('')}${kpi('Approval time', tats.length ? median(tats).toFixed(1) + ' h median' : 'n/a', tats.length ? `<b>${tats.filter(x => x >= 72).length}</b> took 72 hours or more, longest ${Math.max(...tats).toFixed(0)} h` : '')}</div>`;
  const hist = bucketTat(T); CH.tat = w => barV(w, 220, hist.map(x => ({ label: x.label, v: x.v, tip: `${x.label}: ${x.v} approvals` })), { valLabels: i => i.v });
  const ap2 = groupBy(T.filter(t => t.approver && t.tat != null), t => t.approver).map(x => ({ ...x, avg: sum(x.rows, t => t.tat) / x.n, mx: Math.max(...x.rows.map(t => t.tat)), slow: x.rows.filter(t => t.tat > 48).length }));
  const apTbl = table('approvers', [
    { k: 'k', t: 'Approver', v: r => r.k, s: 1 }, { k: 'n', t: 'Decisions', v: r => r.n, a: 'r', f: r => r.n }, { k: 'avg', t: 'Average hours', v: r => r.avg, a: 'r', f: r => r.avg.toFixed(1) },
    { k: 'mx', t: 'Longest hours', v: r => r.mx, a: 'r', f: r => r.mx.toFixed(0) }, { k: 'slow', t: 'Over 48h', v: r => r.slow, a: 'r', f: r => r.slow }, { k: 'v', t: 'Value decided', v: r => r.v, a: 'r', f: r => inr(r.v) }
  ], ap2, { sort: 'avg', maxH: '360px' });
  const rm = groupBy(T, t => t.pay).map(x => ({ label: x.k, v: x.rows.filter(t => !t.rc).length / x.n, n: x.n, miss: x.rows.filter(t => !t.rc).length, f: fdim('pay', x.k) }));
  CH.rcp = w => barH(w, rm.sort((a, b) => b.v - a.v).map(x => ({ label: x.label, v: x.v, f: x.f, tip: `${x.label}: ${x.miss} of ${x.n} transactions without receipt`, text: pct(x.v) })));
  const er = groupBy(T.filter(t => t.exc), t => t.exc).sort(desc);
  CH.exr = w => barH(w, er.map(x => ({ label: x.k, v: x.n, tip: `${x.k}: ${x.n} transactions, ${inr(x.v)}`, text: String(x.n) })), { fmt: v => v, vw: 40, lw: Math.round(w * 0.55) });
  const eb = groupBy(T, t => t.by).map(x => ({ ...x, nc: x.rows.filter(t => !t.pol).length / x.n, nr: x.rows.filter(t => !t.rc).length / x.n, np: x.rows.filter(isPaidNoAppr).length }));
  const ebTbl = table('entry', [
    { k: 'k', t: 'Entered by', v: r => r.k, s: 1 }, { k: 'n', t: 'Records', v: r => r.n, a: 'r', f: r => r.n }, { k: 'v', t: 'Value', v: r => r.v, a: 'r', f: r => inr(r.v) },
    { k: 'nc', t: 'Non-compliant', v: r => r.nc, a: 'r', f: r => pct(r.nc) }, { k: 'nr', t: 'No receipt', v: r => r.nr, a: 'r', f: r => pct(r.nr) }, { k: 'np', t: 'Paid unapproved', v: r => r.np, a: 'r', f: r => r.np }
  ], eb, { sort: 'v' });
  const smBase = TX.filter(t => DIMS.every(d => d.k === 'm' || !S.f[d.k].size || S.f[d.k].has(d.get(t))));
  const sm = MONTHS.map(m => { const L = smBase.filter(t => t.m === m); return { m, c: ['Completed', 'Pending', 'Declined', 'Reversed'].map(s => L.filter(t => t.st === s).length), pa: L.filter(isPaidNoAppr).length }; });
  const smT = heat(sm.map(x => ({ label: mlabel(x.m), x })), ['Completed', 'Pending', 'Declined', 'Reversed', 'Paid unapproved'].map(l => ({ label: l })), (r, c) => c.label === 'Paid unapproved' ? r.x.pa : r.x.c[['Completed', 'Pending', 'Declined', 'Reversed'].indexOf(c.label)], v => v, 120, {});
  const nap = T.filter(isPaidNoAppr).sort((a, b) => b.amt - a.amt).slice(0, 12);
  const napT = nap.length ? table('napl', [
    { k: 'id', t: 'ID', v: r => r.id, f: r => `<span class="mono">${r.id}</span>` }, { k: 'date', t: 'Date', v: r => r.date }, { k: 'emp', t: 'Employee', v: r => r.emp, s: 1 }, { k: 'vendor', t: 'Vendor', v: r => r.vendor },
    { k: 'amt', t: 'Amount', v: r => r.amt, a: 'r', f: r => inr(r.amt) }, { k: 'appr', t: 'Approval', v: r => r.appr }, { k: 'st', t: 'Status', v: r => r.st }
  ], nap, { sort: 'amt', rowAttr: r => `data-tx="${r.id}"` }) : '<div class="empty">No such transactions in this selection</div>';
  return kp + `<div class="grid g3 mb">${panel('Approval turnaround', chart('tat'), { sub: 'Hours from submission to decision. Blank for pending and auto-approved.' })}${panel('Missing receipts by payment method', chart('rcp'), { sub: 'Share of transactions with no receipt' })}${panel('Policy exception reasons', chart('exr'), { sub: 'Count and value of flagged transactions' })}</div>
  <div class="grid g2 mb">${panel('Approver performance', apTbl, { sub: 'Decisions with a recorded turnaround' })}<div class="grid" style="gap:14px;align-content:start">${panel('Entry source quality', ebTbl, { sub: 'How the record entered the system' })}${panel('Status by month', smT, { sub: 'Record counts across all records, including declined and reversed. Ignores the month filter.' })}</div></div>
  ${panel('Largest payments completed without valid approval', napT, { sub: 'Approval status pending or rejected while the transaction shows completed', cls: 'flush' })}`;
}

/* ---------- VIEW: exceptions ---------- */
const FEXP = {
  DUP: 'Another record carries the same invoice or receipt ID. Confirm the payment was made only once.',
  REJ: 'The approval was rejected, yet the payment shows as completed.',
  NAP: 'The payment shows as completed while approval is still pending.',
  SPL: 'The same employee paid the same vendor more than once on one day, totalling 50,000 or more.',
  NLM: 'The amount sits just under 50,000. This is a common approval threshold, which is an assumption to confirm with policy.',
  OUT: 'The amount is far above the typical value for its category.',
  NRC: 'No receipt or supporting document is attached.',
  POL: 'The transaction failed the policy check.',
  RMB: 'A vendor payment of 100,000 or more was claimed through reimbursement instead of the accounts payable route.',
  AGE: 'Approval has been pending for more than 30 days as of 30 Sep 2026.',
  SLW: 'The approval took 72 hours or more.'
};
function exBase() { return sel().filter(t => t.sc > 0); }
function exFiltered() {
  let L = exBase();
  if (EX.flags.size) L = L.filter(t => t.fl.some(f => EX.flags.has(f)));
  if (EX.sev !== 'all') L = L.filter(t => sevOf(t.sc) === EX.sev);
  if (EX.q) { const q = EX.q.toLowerCase(); L = L.filter(t => (t.id + ' ' + t.emp + ' ' + t.vendor + ' ' + t.cat + ' ' + (t.doc || '') + ' ' + t.dept + ' ' + t.site).toLowerCase().includes(q)); }
  return L;
}
const PAGE = 40;
function exTable() {
  const L = exFiltered(), st = TS.ex || (TS.ex = { k: 'sc', d: -1 });
  const pages = Math.max(1, Math.ceil(L.length / PAGE)); if (EX.page >= pages) EX.page = pages - 1;
  const tbl = table('ex', [
    { k: 'id', t: 'ID', v: r => r.id, f: r => `<span class="mono">${r.id}</span>` }, { k: 'date', t: 'Date', v: r => r.date }, { k: 'emp', t: 'Employee', v: r => r.emp, s: 1 },
    { k: 'vendor', t: 'Vendor', v: r => r.vendor }, { k: 'cat', t: 'Category', v: r => r.cat }, { k: 'pay', t: 'Method', v: r => r.pay },
    { k: 'amt', t: 'Amount', v: r => r.amt, a: 'r', f: r => inr(r.amt) }, { k: 'appr', t: 'Approval', v: r => r.appr }, { k: 'st', t: 'Status', v: r => r.st },
    { k: 'fl', t: 'Flags', v: r => r.fl.length, f: r => r.fl.map(f => tag(f, ['DUP', 'REJ', 'SPL'].includes(f))).join('') },
    { k: 'sc', t: 'Score', v: r => r.sc * 1e7 + r.amt / 1e3, a: 'r', f: r => `${r.sc} <span class="sev ${sevOf(r.sc)}" style="margin-left:6px">${SEVN[sevOf(r.sc)]}</span>` }
  ], L, { sort: 'sc', limit: PAGE, offset: EX.page * PAGE, maxH: '640px', rowAttr: r => `data-tx="${r.id}"` });
  return tbl + `<div class="pager"><span>${full(L.length)} records, value ${inr(sum(L))}</span><span style="flex:1"></span><button class="btn" data-pg="-1">Previous</button><span>Page ${EX.page + 1} of ${pages}</span><button class="btn" data-pg="1">Next</button></div>`;
}
function vExceptions() {
  const base = exBase(), cnt = {}; base.forEach(t => t.fl.forEach(f => cnt[f] = (cnt[f] || 0) + 1));
  const sc = { h: 0, m: 0, l: 0 }; base.forEach(t => sc[sevOf(t.sc)]++);
  const chips = Object.keys(FLAGS).filter(f => cnt[f]).map(f => `<button class="fc ${EX.flags.has(f) ? 'on' : ''}" data-exf="${f}" ${tipA(FEXP[f])}>${esc(FLAGS[f].label)}<span>${cnt[f]}</span></button>`).join('');
  const sevs = [['all', 'All severities', base.length], ['h', 'High', sc.h], ['m', 'Medium', sc.m], ['l', 'Low', sc.l]].map(s => `<button class="fc ${EX.sev === s[0] ? 'on' : ''}" data-exs="${s[0]}">${s[1]}<span>${s[2]}</span></button>`).join('');
  const spl = splitClusters(sel());
  const splT = spl.length ? table('spl', [
    { k: 'emp', t: 'Employee', v: r => r.emp, s: 1 }, { k: 'vendor', t: 'Vendor', v: r => r.vendor }, { k: 'date', t: 'Date', v: r => r.date }, { k: 'n', t: 'Payments', v: r => r.n, a: 'r', f: r => r.n },
    { k: 'v', t: 'Combined', v: r => r.v, a: 'r', f: r => inr(r.v) }, { k: 'near', t: 'Each under 50,000', v: r => r.near ? 1 : 0, f: r => r.near ? tag('Yes', true) : tag('No') }
  ], spl, { sort: 'v', maxH: '280px', rowAttr: r => `data-tx="${r.rows[0].id}"` }) : '<div class="empty">No split payment clusters in this selection</div>';
  return `<div class="note">Every transaction is scored from rule-based flags. Weights: duplicate invoice 5, rejected yet paid 5, same-day split 5, completed without approval 3, outlier 3, just below 50,000 2, no receipt 2, policy failure 2, large reimbursement 2, approval pending over 30 days 2, slow approval 1. Severity: High from 7 points, Medium from 4. Hover a flag for its definition.</div>
  <div class="grid g4 mb">${kpi('Flagged transactions', full(base.length), `<b>${inr(sum(base))}</b> value`)}${kpi('High severity', sc.h, `<b>${inr(sum(base.filter(t => sevOf(t.sc) === 'h')))}</b> value`)}${kpi('Medium severity', sc.m, `<b>${inr(sum(base.filter(t => sevOf(t.sc) === 'm')))}</b> value`)}${kpi('Low severity', sc.l, `<b>${inr(sum(base.filter(t => sevOf(t.sc) === 'l')))}</b> value`)}</div>
  ${panel('Split payment clusters', splT, { sub: 'Same employee and vendor on the same day, combined value of 50,000 or more', cls: 'mb' })}
  <section class="panel flush" style="margin-top:14px"><div class="ph"><h3>Exception queue</h3><div class="sub">Click a row for the full record and the reason it was flagged</div></div>
  <div class="toolbar"><input type="text" id="ex-q" placeholder="Search ID, employee, vendor, invoice ID" value="${esc(EX.q)}"><div class="fchips" id="ex-sev">${sevs}</div><span style="flex:1"></span><button class="btn" data-csv="1">Export CSV</button></div>
  <div class="toolbar"><span class="lbl">Flags</span><div class="fchips" id="ex-chips">${chips}</div></div>
  <div id="ex-wrap">${exTable()}</div></section>`;
}

/* ---------- VIEW: findings ---------- */
function vFindings() {
  const sh = (lbl, set, view, ex) => `<button class="btn" data-go="${view}" data-set="${esc(set)}" ${ex ? `data-ex="${ex}"` : ''}>${lbl}</button>`;
  const f = F, E = TX.filter(t => t.eff);
  const mSum = m => sum(E.filter(t => t.m === m)), dRatio = d => sum(E.filter(t => t.dept === d)) / sum(BUD.filter(b => b.dept === d), b => b.b);
  return `<div class="prose mb"><h2>Top three insights</h2><p>Computed on the full dataset, 1 Jan to 30 Sep 2026, net spend of ${inr(f.total)}. Each finding opens the supporting records in the dashboard.</p></div>
  <section class="panel">
  <div class="finding"><div class="n">1</div><div><h4>Payments are being completed without a valid approval</h4>
  <p>${f.nap_n} transactions worth ${inr(f.nap_v)} show as completed while their approval is still pending (${f.pend_n} transactions, ${inr(f.pend_v)}) or has been rejected (${f.rej_n} transactions, ${inr(f.rej_v)}). The approval step is not acting as a gate. A rejected payment that still completes is the more serious case, because someone made an explicit decision that was overridden or never enforced.</p>
  <ul><li>Separately, 101 approvals have been pending for over 30 days, so the queue is also not being worked.</li><li>Receipts and policy checks show the same gap: 56 transactions have no receipt and no policy exception recorded.</li></ul>
  <div class="go">${sh('Open rejected and unapproved payments', '', 'exceptions', 'REJ,NAP')}</div></div></div>
  <div class="finding"><div class="n">2</div><div><h4>One contractor drives a quarter of spend, and September more than tripled its monthly run-rate</h4>
  <p>SiteServe Contractors received ${inr(f.ss_total)}, which is ${pct(f.ss_share)} of net spend and well ahead of the next vendor. In September it took ${inr(f.ss_sep)}, ${pct(f.ss_sep_share, 0)} of all September spend, and the median payment rose from ${inr(f.ss_med_jan)} in January to ${inr(f.ss_med_sep)} in September. This is the main reason total spend reached ${inr(mSum('2026-09'))} in September, against ${inr(mSum('2026-08'))} in August.</p>
  <ul><li>Only ${pct(f.ss_vp_share, 0)} of its spend went through the Vendor Payment route. The rest was paid by UPI, reimbursement or card, which are weaker controls for a contractor.</li><li>The largest single payment is ${inr(f.ss_top.amt)} (${f.ss_top.id}) by ${f.ss_top.emp} at ${f.ss_top.site} through ${f.ss_top.pay}, with approval still ${f.ss_top.appr.toLowerCase()}.</li></ul>
  <div class="go">${sh('Open SiteServe in September', 'vendor|SiteServe Contractors;m|2026-09', 'exceptions')} ${sh('Open vendor register', '', 'vendors')}</div></div></div>
  <div class="finding"><div class="n">3</div><div><h4>Duplicate invoices and payments split just under 50,000</h4>
  <p>Four records (T000901 to T000904) repeat the invoice ID, employee, vendor and amount of earlier transactions, adding ${inr(f.dup_v)} of potential double payment. These are excluded from net spend.</p>
  <p>Diya Sharma, Operations, made six UPI payments to Metro Hardware of 49,750 or 49,800, always two on the same day (14 Jul, 22 Aug, 8 Sep), ${inr(f.dd_v)} in total. Each looks clean on its own, was approved by the same approver and passed policy. Together they look like an order split to stay under an approval limit, which is an assumption to confirm against the approval matrix.</p>
  <div class="go">${sh('Open duplicates', '', 'exceptions', 'DUP')} ${sh('Open split payments', '', 'exceptions', 'SPL,NLM')}</div></div></div>
  </section>
  <section class="panel" style="margin-top:14px"><div class="prose"><h2>Also worth noting</h2>
  <p>Finance is the clearest department over budget. It spent ${inr(f.fin)} against ${inr(f.fin_b)} budgeted (${pct(f.fin / f.fin_b, 0)}), mostly on professional services and software. IT is close behind at ${pct(dRatio('IT'), 0)} of its budget, and Admin and Sales are above 75%.</p>
  <p>At the other end, Operations, Procurement and Projects hold ${inr(f.big_b)} of the ${inr(f.bud_total)} budget but recorded only ${inr(f.big_a)} (${pct(f.big_a / f.big_b, 0)}). Either those budgets include spend that is not in this extract, or they are overstated. This should be clarified before any budget decision is based on utilisation.</p></div></section>
  <section class="panel" style="margin-top:14px"><div class="prose"><h2>One thing to investigate further</h2>
  <p><b style="color:#f1f1f2">The SiteServe Contractors payments in September, and why most of them were not paid through accounts payable.</b> The step-up, the use of UPI and reimbursement for large contractor amounts, and approvals still pending on the biggest items together make this the exposure with the most money behind it.</p>
  <p>Before drawing a conclusion I would want:</p>
  <ul style="margin:8px 0 8px 18px;color:#b4b4ba;font-size:13.5px"><li>The contract and work orders for SiteServe, with agreed rates and any September scope increase such as a new site or a catch-up of earlier months.</li><li>Invoices and measurement or attendance records matching each September payment, and the payee name and account behind each UPI transfer.</li><li>Whether the approver of record was authorised for these amounts, and why the largest items were released while approval was pending.</li><li>Whether employees were reimbursed for paying the contractor personally, and the reason the AP route was not used.</li></ul></div></section>`;
}

/* ---------- VIEW: notes ---------- */
function vNotes() {
  const c = (f) => TX.filter(f).length;
  const items = [
    ['Source and period', `${TX.length} transaction records from 1 Jan 2026 to 30 Sep 2026, with budgets, employee, vendor and data dictionary tabs joined on employee ID, vendor ID and month, department and site.`],
    ['Duplicate records', `${c(t => t.dupcopy)} records (T000901 to T000904) repeat the invoice ID, employee, vendor, date and amount of an earlier record. They are excluded from net spend and visible under All records.`],
    ['Net spend definition', `Net spend excludes ${c(t => t.st === 'Declined')} declined and ${c(t => t.st === 'Reversed')} reversed transactions and the duplicates above. Pending and completed transactions are included. Switch the basis at the top right to see every record.`],
    ['Budget grain', 'Budgets exist per department, site and month. The Budget Type column on transactions (Department, Project, Site) cannot be matched to budgets, and no project-level budgets are supplied, so budget comparison is made at department, site and month level only.'],
    ['Budget coverage', 'Operations, Procurement and Projects are budgeted at all eight locations. Finance, IT, Sales, Admin and People are budgeted at HQ Bengaluru only. Total budget is far larger than recorded spend, so utilisation should be read with caution.'],
    ['Missing vendor IDs', `${c(t => !t.vid)} transactions have no vendor ID. Their payees are Employee Claim, Independent Vendor, Local Merchant and Client Venue. They are shown as unregistered payees and excluded from vendor concentration ratios.`],
    ['Approval turnaround', `Blank for ${c(t => t.tat == null)} transactions, which are the auto-approved and pending ones. Blanks are not treated as zero.`],
    ['Policy and receipt gaps', `${c(t => !t.rc)} transactions have no receipt, but only ${c(t => t.exc === 'Missing receipt')} carry the reason Missing receipt, and ${c(t => t.exc === 'Missing receipt' && t.rc)} of those have a receipt attached. ${c(t => !t.rc && t.pol)} transactions lack a receipt without any policy exception. The policy engine and the receipt field disagree.`],
    ['Weekend flag', `The weekend field disagrees with the transaction date on ${c(t => t.wk !== t.wkflag)} records. The dashboard uses the date.`],
    ['Foreign currency', `${c(t => t.cur !== 'INR')} transactions are in USD or SGD at one fixed rate per currency (83.2 and 62) for the whole period. Amounts in INR reconcile to original amount multiplied by rate.`],
    ['Thresholds are assumptions', 'The 50,000 limit used for split payment and near-limit flags, the 100,000 reimbursement limit and the 30-day pending limit are not stated in the data. They are set in the data preparation script and should be confirmed against the approval policy.'],
    ['Reproducibility', 'build_data.py in the project folder recomputes assets/data.js from the original spreadsheet. The dashboard itself needs no server or internet connection.']
  ];
  return `<section class="panel"><div class="ph"><h3>Data notes and treatment</h3><div class="sub">What was found in the raw data and how the dashboard handles it</div></div>${items.map(i => `<div class="kv" style="grid-template-columns:200px 1fr"><dt>${esc(i[0])}</dt><dd style="color:#b4b4ba">${esc(i[1])}</dd></div>`).join('')}</section>`;
}

/* ---------- drawer ---------- */
function openTx(id) {
  const t = TX.find(x => x.id === id); if (!t) return;
  const rel = TX.filter(x => x.id !== t.id && ((t.doc && x.doc === t.doc) || (x.eid === t.eid && x.vid && x.vid === t.vid && x.date === t.date)));
  const kv = [['Date', t.date + (t.wk ? ' (weekend)' : '')], ['Employee', `${t.emp} (${t.eid}), ${t.role}`], ['Department', t.dept], ['Site', t.site], ['Project', t.proj], ['Vendor', t.vendor + (t.vid ? ` (${t.vid})` : ' (no vendor ID)')], ['Category', t.cat], ['Payment method', t.pay], ['Transaction type', t.type],
    ['Amount', `INR ${full(t.amt)}` + (t.cur !== 'INR' ? ` (${t.cur} ${t.orig.toLocaleString('en-IN')} at ${t.fx})` : '')], ['Approval', `${t.appr}${t.approver ? ' by ' + t.approver : ''}${t.tat != null ? ', ' + t.tat.toFixed(1) + ' hours' : ''}`], ['Status', t.st], ['Receipt', t.rc ? 'Attached' : 'Missing'], ['Policy', t.pol ? 'Compliant' : 'Non-compliant: ' + t.exc],
    ['Recurring', t.rec], ['Budget type', t.btype], ['Entered by', t.by], ['Invoice or receipt ID', t.doc || 'None'], ['Counted in net spend', t.eff ? 'Yes' : 'No']];
  document.getElementById('drawer').innerHTML = `<div class="dh"><div><div class="lbl">Transaction</div><h2 class="mono" style="font-size:16px">${t.id}</h2><div style="margin-top:6px">${t.sc ? `<span class="sev ${sevOf(t.sc)}">${SEVN[sevOf(t.sc)]}</span> <span style="color:#7d7d85;font-size:12px;margin-left:6px">${t.sc} risk points</span>` : '<span style="color:#7d7d85;font-size:12px">No flags</span>'}</div></div><button class="btn" data-close="1">Close</button></div>
  <div class="db">${t.fl.length ? `<div style="padding:14px 0 4px"><div class="lbl" style="margin-bottom:4px">Why it was flagged</div>${t.fl.map(f => `<div class="fx"><b>${esc(FLAGS[f].label)}</b><span>${esc(FEXP[f])}${f === 'POL' && t.exc ? ' Reason recorded: ' + esc(t.exc) + '.' : ''}</span></div>`).join('')}</div>` : ''}
  <dl class="kv" style="border-bottom:0">${kv.map(k => `<dt>${k[0]}</dt><dd>${esc(k[1])}</dd>`).join('')}</dl>
  ${rel.length ? `<div class="lbl" style="margin:16px 0 6px">Related records</div>${rel.map(r => `<div class="fx" style="cursor:pointer" data-tx="${r.id}"><b class="mono">${r.id}</b> <span style="display:inline;color:#b4b4ba"> ${r.date}, ${esc(r.vendor)}, INR ${full(r.amt)}</span></div>`).join('')}` : ''}</div>`;
  document.getElementById('drawer').classList.add('on'); document.getElementById('scrim').classList.add('on');
}
function closeDrawer() { document.getElementById('drawer').classList.remove('on'); document.getElementById('scrim').classList.remove('on'); }

/* ---------- shell: tabs, filters, chips, router ---------- */
const VIEWFN = { overview: vOverview, budget: vBudget, spend: vSpend, vendors: vVendors, people: vPeople, controls: vControls, exceptions: vExceptions, findings: vFindings, notes: vNotes };
const optCache = {};
function options(k) {
  if (optCache[k]) return optCache[k];
  const d = DIM[k], vals = [...new Set(TX.map(d.get))];
  vals.sort((a, b) => k === 'm' ? a.localeCompare(b) : labelOf(k, a).localeCompare(labelOf(k, b)));
  return optCache[k] = vals;
}
const labelOf = (k, v) => DIM[k].name ? DIM[k].name(v) : v;
function renderTabs() {
  document.getElementById('tabs').innerHTML = VIEWS.map(v => `<button data-view="${v[0]}" class="${S.view === v[0] ? 'on' : ''}">${v[1]}</button>`).join('');
}
function listHtml(k) {
  const q = S.fq.toLowerCase();
  return options(k).filter(v => !q || labelOf(k, v).toLowerCase().includes(q)).map(v => `<label><input type="checkbox" data-fv="${k}|${esc(v)}" ${S.f[k].has(v) ? 'checked' : ''}>${esc(labelOf(k, v))}</label>`).join('') || '<div class="empty" style="padding:14px">No match</div>';
}
function renderFilters() {
  const prev = document.querySelector('.fpanel .fl'); const st = prev ? prev.scrollTop : 0;
  const el = document.getElementById('filters');
  el.innerHTML = DIMS.map(d => {
    const n = S.f[d.k].size, open = S.open === d.k;
    return `<div class="fd"><button data-fo="${d.k}" class="${n ? 'act' : ''}">${d.label}<b>${n ? n + ' selected' : 'All'}</b><span class="caret"></span></button>${open ? `<div class="fpanel"><div class="fs"><input type="text" id="fq" placeholder="Search ${d.label.toLowerCase()}" value="${esc(S.fq)}"></div><div class="fl">${listHtml(d.k)}</div><div class="ff"><span>${options(d.k).length} values</span><button data-fclear="${d.k}">Clear</button></div></div>` : ''}</div>`;
  }).join('') + `<button class="reset" data-reset="1">Reset all</button>`;
  const nl = document.querySelector('.fpanel .fl'); if (nl) nl.scrollTop = st;
  const ch = [];
  DIMS.forEach(d => S.f[d.k].forEach(v => ch.push(`<span class="chip">${d.label}: ${esc(labelOf(d.k, v))}<button data-rm="${d.k}|${esc(v)}" aria-label="Remove filter">x</button></span>`)));
  document.getElementById('chips').innerHTML = ch.join('');
  document.getElementById('chips').style.display = ch.length ? '' : 'none';
}
function mountCharts() {
  document.querySelectorAll('[data-chart]').forEach(el => { const fn = CH[el.dataset.chart]; if (fn) el.innerHTML = fn(Math.max(220, Math.floor(el.clientWidth))); });
}
function renderMain() {
  const m = document.getElementById('main'); const y = window.scrollY;
  m.innerHTML = VIEWFN[S.view]();
  mountCharts();
  const hasF = DIMS.some(d => S.f[d.k].size);
  document.getElementById('foot').innerHTML = `Net spend excludes declined, reversed and duplicate records. Data as of ${D.asof}. ${hasF ? 'Filters are active.' : ''}`;
  window.scrollTo(0, y);
}
function refresh() { renderTabs(); renderFilters(); renderMain(); }
function setView(v) { S.view = v; S.open = null; refresh(); window.scrollTo(0, 0); }
function toggleF(k, v) { const s = S.f[k]; if (s.size === 1 && s.has(v)) s.clear(); else { s.clear(); s.add(v); } }

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const T = e.target;
  const q = sel => T.closest(sel);
  let el;
  if ((el = q('[data-view]'))) return setView(el.dataset.view);
  if ((el = q('[data-b]'))) { S.basis = el.dataset.b; document.querySelectorAll('#basis button').forEach(b => b.classList.toggle('on', b.dataset.b === S.basis)); return refresh(); }
  if ((el = q('[data-fo]'))) { S.open = S.open === el.dataset.fo ? null : el.dataset.fo; S.fq = ''; renderFilters(); const i = document.getElementById('fq'); if (i) i.focus(); return; }
  if (q('.fpanel') && !q('[data-fclear]')) { return; }
  if ((el = q('[data-fclear]'))) { S.f[el.dataset.fclear].clear(); return refresh(); }
  if ((el = q('[data-reset]'))) { DIMS.forEach(d => S.f[d.k].clear()); S.open = null; return refresh(); }
  if ((el = q('[data-rm]'))) { const [k, v] = el.dataset.rm.split('|'); S.f[k].delete(v); return refresh(); }
  if ((el = q('[data-sort]'))) { const [id, k] = el.dataset.sort.split('|'); const s = TS[id] || (TS[id] = { k, d: -1 }); if (s.k === k) s.d *= -1; else { s.k = k; s.d = ((k === 'k' || k === 'name' || k === 'id' || k === 'emp' || k === 'vendor' || k === 'dept' || k === 'site' || k === 'cat')) ? 1 : -1; } if (id === 'ex') EX.page = 0; return renderMain(); }
  if ((el = q('[data-exf]'))) { const f = el.dataset.exf; EX.flags.has(f) ? EX.flags.delete(f) : EX.flags.add(f); EX.page = 0; return renderMain(); }
  if ((el = q('[data-exs]'))) { EX.sev = el.dataset.exs; EX.page = 0; return renderMain(); }
  if ((el = q('[data-pg]'))) { EX.page = Math.max(0, EX.page + +el.dataset.pg); document.getElementById('ex-wrap').innerHTML = exTable(); return; }
  if ((el = q('[data-csv]'))) return exportCsv();
  if ((el = q('[data-close]')) || T.id === 'scrim') return closeDrawer();
  if ((el = q('[data-tx]'))) return openTx(el.dataset.tx);
  if ((el = q('[data-go]'))) {
    if (el.dataset.set !== undefined) { DIMS.forEach(d => S.f[d.k].clear()); el.dataset.set.split(';').filter(Boolean).forEach(p => { const [k, v] = p.split('|'); S.f[k].add(v); }); }
    if (el.dataset.ex !== undefined && el.dataset.ex.split(',').includes('DUP')) { S.basis = 'all'; document.querySelectorAll('#basis button').forEach(b => b.classList.toggle('on', b.dataset.b === 'all')); }
    if (el.dataset.ex !== undefined) { EX.flags = new Set(el.dataset.ex.split(',')); EX.sev = 'all'; EX.q = ''; EX.page = 0; }
    else if (el.dataset.go === 'exceptions') { EX.flags = new Set(); }
    return setView(el.dataset.go);
  }
  if ((el = q('[data-f]'))) { const [k, v] = el.dataset.f.split('|'); toggleF(k, v); S.open = null; return refresh(); }
  if (S.open && !q('.fd')) { S.open = null; renderFilters(); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-fv]'); if (!el) return;
  const [k, v] = el.dataset.fv.split('|'); el.checked ? S.f[k].add(v) : S.f[k].delete(v);
  renderFilters(); renderMain();
  const b = document.querySelector(`[data-fo="${k}"]`); void b;
});
document.addEventListener('input', e => {
  if (e.target.id === 'fq') { S.fq = e.target.value; const l = document.querySelector('.fpanel .fl'); if (l) l.innerHTML = listHtml(S.open); }
  else if (e.target.id === 'ex-q') { EX.q = e.target.value; EX.page = 0; document.getElementById('ex-wrap').innerHTML = exTable(); }
  else if (e.target.id === 'pe-q') { PQ = e.target.value; document.getElementById('pe-wrap').innerHTML = peopleTable(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); if (S.open) { S.open = null; renderFilters(); } } });
const tip = document.getElementById('tip');
document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip]'); if (el && el.dataset.tip) { tip.textContent = el.dataset.tip; tip.classList.add('on'); } else tip.classList.remove('on'); });
document.addEventListener('mousemove', e => { if (!tip.classList.contains('on')) return; const x = Math.min(window.innerWidth - tip.offsetWidth - 12, e.clientX + 14), y = e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 12 : e.clientY + 18; tip.style.left = x + 'px'; tip.style.top = y + 'px'; });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(mountCharts, 120); });

function exportCsv() {
  const L = exFiltered().slice().sort((a, b) => b.sc - a.sc || b.amt - a.amt);
  const cols = ['Transaction ID', 'Date', 'Employee', 'Department', 'Site', 'Vendor', 'Category', 'Payment Method', 'Amount (INR)', 'Approval Status', 'Transaction Status', 'Receipt', 'Policy Reason', 'Flags', 'Risk Score', 'Severity'];
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = L.map(t => [t.id, t.date, t.emp, t.dept, t.site, t.vendor, t.cat, t.pay, t.amt, t.appr, t.st, t.rc ? 'Yes' : 'No', t.exc || '', t.fl.map(f => FLAGS[f].label).join('; '), t.sc, SEVN[sevOf(t.sc)]].map(q).join(','));
  const blob = new Blob([cols.map(q).join(',') + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'northstar_exceptions.csv'; document.body.appendChild(a); a.click(); a.remove();
}

document.getElementById('meta-line').textContent = `${full(TX.length)} records | 1 Jan 2026 to 30 Sep 2026 | ${new Set(TX.map(t => t.dept)).size} departments | ${new Set(TX.map(t => t.site)).size} locations | ${EMPS.length} employees | ${VEND.length} registered vendors`;
refresh();
})();
