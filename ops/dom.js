// Tiny DOM helpers. Text always goes in as text nodes. There is no HTML parsing of data anywhere.
import { clip, fmtInt, fmtDec, fmtSecs, rate, avg, toCsv } from './lib.js';

const SAFE_HREF = /^(#\/|\/api\/ops\/)/;

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'href') {
        if (!SAFE_HREF.test(String(v))) throw new Error('unsafe href');
        el.setAttribute('href', String(v));
      } else if (/^on/i.test(k) || k === 'style' || k === 'srcdoc') continue;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

let toastTimer = 0;
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.textContent = ''; }, 3500);
}

export function download(name, mime, body) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      try { fallbackEl.focus(); const r = document.createRange(); r.selectNodeContents(fallbackEl); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch { /* selection is a courtesy */ }
    }
    return false;
  }
}

// ---------- cells that carry their own sample size ----------
// Rate with the count and the sample size beside it. Below 20 it is marked, never presented as solid.
export function rateCell(numer, den) {
  const r = rate(numer, den);
  const td = h('td', { class: 'num' });
  td.appendChild(document.createTextNode(r.text));
  td.appendChild(h('span', { class: 'sub', text: r.of }));
  if (r.low) td.appendChild(h('span', { class: 'low', text: r.none ? 'no sample' : 'n under 20' }));
  return td;
}
export function avgCell(value, n, fmt = (v) => fmtDec(v, 1)) {
  const a = avg(value, n);
  const td = h('td', { class: 'num' });
  td.appendChild(document.createTextNode(a.none ? 'n/a' : fmt(a.value)));
  td.appendChild(h('span', { class: 'sub', text: 'n=' + fmtInt(a.n) }));
  if (a.low) td.appendChild(h('span', { class: 'low', text: a.none ? 'no sample' : 'n under 20' }));
  return td;
}
export const secsCell = (v, n) => avgCell(v, n, fmtSecs);

// Plain text for rates in CSV exports: value, count, sample size on separate columns is clearer, so callers use these.
export const rateText = (numer, den) => { const r = rate(numer, den); return r.none ? '' : (Math.round(r.pct * 10) / 10); };

// ---------- table ----------
// cols: [{key, label, num, get(row), cell(row) -> Node|string, csv(row), sort(row), wrap}]
// A col may also declare csvExtra: [{label, get(row)}] for sample-size columns that exist only in the export.
export function table({ id, title, cols, rows, csvName, sort, empty, limitNote }) {
  const state = { key: sort ? sort.key : null, dir: sort ? sort.dir : 'desc' };
  const wrap = h('section', { class: 'section', 'aria-labelledby': id + '-h' });
  const heading = h('h2', { id: id + '-h', text: title });
  const bar = h('div', { class: 'tbar' }, heading);
  if (csvName && rows.length) {
    bar.appendChild(h('button', {
      type: 'button',
      text: 'Download CSV',
      'aria-label': 'Download CSV: ' + title,
      onclick: () => {
        const heads = [], getters = [];
        for (const c of cols) {
          if (c.nocsv) continue;
          heads.push(c.label);
          getters.push((r) => (c.csv ? c.csv(r) : c.get(r)));
          for (const x of c.csvExtra || []) { heads.push(x.label); getters.push(x.get); }
        }
        const body = toCsv(heads, sortedRows().map((r) => getters.map((g) => g(r))));
        download(`${csvName}-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8', body);
        toast('CSV downloaded: ' + title);
      },
    }));
  }
  wrap.appendChild(bar);
  if (limitNote) wrap.appendChild(h('p', { class: 'hint', text: limitNote }));
  if (!rows.length) {
    wrap.appendChild(h('p', { class: 'note', text: empty || 'No rows for this period.' }));
    return wrap;
  }
  const tbody = h('tbody');
  const thead = h('tr');
  const sortedRows = () => {
    const c = cols.find((x) => x.key === state.key);
    if (!c) return rows.slice();
    const val = (r) => (c.sort ? c.sort(r) : c.get(r));
    const dir = state.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  };
  const paint = () => {
    clear(tbody);
    for (const r of sortedRows()) {
      const tr = h('tr');
      for (const c of cols) {
        let cell = c.cell ? c.cell(r) : null;
        if (cell instanceof HTMLTableCellElement) { tr.appendChild(cell); continue; }
        if (cell === null) cell = clip(c.get(r));
        const td = h('td', { class: [c.num ? 'num' : '', c.wrap ? 'wrap' : ''].filter(Boolean).join(' ') || null });
        if (typeof cell === 'string' && cell.length >= 160) td.setAttribute('title', String(c.get(r)).slice(0, 600));
        td.appendChild(cell instanceof Node ? cell : document.createTextNode(cell === null || cell === undefined ? '' : String(cell)));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    for (const th of thead.children) {
      const k = th.dataset.key;
      if (k && k === state.key) th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    }
  };
  for (const c of cols) {
    const th = h('th', { scope: 'col', class: c.num ? 'num' : null, 'data-key': c.key });
    th.appendChild(h('button', {
      type: 'button', text: c.label,
      onclick: () => {
        if (state.key === c.key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else { state.key = c.key; state.dir = c.num ? 'desc' : 'asc'; }
        paint();
      },
    }));
    thead.appendChild(th);
  }
  paint();
  const scroller = h('div', { class: 'tw', tabindex: '0', role: 'region', 'aria-labelledby': id + '-h' },
    h('table', { id }, h('thead', null, thead), tbody));
  wrap.appendChild(scroller);
  return wrap;
}

export function facts(items) {
  const dl = h('dl', { class: 'facts' });
  for (const it of items) {
    dl.appendChild(h('div', null, h('dt', { text: it.label }), h('dd', null, it.value, it.sub ? h('small', { text: it.sub }) : null)));
  }
  return dl;
}

export function bars(items, label) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const ul = h('ul', { class: 'bars', 'aria-label': label });
  for (const it of items) {
    const fill = h('span');
    fill.style.width = Math.max(1, Math.round((it.n / max) * 100)) + '%';
    ul.appendChild(h('li', null, h('span', { text: clip(it.label, 60) }), h('span', { class: 'bar', 'aria-hidden': 'true' }, fill), h('span', { class: 'mono', text: fmtInt(it.n) })));
  }
  return ul;
}

export const note = (text) => h('p', { class: 'note', text });
