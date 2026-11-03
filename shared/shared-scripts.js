// Shared scripts for every page, loaded once at the end of <body> before the pages/<page>/<page>-page.js files.
//   1. Dashboard runtime: loads the data files each page registers, runs the calculations and
//      redraws every element marked data-draw="<draw name>" when data arrives, its size changes or its page is shown.
//   2. Draw functions used on several pages: number_value and data_table.
//   3. Page (tab) switching and #hash links.
//
// How a page uses the runtime (see README.md):
//   dashboard.registerDataSource('<id>', '<path to .csv or .json>', '<section key in a merged .json, optional>');
//   dashboard.calc('<id>', {inputs: ['<id>', ...], fn: (...inputRows) => rows});   // derived data, recomputed lazily
//   dashboard.draw('<draw name>', (element) => { ... dashboard.data('<id>') ... });  // fills each element with that data-draw
//   dashboard.data('<id>') -> {status: 'loading' | 'ok' | 'error' | 'missing', data: rows, message}

// ===== 1. Dashboard runtime =====
(function () {
  const dataSources = {};               // data source id -> {path, sectionKey}
  const loadedDataSources = {};         // data source id -> {status, data, message}
  const calculations = {};              // calculation id -> {inputs, fn}
  const calculationResultCache = {};    // calculation id -> result of data(id)
  const drawFunctions = {};             // draw name -> function (element)
  const onDataCallbacks = [];

  const readCssVariable = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function data(id) {
    if (loadedDataSources[id]) return loadedDataSources[id];
    const calculation = calculations[id];
    if (!calculation) return {status: 'missing', data: [], message: 'Unknown data source or calculation ' + id};
    if (id in calculationResultCache) return calculationResultCache[id];
    const inputs = calculation.inputs.map((inputId) => data(inputId));
    const notReady = inputs.find((input) => input.status !== 'ok');
    if (notReady) return {status: notReady.status === 'loading' ? 'loading' : 'error', data: [], message: notReady.message};
    try {
      calculationResultCache[id] = {status: 'ok', data: calculation.fn(...inputs.map((input) => input.data))};
    } catch (error) {
      console.error('calculation ' + id, error);
      calculationResultCache[id] = {status: 'error', data: [], message: String(error)};
    }
    return calculationResultCache[id];
  }

  function runDrawFunction(name) {
    const drawFunction = drawFunctions[name];
    if (!drawFunction) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((element) => {
      if (element.closest('[hidden]')) return;
      try { drawFunction(element); } catch (error) { console.error('draw ' + name, error); }
    });
  }
  function redrawEverything() {
    onDataCallbacks.forEach((callback) => { try { callback(); } catch (error) { console.error(error); } });
    Object.keys(drawFunctions).forEach(runDrawFunction);
  }

  // Redraw an element when its size changes (also when a hidden page is shown).
  const lastElementSizes = new WeakMap();
  const elementResizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => {
      const element = entry.target;
      const size = Math.round(entry.contentRect.width) + 'x' + Math.round(entry.contentRect.height);
      const previousSize = lastElementSizes.get(element);
      lastElementSizes.set(element, size);
      if (previousSize === size || !Math.round(entry.contentRect.width)) return;
      const drawFunction = drawFunctions[element.dataset.draw];
      if (drawFunction && !element.closest('[hidden]')) { try { drawFunction(element); } catch (error) { console.error(error); } }
    });
  });

  const dashboard = {
    registerDataSource(id, path, sectionKey) {
      dataSources[id] = {path, sectionKey};
      loadedDataSources[id] = {status: 'loading', data: []};
    },
    data,
    calc(id, options) { calculations[id] = options; },
    // With a function: register it and draw. Without: redraw every element with that data-draw.
    draw(name, drawFunction) {
      if (typeof drawFunction === 'function') {
        drawFunctions[name] = drawFunction;
        document.querySelectorAll('[data-draw="' + name + '"]').forEach((element) => elementResizeObserver.observe(element));
      }
      runDrawFunction(name);
    },
    onData(callback) { onDataCallbacks.push(callback); try { callback(); } catch (error) { console.error(error); } },
    // The chart colours --series-1 ... --series-8 from shared-styles.css (they follow light/dark mode).
    get colors() { return [1, 2, 3, 4, 5, 6, 7, 8].map((index) => readCssVariable('--series-' + index)); },
    setLink(id) { try { history.replaceState(null, '', '#' + id); } catch (error) { /* ignore */ } },
  };
  window.dashboard = dashboard;

  // Several data sources can point at sections of the same file: fetch each file once.
  const fileTextByPath = {};
  const fetchFileText = (path) => fileTextByPath[path] || (fileTextByPath[path] = fetch(path).then((response) => {
    if (!response.ok) throw new Error(response.status + ' ' + path);
    return response.text();
  }));
  const loadDataSource = (id) => {
    const {path, sectionKey} = dataSources[id];
    return fetchFileText(path)
      .then((text) => {
        let rows = path.endsWith('.csv') ? d3.csvParse(text) : JSON.parse(text);
        if (sectionKey) {
          if (!(sectionKey in rows)) throw new Error('No section "' + sectionKey + '" in ' + path);
          rows = rows[sectionKey];
        }
        loadedDataSources[id] = {status: 'ok', data: Array.isArray(rows) ? rows : []};
      })
      .catch((error) => { console.error(error); loadedDataSources[id] = {status: 'error', data: [], message: String(error)}; })
      .then(() => { Object.keys(calculationResultCache).forEach((key) => delete calculationResultCache[key]); });
  };
  // The page scripts run before DOMContentLoaded, so every data source is registered by then.
  window.addEventListener('DOMContentLoaded', () => {
    Promise.all(Object.keys(dataSources).map(loadDataSource)).then(redrawEverything);
  });

  // When a page is shown (its hidden attribute removed), redraw everything on it.
  let pendingRedrawFrame = 0;
  new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.target.classList && mutation.target.classList.contains('page') && !mutation.target.hidden)) return;
    cancelAnimationFrame(pendingRedrawFrame);
    pendingRedrawFrame = requestAnimationFrame(redrawEverything);
  }).observe(document.documentElement, {subtree: true, attributes: true, attributeFilter: ['hidden']});
  // Redraw on light/dark change so colours follow.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawEverything);
})();

