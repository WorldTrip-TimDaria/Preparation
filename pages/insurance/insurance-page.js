// Insurance page: needs, verdicts, coverage and desk-research tables (data_table) and the price chart.
// Data: insurance-research.json, one section per table.
(function () {
  // ===== Data sources: every section of insurance-research.json =====
  const INSURANCE_RESEARCH_FILE = 'pages/insurance/insurance-research.json';
  dashboard.registerDataSource('insurance_needs', INSURANCE_RESEARCH_FILE, 'needs');
  dashboard.registerDataSource('insurance_verdicts_by_insurer', INSURANCE_RESEARCH_FILE, 'verdicts_by_insurer');
  dashboard.registerDataSource('insurance_coverage_by_insurer', INSURANCE_RESEARCH_FILE, 'coverage_by_insurer');
  dashboard.registerDataSource('insurance_prices_by_profile', INSURANCE_RESEARCH_FILE, 'prices_by_profile');
  dashboard.registerDataSource('insurance_comparison_desk', INSURANCE_RESEARCH_FILE, 'comparison_desk');

  // ===== What we need (must / nice / skip lists) =====
  dashboard.draw('insurance_needs_list', (el) => {
    const d = dashboard.data('insurance_needs');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.filter((r) => r.priority === el.dataset.priority).forEach((r) => {
      const li = document.createElement('li');
      li.textContent = r.cover;
      if (r.minimum) { const m = document.createElement('span'); m.className = 'insurance-need-minimum'; m.textContent = r.minimum; li.append(m); }
      el.append(li);
    });
  });

  // ===== Price chart and traveller profile switch =====
  const insurancePriceChartState = {profile: 'couple_u40'};
  document.querySelectorAll('.insurance-legend-swatch-base-price').forEach((e) => { e.style.background = dashboard.colors[0]; });
  document.querySelectorAll('.insurance-legend-swatch-usa-canada').forEach((e) => { e.style.background = dashboard.colors[2]; });
  document.querySelectorAll('.insurance-profile-switch [data-profile]').forEach((b) => b.addEventListener('click', () => {
    insurancePriceChartState.profile = b.dataset.profile;
    document.querySelectorAll('.insurance-profile-switch [data-profile]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    dashboard.draw('insurance_price_chart');
  }));

  dashboard.draw('insurance_price_chart', (el) => {
    el.replaceChildren();
    const d = dashboard.data('insurance_prices_by_profile');
    if (d.status === 'error' || d.status === 'missing' || d.status === 'declined') {
      el.classList.remove('loading-skeleton');
      const f = document.createElement('div'); f.className = 'load-failure-message'; f.textContent = 'Failed to load'; el.append(f);
      return;
    }
    if (d.status !== 'ok') { el.classList.add('loading-skeleton'); return; }
    el.classList.remove('loading-skeleton');
    const W = el.clientWidth;
    if (!W) return;
    const eur = (v) => '€' + d3.format(',')(v);
    const rows = d.data.filter((r) => r.profile === insurancePriceChartState.profile && r.base_eur != null)
      .map((r) => ({...r, base: +r.base_eur, extra: r.usa_canada_eur == null ? 0 : +r.usa_canada_eur}))
      .sort((a, b) => (a.base + a.extra) - (b.base + b.extra));
    const rowH = 30, barH = 18, top = 4;
    const H = top + rows.length * rowH + 4;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', 'Quoted price by insurer');
    const label = (r) => r.extra ? eur(r.base) + ' + ' + eur(r.extra) : eur(r.base);
    const names = svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'insurance-price-chart-insurer-name').text((r) => r.insurer);
    const vals = svg.append('g').selectAll('text').data(rows).join('text').attr('class', 'insurance-price-chart-value').text(label);
    const narrow = W < 520;
    let nameW = 0, valW = 0;
    names.each(function () { nameW = Math.max(nameW, this.getComputedTextLength()); });
    vals.each(function () { valW = Math.max(valW, this.getComputedTextLength()); });
    const x0 = narrow ? 0 : nameW + 12;
    const x = d3.scaleLinear([0, d3.max(rows, (r) => r.base + r.extra) || 1], [x0, Math.max(x0 + 40, W - valW - 10)]);
    const y = (i) => top + i * rowH + (narrow ? 12 : 0);
    if (narrow) {
      svg.attr('height', H + rows.length * 12).attr('viewBox', `0 0 ${W} ${H + rows.length * 12}`);
      el.style.minHeight = (H + rows.length * 12) + 'px';
    } else { el.style.minHeight = H + 'px'; }
    const yy = (i) => narrow ? top + i * (rowH + 12) + 14 : y(i);
    names.attr('x', narrow ? 0 : nameW).attr('text-anchor', narrow ? 'start' : 'end')
      .attr('y', (r, i) => narrow ? yy(i) - 4 : yy(i) + barH / 2).attr('dominant-baseline', narrow ? 'auto' : 'central');
    const g = svg.append('g');
    rows.forEach((r, i) => {
      const yb = narrow ? yy(i) : yy(i);
      g.append('rect').attr('x', x(0)).attr('y', yb).attr('width', Math.max(0, x(r.base) - x(0))).attr('height', barH).attr('rx', 3).style('fill', dashboard.colors[0]);
      if (r.extra) g.append('rect').attr('x', x(r.base)).attr('y', yb).attr('width', Math.max(0, x(r.base + r.extra) - x(r.base))).attr('height', barH).attr('rx', 3).style('fill', dashboard.colors[2]);
    });
    vals.attr('x', (r) => x(r.base + r.extra) + 6).attr('y', (r, i) => yy(i) + barH / 2).attr('dominant-baseline', 'central');

    const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.hidden = true; el.append(tip);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', 0).attr('width', W).attr('y', (r, i) => yy(i) - (narrow ? 14 : 6)).attr('height', narrow ? rowH + 12 : rowH).style('fill', 'transparent')
      .on('pointermove', (ev, r) => {
        const lines = [r.insurer + (r.offer ? ' · ' + r.offer : ''), 'Base ' + eur(r.base) + (r.usa_canada_eur == null ? '' : ' · USA and Canada +' + eur(r.extra))];
        if (r.note) lines.push(r.note);
        tip.replaceChildren(...lines.map((s, i) => { const dv = document.createElement('div'); if (i) dv.className = 'chart-tooltip-secondary-line'; dv.textContent = s; return dv; }));
        tip.hidden = false;
        const [px, py] = d3.pointer(ev, el);
        const tw = tip.offsetWidth;
        tip.style.left = Math.max(4, Math.min(W - tw - 4, px - tw / 2)) + 'px';
        tip.style.top = (py + 16) + 'px';
      })
      .on('pointerleave', () => { tip.hidden = true; });
  });
})();
