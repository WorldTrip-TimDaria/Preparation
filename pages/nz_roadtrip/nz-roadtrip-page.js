// New Zealand campervan road trip page (no tab: opened from the New Zealand chapter of the trip page).
// Data: nz-roadtrip-plan.json (settings, loop, rental offers) + the New Zealand outlines.
// One route, two lengths: each stop has nights_three_weeks and nights_two_weeks; the toggle picks which one is shown.
(function () {
  // ===== Data sources: the sections of nz-roadtrip-plan.json + the outlines =====
  const NZ_ROADTRIP_PLAN_FILE = 'pages/nz_roadtrip/nz-roadtrip-plan.json';
  dashboard.registerDataSource('nz_roadtrip_settings', NZ_ROADTRIP_PLAN_FILE, 'settings');
  dashboard.registerDataSource('nz_roadtrip_loop', NZ_ROADTRIP_PLAN_FILE, 'loop');
  dashboard.registerDataSource('nz_roadtrip_rental_offers', NZ_ROADTRIP_PLAN_FILE, 'rental_offers');
  dashboard.registerDataSource('nz_roadtrip_outlines', 'pages/nz_roadtrip/nz-outlines-do-not-edit.json');

  const VERSIONS = ['three_weeks', 'two_weeks'];
  const pageState = {version: 'three_weeks'};

  // ===== Calculations =====
  dashboard.calc('nz_roadtrip_stays_by_version', {
    inputs: ['nz_roadtrip_loop', 'nz_roadtrip_settings'],
    title: 'Road trip stops with dates, for each version',
    description: 'Each stop of the loop for the 3-week and the 2-week version, with its nights and the dates counted from the pick-up day.',
    fn: (loop, settings) => {
      const start = Date.parse(settings[0].start_date);
      const ordered = loop.slice().sort((a, b) => a.order - b.order);
      return VERSIONS.flatMap((version) => {
        let day = 0;
        return ordered.map((stop) => {
          const nights = stop['nights_' + version] || 0;
          const arrive = new Date(start + day * 864e5);
          day += nights;
          return {...stop, version, nights, arrive, depart: new Date(start + day * 864e5)};
        });
      });
    }
  });

  dashboard.calc('nz_roadtrip_totals', {
    inputs: ['nz_roadtrip_stays_by_version', 'nz_roadtrip_settings'],
    title: 'Road trip totals, for each version',
    description: 'Nights, road km and a rough cost for the whole group: van and Full Cover per hire day (nights + 1), diesel, campsites per adult per night, the ferry and food; then per person and in euros.',
    fn: (stays, settings) => {
      const s = settings[0];
      return VERSIONS.map((version) => {
        const ss = stays.filter((r) => r.version === version);
        const nights = ss.reduce((t, r) => t + r.nights, 0), hireDays = nights + 1;
        const road_km = ss.reduce((t, r) => t + r.road_km_in + (r.nights ? r.day_trip_km : 0), 0);
        const van_nzd = hireDays * s.van_nzd_per_day, cover_nzd = hireDays * s.cover_nzd_per_day;
        const fuel_nzd = road_km / 100 * s.fuel_litres_per_100km * s.diesel_nzd_per_litre;
        const campsite_nzd = ss.reduce((t, r) => t + r.nights * r.fee_nzd_per_adult * s.people, 0);
        const food_nzd = hireDays * s.food_nzd_per_person_per_day * s.people, ferry_nzd = s.ferry_nzd;
        const total_nzd = van_nzd + cover_nzd + fuel_nzd + campsite_nzd + ferry_nzd + food_nzd;
        return {version, nights, hire_days: hireDays, road_km, van_nzd, cover_nzd, fuel_nzd, campsite_nzd, ferry_nzd, food_nzd, total_nzd,
          per_person_nzd: total_nzd / s.people, per_person_eur: total_nzd / s.people * s.eur_per_nzd, people: s.people};
      });
    }
  });

  // ===== 3 weeks / 2 weeks toggle =====
  // The stat tiles read the totals row of the chosen version through data-where="version=...".
  const showVersion = (version) => {
    pageState.version = version;
    document.querySelectorAll('[data-roadtrip-version]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.roadtripVersion === version)));
    document.querySelectorAll('[data-source="nz_roadtrip_totals"]').forEach((el) => { el.dataset.where = 'version=' + version; });
    ['number_value', 'nz_roadtrip_map', 'nz_roadtrip_loop_list', 'nz_roadtrip_cost_breakdown'].forEach((name) => dashboard.draw(name));
  };
  document.querySelectorAll('[data-roadtrip-version]').forEach((b) => b.addEventListener('click', () => showVersion(b.dataset.roadtripVersion)));

  const formatDay = d3.utcFormat('%-d %b'), formatNzd = (v) => 'NZ$' + d3.format(',')(Math.round(v));
  const staysOfVersion = () => {
    const d = dashboard.data('nz_roadtrip_stays_by_version');
    return d.status === 'ok' ? d.data.filter((r) => r.version === pageState.version) : null;
  };
  const isDepot = (stop) => stop.type === 'Depot';

  // ===== Road trip map =====
  // Same form as OKINAWA_PROJECTION, centred on New Zealand; the outline file was projected with these constants.
  const NZ_PROJECTION = {lon0: 172.5, lat0: -41, k: 1000};
  NZ_PROJECTION.c = Math.cos(NZ_PROJECTION.lat0 * Math.PI / 180);
  const projectNzPoint = (lon, lat) => [(lon - NZ_PROJECTION.lon0) * NZ_PROJECTION.c * NZ_PROJECTION.k, -(lat - NZ_PROJECTION.lat0) * NZ_PROJECTION.k];
  const overnightSpotKind = (type) => /^Depot/.test(type) ? 'depot' : /^Free/.test(type) ? 'free' : /^DOC/.test(type) ? 'doc' : 'paid';
  const overnightSpotColor = (kind) => kind === 'paid' ? dashboard.colors[2] : kind === 'free' ? 'var(--color-success)' : dashboard.colors[3];
  document.querySelectorAll('.nz-roadtrip-legend-swatch-paid').forEach((e) => { e.style.fill = dashboard.colors[2]; });
  document.querySelectorAll('.nz-roadtrip-legend-swatch-free').forEach((e) => { e.style.fill = 'var(--color-success)'; });
  document.querySelectorAll('.nz-roadtrip-legend-swatch-doc').forEach((e) => { e.style.fill = dashboard.colors[3]; });
  document.querySelectorAll('.nz-roadtrip-legend-swatch-route').forEach((e) => { e.style.stroke = dashboard.colors[0]; });

  dashboard.draw('nz_roadtrip_map', (el) => {
    el.replaceChildren();
    const outlines = dashboard.data('nz_roadtrip_outlines'), stays = dashboard.data('nz_roadtrip_stays_by_version');
    if ([outlines, stays].some((d) => d.status === 'error' || d.status === 'missing')) {
      el.classList.remove('loading-skeleton');
      const f = document.createElement('div'); f.className = 'load-failure-message'; f.textContent = 'Failed to load'; el.append(f); return;
    }
    if ([outlines, stays].some((d) => d.status !== 'ok')) { el.classList.add('loading-skeleton'); return; }
    el.classList.remove('loading-skeleton');
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const loop = staysOfVersion();
    // Frame the whole country (North Cape to Stewart Island, Fiordland to East Cape), so labels near the coast stay visible.
    const [x0, y0] = projectNzPoint(166.2, -34.2), [x1, y1] = projectNzPoint(178.8, -47.4);
    const k = Math.min(W / (x1 - x0), H / (y1 - y0));
    const tx = W / 2 - k * (x0 + x1) / 2, ty = H / 2 - k * (y0 + y1) / 2;
    const S = (lon, lat) => { const p = projectNzPoint(lon, lat); return [tx + k * p[0], ty + k * p[1]]; };
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Map of New Zealand with the campervan route and where we sleep');
    svg.append('rect').attr('class', 'nz-roadtrip-map-sea').attr('width', W).attr('height', H).attr('rx', 6);
    svg.append('g').attr('transform', `translate(${tx},${ty}) scale(${k})`).selectAll('path').data(outlines.data).join('path').attr('class', 'nz-roadtrip-map-land').attr('d', (d) => d.d);
    // One path per leg, so the ferry crossing can be dashed.
    svg.append('g').selectAll('path').data(loop.slice(1)).join('path')
      .attr('class', (s) => 'nz-roadtrip-map-route' + (s.ferry_in ? ' is-ferry' : '')).style('stroke', dashboard.colors[0])
      .attr('d', (s, i) => 'M' + S(loop[i].lon, loop[i].lat).join(',') + 'L' + S(s.lon, s.lat).join(','));
    const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.hidden = true; el.append(tip);
    const showTip = (ev, lines) => {
      tip.replaceChildren(...lines.map((s, i) => { const dv = document.createElement('div'); if (i) dv.className = 'chart-tooltip-secondary-line'; dv.textContent = s; return dv; }));
      tip.hidden = false;
      const [px, py] = d3.pointer(ev, el); const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, px - tw / 2)) + 'px';
      tip.style.top = (py - th - 14 < 4 ? py + 16 : py - th - 14) + 'px';
    };
    const g = svg.append('g').selectAll('g').data(loop).join('g').attr('transform', (d) => `translate(${S(d.lon, d.lat).join(',')})`)
      .on('pointermove', (ev, d) => showTip(ev, [d.order + '. ' + d.place, d.spot + (d.nights ? ' · ' + d.nights + (d.nights === 1 ? ' night' : ' nights') : ''), d.fee || d.highlights]))
      .on('pointerleave', () => { tip.hidden = true; });
    g.each(function (d) {
      const kind = overnightSpotKind(d.type), sel = d3.select(this), skipped = !d.nights && !isDepot(d);
      if (kind === 'paid') sel.append('rect').attr('x', -6).attr('y', -6).attr('width', 12).attr('height', 12).attr('rx', 2);
      else if (kind === 'free') sel.append('circle').attr('r', 6);
      else if (kind === 'doc') sel.append('path').attr('d', 'M0 -7 L6.5 5 L-6.5 5 Z');
      else sel.append('circle').attr('r', 4.5);
      sel.select(':first-child').attr('class', 'nz-roadtrip-map-spot')
        .style('fill', kind === 'depot' || skipped ? 'var(--color-panel)' : overnightSpotColor(kind))
        .style('stroke', kind === 'depot' || skipped ? 'var(--color-text-muted)' : null);
      sel.append('circle').attr('r', 12).style('fill', 'transparent');
    });
    const b = svg.append('g').selectAll('g').data(loop).join('g').attr('transform', (s) => { const [x, y] = S(s.lon, s.lat); return `translate(${x + 14},${y - 12})`; })
      .on('pointermove', (ev, d) => showTip(ev, [d.order + '. ' + d.place, d.highlights]))
      .on('pointerleave', () => { tip.hidden = true; });
    b.append('circle').attr('r', 9).style('fill', dashboard.colors[0]).style('stroke', 'var(--color-panel)').style('stroke-width', 1.5);
    b.append('text').attr('class', 'nz-roadtrip-map-badge-text').text((s) => s.order);
    b.append('text').attr('class', 'nz-roadtrip-map-label').attr('x', 13).attr('dy', '0.35em').text((s) => s.place);
  });

  // ===== Loop list =====
  dashboard.draw('nz_roadtrip_loop_list', (el) => {
    el.replaceChildren();
    const loop = staysOfVersion();
    if (!loop) return;
    loop.forEach((s, i) => {
      const li = document.createElement('li');
      const n = document.createElement('span'); n.className = 'nz-roadtrip-loop-stop-number'; n.style.background = dashboard.colors[0]; n.textContent = s.order;
      const p = document.createElement('span'); p.className = 'nz-roadtrip-loop-place'; p.textContent = s.place + ' · ' + s.spot;
      const sub = document.createElement('span'); sub.className = 'nz-roadtrip-loop-details';
      const drive = s.road_km_in ? (s.ferry_in ? 'ferry, then ' : '') + s.road_km_in + ' km in · ' : '';
      const when = i === 0 ? 'Pick-up ' + formatDay(s.arrive)
        : isDepot(s) ? 'Return ' + formatDay(s.arrive)
        : s.nights ? formatDay(s.arrive) + ' – ' + formatDay(s.depart) + ' · ' + s.nights + (s.nights === 1 ? ' night' : ' nights')
        : formatDay(s.arrive) + ' · a stop on the way, no night';
      sub.textContent = drive + when + (s.nights && s.fee ? ' · ' + s.fee : '');
      const h = document.createElement('span'); h.className = 'nz-roadtrip-loop-details'; h.textContent = s.highlights;
      li.append(n, p, sub, h); el.append(li);
    });
  });

  // ===== Cost breakdown =====
  dashboard.draw('nz_roadtrip_cost_breakdown', (el) => {
    el.replaceChildren();
    const d = dashboard.data('nz_roadtrip_totals'), s = dashboard.data('nz_roadtrip_settings');
    if (d.status !== 'ok' || s.status !== 'ok') return;
    const t = d.data.find((r) => r.version === pageState.version), set = s.data[0];
    const rows = [
      ['Van hire', t.hire_days + ' days × ' + formatNzd(set.van_nzd_per_day), t.van_nzd],
      ['Full Cover (no excess)', t.hire_days + ' days × ' + formatNzd(set.cover_nzd_per_day), t.cover_nzd],
      ['Diesel', d3.format(',')(t.road_km) + ' km × ' + set.fuel_litres_per_100km + ' L/100 km × NZ$' + set.diesel_nzd_per_litre, t.fuel_nzd],
      ['Campsites', t.nights + ' nights × ' + t.people + ' adults', t.campsite_nzd],
      ['Ferry Wellington → Picton', 'van and ' + t.people + ' passengers, estimate', t.ferry_nzd],
      ['Food', t.hire_days + ' days × ' + t.people + ' × ' + formatNzd(set.food_nzd_per_person_per_day), t.food_nzd],
    ];
    rows.forEach(([label, how, v]) => {
      const li = document.createElement('li');
      const a = document.createElement('span'); a.className = 'nz-roadtrip-cost-label'; a.textContent = label;
      const h = document.createElement('span'); h.className = 'nz-roadtrip-cost-how'; h.textContent = how;
      const b = document.createElement('span'); b.className = 'nz-roadtrip-cost-value'; b.textContent = formatNzd(v);
      li.append(a, b, h); el.append(li);
    });
    const li = document.createElement('li'); li.className = 'is-total';
    const a = document.createElement('span'); a.className = 'nz-roadtrip-cost-label'; a.textContent = 'Total for ' + t.people;
    const b = document.createElement('span'); b.className = 'nz-roadtrip-cost-value'; b.textContent = formatNzd(t.total_nzd);
    const h = document.createElement('span'); h.className = 'nz-roadtrip-cost-how'; h.textContent = formatNzd(t.per_person_nzd) + ' (about €' + d3.format(',')(Math.round(t.per_person_eur)) + ') per person';
    li.append(a, b, h); el.append(li);
  });
})();