// ===== 2. Draw functions used on several pages, and 3. page switching =====
(function () {
  // number_value: <b data-draw="number_value" data-source="<id>" data-field="<column>" data-row="0"> or data-where="column=value".
  // data-fmt="pct" shows a percentage, data-fmt="eur2" two decimals; otherwise a rounded integer.
  const formatInteger = d3.format(','), formatPercent = d3.format('.0%');

  const findRowForElement = (el, rows) => {
    if (el.dataset.where) {
      const pairs = el.dataset.where.split('&').map((p) => p.split('=').map(decodeURIComponent));
      return rows.find((r) => pairs.every(([k, v]) => String(r[k]) === v));
    }
    return rows[+(el.dataset.row || 0)];
  };

  dashboard.draw('number_value', (el) => {
    const d = dashboard.data(el.dataset.source);
    const row = d.status === 'ok' ? findRowForElement(el, d.data) : null;
    const v = row ? row[el.dataset.field] : null;
    el.textContent = v == null || Number.isNaN(v) ? '—' : el.dataset.fmt === 'pct' ? formatPercent(v) : el.dataset.fmt === 'eur2' ? d3.format(',.2f')(v) : formatInteger(Math.round(v));
  });

  // data_table: <table data-draw="data_table" data-source="<id>" data-cols="column|Header;column|Header">.
  // Columns ending in _eur are formatted as money; verdict/status cells and data-rowclass rows get an is-<value> class,
  // and a cell whose row has <column>_flag gets is-<flag>.
  dashboard.draw('data_table', (el) => {
    const d = dashboard.data(el.dataset.source);
    el.replaceChildren();
    if (d.status !== 'ok') return;
    const cols = el.dataset.cols.split(';').map((s) => s.split('|'));
    const hr = el.createTHead().insertRow();
    cols.forEach(([f, label]) => { const th = document.createElement('th'); th.scope = 'col'; th.dataset.field = f; th.textContent = label; hr.append(th); });
    const tb = el.createTBody();
    d.data.forEach((r) => {
      const tr = tb.insertRow();
      if (el.dataset.rowclass && r[el.dataset.rowclass]) tr.className = 'is-' + String(r[el.dataset.rowclass]).replace(/\s+/g, '-');
      cols.forEach(([f]) => {
        const td = tr.insertCell();
        const v = r[f] == null ? '' : String(r[f]);
        const money = /_eur$/.test(f);
        td.textContent = money ? (r[f] == null ? '' : d3.format(',.2f')(r[f])) : v;
        if (money) td.classList.add('is-num');
        // The colour class ignores a reason in brackets: 'Fails (no grandparents)' -> is-Fails.
        if ((f === 'verdict' || f === 'status') && v) td.className = 'is-' + v.replace(/\s*\(.*$/, '').replace(/\s+/g, '-');
        if (r[f + '_flag']) td.classList.add('is-' + String(r[f + '_flag']).replace(/\s+/g, '-'));
      });
    });
  });

  // Pages (tabs): one <section class="page"> shown at a time. Any element with data-page="<section id>" opens that page;
  // data-scroll="<element id>" also scrolls to that element. A #hash link to an element opens the page containing it.
  const showPage = (id, scrollTo) => {
    document.querySelectorAll('.page').forEach((p) => { p.hidden = p.id !== id; });
    document.querySelectorAll('.page-tabs [data-page]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.page === id)));
    dashboard.setLink(id);
    const target = (scrollTo && document.getElementById(scrollTo)) || document.querySelector('.page-tabs');
    if (target) target.scrollIntoView({block: 'start'});
  };
  document.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => showPage(b.dataset.page, b.dataset.scroll)));
  {
    const named = location.hash.slice(1);
    const el = named && document.getElementById(named);
    const pageSection = el && el.closest('.page');
    if (pageSection && pageSection.id !== 'trip') showPage(pageSection.id, named);
  }
})();
