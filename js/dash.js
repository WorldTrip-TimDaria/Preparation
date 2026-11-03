// A small stand-in for the dashboard runtime the page was written for.
// It loads the files in data/, runs the calculations and redraws on data or size changes.
(function () {
  const SOURCES = {
    stops: 'data/stops.csv',
    countries: 'data/countries.json',
    expenses: 'data/expenses.csv',
    needs: 'data/needs.json',
    coverage: 'data/coverage.json',
    prices: 'data/prices.json',
    desk: 'data/desk.json',
    verdicts: 'data/verdicts.json',
    okinawa_shapes: 'data/okinawa_shapes.json',
    okinawa_spots: 'data/okinawa_spots.json',
    okinawa_loop: 'data/okinawa_loop.json',
    okinawa_vans: 'data/okinawa_vans.json',
  };

  const raw = {};      // id -> {status, data, message}
  const calcs = {};    // id -> {inputs, fn}
  const memo = {};     // id -> cached calc result
  const draws = {};    // name -> fn
  const onDataFns = [];

  const readVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function data(id) {
    if (raw[id]) return {...raw[id], columns: raw[id].data && raw[id].data.columns ? raw[id].data.columns : (raw[id].data && raw[id].data[0] ? Object.keys(raw[id].data[0]) : []), meta: []};
    const c = calcs[id];
    if (!c) return {status: 'missing', data: [], message: 'Unknown source ' + id};
    if (id in memo) return memo[id];
    const ins = c.inputs.map((i) => data(i));
    const bad = ins.find((d) => d.status !== 'ok');
    if (bad) return {status: bad.status === 'loading' ? 'loading' : 'error', data: [], message: bad.message};
    try {
      const out = c.fn(...ins.map((d) => d.data));
      memo[id] = {status: 'ok', data: out, columns: Array.isArray(out) && out[0] ? Object.keys(out[0]) : [], meta: []};
    } catch (e) {
      console.error('calc ' + id, e);
      memo[id] = {status: 'error', data: [], message: String(e)};
    }
    return memo[id];
  }

  function runDraw(name) {
    const fn = draws[name];
    if (!fn) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
      if (el.closest('[hidden]')) return;
      try { fn(el); } catch (e) { console.error('draw ' + name, e); }
    });
  }
  function runAll() {
    onDataFns.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    Object.keys(draws).forEach(runDraw);
  }

  // Redraw an element when its size changes (also when a hidden page is shown).
  const sizes = new WeakMap();
  const ro = new ResizeObserver((entries) => {
    entries.forEach((en) => {
      const el = en.target, w = Math.round(en.contentRect.width), h = Math.round(en.contentRect.height);
      const prev = sizes.get(el);
      sizes.set(el, w + 'x' + h);
      if (prev === w + 'x' + h || !w) return;
      const fn = draws[el.dataset.draw];
      if (fn && !el.closest('[hidden]')) { try { fn(el); } catch (e) { console.error(e); } }
    });
  });

  const dash = {
    data,
    calc(id, opts) { calcs[id] = opts; },
    draw(name, fn) {
      draws[name] = typeof fn === 'function' ? fn : draws[name];
      if (typeof fn === 'function') {
        document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => ro.observe(el));
        runDraw(name);
      } else runDraw(name);
    },
    onData(fn) { onDataFns.push(fn); try { fn(); } catch (e) { console.error(e); } },
    get colors() { return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => readVar('--series-' + i)); },
    setLink(id) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } },
    params() { return {}; }, setParams() {}, resetParams() {}, refresh() {},
  };
  window.dash = dash;

  const load = (id, url) => {
    raw[id] = {status: 'loading', data: []};
    return fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); })
      .then((txt) => {
        const rows = url.endsWith('.csv') ? d3.csvParse(txt) : JSON.parse(txt);
        raw[id] = {status: 'ok', data: Array.isArray(rows) ? rows : (rows.rows || rows.data || rows.results || [])};
      })
      .catch((e) => { console.error(e); raw[id] = {status: 'error', data: [], message: String(e)}; });
  };
  Object.entries(SOURCES).forEach(([id, url]) => { raw[id] = {status: 'loading', data: []}; });
  window.addEventListener('DOMContentLoaded', () => {
    Promise.all(Object.entries(SOURCES).map(([id, url]) => load(id, url).then(() => {
      Object.keys(memo).forEach((k) => delete memo[k]);
    }))).then(runAll);
  });
  // When a page is shown (its hidden attribute removed), redraw everything on it.
  let pending = 0;
  new MutationObserver((muts) => {
    if (!muts.some((m) => m.target.classList && m.target.classList.contains('pg') && !m.target.hidden)) return;
    cancelAnimationFrame(pending); pending = requestAnimationFrame(runAll);
  })
    .observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ['hidden']});
  // Redraw on theme change so colours follow.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', runAll);
})();
