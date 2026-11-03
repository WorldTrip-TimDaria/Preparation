// Okinawa campervan page (no tab: opened from the Japan chapter of the trip page).
// Data: okinawa-campervan-plan.json (loop, overnight spots, rental offers) + the municipality outlines.
(function () {
  // ===== Data sources: the sections of okinawa-campervan-plan.json + the island outlines =====
  const OKINAWA_PLAN_FILE = 'pages/okinawa/okinawa-campervan-plan.json';
  dashboard.registerDataSource('okinawa_campervan_loop', OKINAWA_PLAN_FILE, 'loop');
  dashboard.registerDataSource('okinawa_overnight_spots', OKINAWA_PLAN_FILE, 'overnight_spots');
  dashboard.registerDataSource('okinawa_campervan_rental_offers', OKINAWA_PLAN_FILE, 'rental_offers');
  dashboard.registerDataSource('okinawa_municipality_outlines', 'pages/okinawa/okinawa-municipality-outlines-do-not-edit.json');

  // ===== Calculations =====
  dashboard.calc('okinawa_stays_with_nights', {
    inputs: ['okinawa_campervan_loop'],
    title: 'Okinawa loop with nights',
    description: 'Each stop of the campervan loop with the nights between arriving and leaving.',
    fn: (okinawa_loop) => okinawa_loop.map((r) => ({...r, nights: Math.round((Date.parse(r.depart) - Date.parse(r.arrive)) / 864e5)})).sort((a, b) => a.order - b.order)
  });
  dashboard.calc('okinawa_overall_totals', {
    inputs: ['okinawa_stays_with_nights'],
    title: 'Okinawa loop totals',
    description: 'Nights in the van, rough cost for two (nights × daily allowance) and paid parking (nights × nightly fee).',
    fn: (okinawa_stays) => [{nights: okinawa_stays.reduce((t, r) => t + r.nights, 0),
      cost_eur: okinawa_stays.reduce((t, r) => t + r.nights * r.daily_eur, 0),
      parking_jpy: okinawa_stays.reduce((t, r) => t + r.nights * (r.parking_jpy || 0), 0),
      unknown_fee_nights: okinawa_stays.filter((r) => r.parking_jpy == null).reduce((t, r) => t + r.nights, 0)}]
  });

  // ===== Campervan map =====
  const OKINAWA_PROJECTION = {lon0: 127.95, lat0: 26.5, k: 1000};
  OKINAWA_PROJECTION.c = Math.cos(OKINAWA_PROJECTION.lat0 * Math.PI / 180);
  const projectOkinawaPoint = (lon, lat) => [(lon - OKINAWA_PROJECTION.lon0) * OKINAWA_PROJECTION.c * OKINAWA_PROJECTION.k, -(lat - OKINAWA_PROJECTION.lat0) * OKINAWA_PROJECTION.k];
  const overnightSpotKind = (type) => /^Paid/.test(type) ? 'paid' : /^Roadside/.test(type) ? 'day' : /^Free/.test(type) ? 'free' : 'camp';
  const overnightSpotColor = (kind) => kind === 'paid' ? dashboard.colors[2] : kind === 'free' ? 'var(--color-success)' : dashboard.colors[3];
  document.querySelectorAll('.okinawa-legend-swatch-paid-park').forEach((e) => { e.style.fill = dashboard.colors[2]; });
  document.querySelectorAll('.okinawa-legend-swatch-free-spot').forEach((e) => { e.style.fill = 'var(--color-success)'; });
  document.querySelectorAll('.okinawa-legend-swatch-campsite').forEach((e) => { e.style.fill = dashboard.colors[3]; });
  document.querySelectorAll('.okinawa-legend-swatch-route').forEach((e) => { e.style.stroke = dashboard.colors[0]; });

  dashboard.draw('okinawa_campervan_map', (el) => {
    el.replaceChildren();
    const sh = dashboard.data('okinawa_municipality_outlines'), sp = dashboard.data('okinawa_overnight_spots'), lp = dashboard.data('okinawa_stays_with_nights');
    if ([sh, sp, lp].some((d) => d.status === 'error' || d.status === 'missing')) {
      el.classList.remove('loading-skeleton');
      const f = document.createElement('div'); f.className = 'load-failure-message'; f.textContent = 'Failed to load'; el.append(f); return;
    }
    if ([sh, sp, lp].some((d) => d.status !== 'ok')) { el.classList.add('loading-skeleton'); return; }
    el.classList.remove('loading-skeleton');
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const pts = sp.data.map((s) => projectOkinawaPoint(s.lon, s.lat)).concat(lp.data.map((s) => projectOkinawaPoint(s.lon, s.lat)));
    const pad = 0.05 * OKINAWA_PROJECTION.k;
    const x0 = d3.min(pts, (p) => p[0]) - pad, x1 = d3.max(pts, (p) => p[0]) + pad, y0 = d3.min(pts, (p) => p[1]) - pad, y1 = d3.max(pts, (p) => p[1]) + pad;
    const k = Math.min(W / (x1 - x0), H / (y1 - y0));
    const tx = W / 2 - k * (x0 + x1) / 2, ty = H / 2 - k * (y0 + y1) / 2;
    const S = (lon, lat) => { const p = projectOkinawaPoint(lon, lat); return [tx + k * p[0], ty + k * p[1]]; };
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Map of Okinawa main island with overnight spots and our loop');
    svg.append('rect').attr('class', 'okinawa-map-sea').attr('width', W).attr('height', H).attr('rx', 6);
    svg.append('g').attr('transform', `translate(${tx},${ty}) scale(${k})`).selectAll('path').data(sh.data).join('path').attr('class', 'okinawa-map-land').attr('d', (d) => d.d);
    const loop = lp.data;
    svg.append('path').attr('class', 'okinawa-map-route').style('stroke', dashboard.colors[0])
      .attr('d', 'M' + loop.map((s) => S(s.lon, s.lat).map((v) => v.toFixed(1)).join(',')).join('L'));
    const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.hidden = true; el.append(tip);
    const showTip = (ev, lines) => {
      tip.replaceChildren(...lines.map((s, i) => { const dv = document.createElement('div'); if (i) dv.className = 'chart-tooltip-secondary-line'; dv.textContent = s; return dv; }));
      tip.hidden = false;
      const [px, py] = d3.pointer(ev, el); const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, px - tw / 2)) + 'px';
      tip.style.top = (py - th - 14 < 4 ? py + 16 : py - th - 14) + 'px';
    };
    const g = svg.append('g').selectAll('g').data(sp.data).join('g').attr('transform', (d) => `translate(${S(d.lon, d.lat).join(',')})`)
      .on('pointermove', (ev, d) => showTip(ev, [d.name, d.type + ' · ' + d.town, d.fee + (d.facilities ? ' · ' + d.facilities : '')]))
      .on('pointerleave', () => { tip.hidden = true; });
    g.each(function (d) {
      const kind = overnightSpotKind(d.type), sel = d3.select(this);
      if (kind === 'paid') sel.append('rect').attr('x', -6).attr('y', -6).attr('width', 12).attr('height', 12).attr('rx', 2);
      else if (kind === 'free') sel.append('circle').attr('r', 6);
      else if (kind === 'day') sel.append('circle').attr('r', 4.5);
      else sel.append('path').attr('d', 'M0 -7 L6.5 5 L-6.5 5 Z');
      sel.select(':first-child').attr('class', 'okinawa-map-spot').style('fill', kind === 'day' ? 'none' : overnightSpotColor(kind)).style('stroke', kind === 'day' ? 'var(--color-text-muted)' : null);
      sel.append('circle').attr('r', 12).style('fill', 'transparent');
    });
    const seen = new Map();
    loop.forEach((s) => { const key = s.lat + ',' + s.lon; seen.set(key, (seen.get(key) || []).concat(s)); });
    const badges = [...seen.values()];
    const b = svg.append('g').selectAll('g').data(badges).join('g').attr('transform', (ss) => { const [x, y] = S(ss[0].lon, ss[0].lat); return `translate(${x + 14},${y - 14})`; })
      .on('pointermove', (ev, ss) => showTip(ev, [ss.map((s) => s.order).join(' and ') + '. ' + ss[0].place, ss.map((s) => s.spot + (s.nights ? ' · ' + s.nights + ' nights' : '')).join(' / ')]))
      .on('pointerleave', () => { tip.hidden = true; });
    b.append('circle').attr('r', 10).style('fill', dashboard.colors[0]).style('stroke', 'var(--color-panel)').style('stroke-width', 1.5);
    b.append('text').attr('class', 'okinawa-map-badge-text').text((ss) => ss.length > 1 ? ss[0].order + '/' + ss[ss.length - 1].order : ss[0].order).style('font-size', (ss) => ss.length > 1 ? '8px' : null);
    b.append('text').attr('class', 'okinawa-map-label').attr('x', 14).attr('dy', '0.35em').text((ss) => ss[0].place);
  });

  // ===== Loop list =====
  dashboard.draw('okinawa_loop_list', (el) => {
    el.replaceChildren();
    const d = dashboard.data('okinawa_stays_with_nights');
    if (d.status !== 'ok') return;
    const fmt = d3.utcFormat('%-d %b');
    d.data.forEach((s) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'okinawa-loop-stop-number'; n.style.background = dashboard.colors[0]; n.textContent = s.order;
      const p = document.createElement('span'); p.className = 'okinawa-loop-place'; p.textContent = s.place + ' · ' + s.spot;
      const sub = document.createElement('span'); sub.className = 'okinawa-loop-details';
      sub.textContent = fmt(new Date(s.arrive)) + (s.nights ? ' – ' + fmt(new Date(s.depart)) + ' · ' + s.nights + (s.nights === 1 ? ' night · ' : ' nights · ') + (s.parking_jpy == null ? 'fee to confirm' : s.parking_jpy ? '¥' + d3.format(',')(s.parking_jpy) + '/night' : 'free') + ' · ~€' + s.daily_eur + '/day for two' : '');
      li.append(n, p, sub); el.append(li);
    });
  });
})();
