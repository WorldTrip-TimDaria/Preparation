// Trip page: the route story. Data: trip-route-stops.csv (one row per stop) and the world outlines.
// Draws: trip_world_map, trip_timeline, trip_stop_list (+ number_value elements in the chapters).
// A chapter is a <section class="trip-chapter" data-chapter="<chapter>" id="chapter-<chapter>"> in index.html
// whose data-chapter matches the "chapter" column of the CSV.
(function () {
  // ===== Data sources =====
  dashboard.registerDataSource('trip_route_stops', 'pages/trip/trip-route-stops.csv');
  dashboard.registerDataSource('world_country_outlines', 'pages/trip/world-country-outlines-do-not-edit.json');

  // ===== Calculations =====
  dashboard.calc('trip_stays_with_nights', {
    inputs: ['trip_route_stops'],
    title: 'Stops with nights',
    description: 'Each stop with its numbers read as numbers and the nights between arriving and leaving.',
    fn: (stops) => stops.map((r) => {
      const a = r.arrive ? Date.parse(r.arrive) : NaN, d = r.depart ? Date.parse(r.depart) : NaN;
      return {stop: +r.stop, city: r.city, country: r.country, chapter: r.chapter, lat: +r.lat, lon: +r.lon,
        arrive: r.arrive || null, depart: r.depart || null, nights: isNaN(a) || isNaN(d) ? 0 : Math.round((d - a) / 864e5),
        transport_in: r.transport_in || null, transport_eur: +r.transport_eur || 0, daily_eur: +r.daily_eur || 0, status: r.status, optional: r.optional === 'yes', note: r.note || '', paid_expense: (r.paid_expense || '').toLowerCase()};
    }).sort((x, y) => x.stop - y.stop)
  });

  dashboard.calc('trip_travel_legs', {
    inputs: ['trip_stays_with_nights'],
    title: 'Legs between stops',
    description: 'Each leg of the main route (optional stops skipped), plus the detour legs to and from each optional stop, with great-circle km and transport cost.',
    fn: (stays) => {
      const rad = Math.PI / 180;
      const km = (a, b) => {
        const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
        return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
      };
      const leg = (a, b, chapter, cost, optional) => ({from: a.city, to: b.city, chapter, mode: b.transport_in, km: km(a, b), transport_eur: cost, optional,
        from_lat: a.lat, from_lon: a.lon, to_lat: b.lat, to_lon: b.lon});
      const main = stays.filter((s) => !s.optional);
      const out = main.slice(1).map((b, i) => leg(main[i], b, b.chapter, b.transport_eur, false));
      stays.forEach((o, i) => {
        if (!o.optional) return;
        const prev = stays.slice(0, i).reverse().find((s) => !s.optional), next = stays.slice(i + 1).find((s) => !s.optional);
        if (prev) out.push(leg(prev, o, o.chapter, o.transport_eur, true));
        if (next) out.push(leg(o, next, o.chapter, 0, true));
      });
      return out;
    }
  });

  dashboard.calc('trip_totals_by_chapter', {
    inputs: ['trip_stays_with_nights', 'trip_travel_legs'],
    title: 'Totals per region',
    description: 'Nights, distance and cost per region; a leg counts toward the region it arrives in, and a detour to an optional stop toward that stop.',
    fn: (stays, legs) => [...new Set(stays.map((s) => s.chapter))].map((chapter) => {
      const ss = stays.filter((s) => s.chapter === chapter), ll = legs.filter((l) => l.chapter === chapter);
      const transport_eur = ll.reduce((t, l) => t + l.transport_eur, 0), stay_eur = ss.reduce((t, s) => t + s.nights * s.daily_eur, 0);
      return {chapter, optional: ss.every((s) => s.optional), nights: ss.reduce((t, s) => t + s.nights, 0), km: ll.reduce((t, l) => t + l.km, 0),
        transport_eur, stay_eur, budget: transport_eur + stay_eur};
    })
  });

  dashboard.calc('trip_overall_totals', {
    inputs: ['trip_stays_with_nights', 'trip_totals_by_chapter'],
    title: 'Whole-trip totals',
    description: 'The main route: days from leaving the first stop to leaving the last (or reaching it, with no end date), countries after the start, summed distance and cost; optional stops counted apart.',
    fn: (stays, by_chapter) => {
      const first = stays[0], last = stays[stays.length - 1];
      const main = by_chapter.filter((c) => !c.optional), opt = by_chapter.filter((c) => c.optional);
      const transport_eur = main.reduce((t, c) => t + c.transport_eur, 0), stay_eur = main.reduce((t, c) => t + c.stay_eur, 0);
      return [{days: Math.round((Date.parse(last.depart || last.arrive) - Date.parse(first.depart)) / 864e5),
        countries: new Set(stays.slice(1).filter((s) => !s.optional).map((s) => s.country)).size,
        km: main.reduce((t, c) => t + c.km, 0), transport_eur, stay_eur, budget: transport_eur + stay_eur,
        transport_share: transport_eur / (transport_eur + stay_eur),
        optional_nights: opt.reduce((t, c) => t + c.nights, 0), optional_budget: opt.reduce((t, c) => t + c.budget, 0)}];
    }
  });

  // ===== Shared state and formats =====
  // Which chapter is on screen ('all' = route overview, 'totals' = money chapter), and the map's current view.
  const tripMapState = {chapter: 'all', view: null, animationFrame: 0};
  const formatDayMonth = d3.utcFormat('%-d %b');
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.querySelectorAll('.trip-legend-swatch-flight').forEach((e) => { e.style.stroke = dashboard.colors[0]; });
  document.querySelectorAll('.trip-legend-swatch-train-or-bus').forEach((e) => { e.style.stroke = dashboard.colors[1]; });
  document.querySelectorAll('.trip-legend-swatch-optional-detour').forEach((e) => { e.style.stroke = 'var(--color-success)'; });

  // ===== Stop list under each chapter =====
  dashboard.draw('trip_stop_list', (el) => {
    const d = dashboard.data('trip_stays_with_nights');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.filter((s) => s.chapter === el.dataset.chapter).forEach((s) => {
      const li = document.createElement('li');
      const city = document.createElement('span'); city.className = 'trip-stop-city'; city.textContent = s.city;
      const when = document.createElement('span'); when.className = 'trip-stop-dates';
      when.textContent = (s.arrive ? formatDayMonth(new Date(s.arrive)) : '') + (s.depart ? ' – ' + formatDayMonth(new Date(s.depart)) : '') + (s.nights ? ' · ' + s.nights + ' nights' : '');
      const tag = document.createElement('span'); tag.className = 'trip-stop-status-tag is-' + String(s.status).replace(/\s+/g, '-'); tag.textContent = s.status;
      li.append(city, when, tag);
      if (s.note) { const n = document.createElement('span'); n.className = 'trip-stop-note'; n.textContent = s.note; li.append(n); }
      el.append(li);
    });
  });

  // ===== World map =====
  // Natural Earth projection centred on 90°E, in the same units as the pre-projected country outlines (y points down).
  const DEGREES_TO_RADIANS = Math.PI / 180, PROJECTION_UNIT = 1000;
  const longitudeRelativeTo90East = (lon) => ((lon - 90 + 540) % 360) - 180;
  const naturalEarthProjection = (lr, lat) => {
    const l = lr * DEGREES_TO_RADIANS, p = lat * DEGREES_TO_RADIANS, p2 = p * p, p4 = p2 * p2;
    return [PROJECTION_UNIT * l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
      -PROJECTION_UNIT * p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))];
  };
  const projectWorldPoint = (lon, lat) => naturalEarthProjection(longitudeRelativeTo90East(lon), lat);
  const worldOutlinePoints = [];
  for (let lat = 90; lat >= -90; lat -= 2) worldOutlinePoints.push(naturalEarthProjection(180, lat));
  for (let lat = -90; lat <= 90; lat += 2) worldOutlinePoints.push(naturalEarthProjection(-180, lat));
  const worldOutlinePath = 'M' + worldOutlinePoints.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
  const greatCirclePoints = (lon1, lat1, lon2, lat2, n) => {
    const v = (lo, la) => [Math.cos(la * DEGREES_TO_RADIANS) * Math.cos(lo * DEGREES_TO_RADIANS), Math.cos(la * DEGREES_TO_RADIANS) * Math.sin(lo * DEGREES_TO_RADIANS), Math.sin(la * DEGREES_TO_RADIANS)];
    const a = v(lon1, lat1), b = v(lon2, lat2);
    const w = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
    if (w < 1e-9) return [[lon1, lat1], [lon2, lat2]];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
      const x = s1 * a[0] + s2 * b[0], y = s1 * a[1] + s2 * b[1], z = s1 * a[2] + s2 * b[2];
      out.push([Math.atan2(y, x) / DEGREES_TO_RADIANS, Math.asin(z) / DEGREES_TO_RADIANS]);
    }
    return out;
  };
  const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  dashboard.draw('trip_world_map', (el) => {
    if (tripMapState.animationFrame) { cancelAnimationFrame(tripMapState.animationFrame); tripMapState.animationFrame = 0; }
    el.replaceChildren();
    const c = dashboard.data('world_country_outlines'), s = dashboard.data('trip_stays_with_nights'), l = dashboard.data('trip_travel_legs');
    const all = [c, s, l];
    if (all.some((d) => d.status === 'error' || d.status === 'missing' || d.status === 'declined')) {
      el.classList.remove('loading-skeleton');
      const f = document.createElement('div'); f.className = 'load-failure-message'; f.textContent = 'Failed to load'; el.append(f);
      return;
    }
    if (all.some((d) => d.status !== 'ok')) { el.classList.add('loading-skeleton'); return; }
    el.classList.remove('loading-skeleton');
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;

    const stops = s.data, legs = l.data;
    const focus = tripMapState.chapter === 'all' || tripMapState.chapter === 'totals' ? null : tripMapState.chapter;
    const visited = new Set(stops.filter((d) => d.stop > 0 && !d.optional).map((d) => d.country));
    const focusCountries = new Set(stops.filter((d) => d.chapter === focus).map((d) => d.country));
    const isOn = (chapter) => !focus || chapter === focus;
    const modeColor = (m) => m === 'train' || m === 'bus' ? dashboard.colors[1] : dashboard.colors[0];

    // The view: zoom k and the centre (in projected units) to frame the focused region, or the whole world.
    let fitPts = worldOutlinePoints;
    if (focus) {
      const pts = stops.filter((d) => d.chapter === focus);
      const m = pts.length === 1 ? 8 : 1.5 + 0.15 * Math.max(d3.max(pts, (d) => d.lat) - d3.min(pts, (d) => d.lat), d3.max(pts, (d) => d.lon) - d3.min(pts, (d) => d.lon));
      const lo0 = d3.min(pts, (d) => d.lon) - m, lo1 = d3.max(pts, (d) => d.lon) + m;
      const la0 = d3.min(pts, (d) => d.lat) - m, la1 = d3.max(pts, (d) => d.lat) + m;
      fitPts = [];
      for (let i = 0; i <= 8; i++) {
        const lo = lo0 + (lo1 - lo0) * i / 8, la = la0 + (la1 - la0) * i / 8;
        fitPts.push(projectWorldPoint(lo, la0), projectWorldPoint(lo, la1), projectWorldPoint(lo0, la), projectWorldPoint(lo1, la));
      }
    }
    const x0 = d3.min(fitPts, (p) => p[0]), x1 = d3.max(fitPts, (p) => p[0]);
    const y0 = d3.min(fitPts, (p) => p[1]), y1 = d3.max(fitPts, (p) => p[1]);
    const pad = Math.min(W, H) * 0.06;
    const target = {k: Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0)), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, W, H};
    const from = tripMapState.view && tripMapState.view.W === W && tripMapState.view.H === H ? tripMapState.view : target;

    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', 'Map of the trip route');
    const world = svg.append('g');
    world.append('path').attr('class', 'trip-map-ocean').attr('d', worldOutlinePath);
    world.append('g').selectAll('path').data(c.data).join('path')
      .attr('class', (d) => 'trip-map-land' + (visited.has(d.country) ? ' is-visited' : '') + (focusCountries.has(d.country) ? ' is-focus' : ''))
      .attr('d', (d) => d.d)
      .style('fill', (d) => visited.has(d.country) ? dashboard.colors[0] : null);
    const legPaths = svg.append('g').selectAll('path').data(legs).join('path')
      .attr('class', (d) => 'trip-map-leg is-' + d.mode + (d.optional ? ' is-optional' : '') + (isOn(d.chapter) ? '' : ' is-off'))
      .style('stroke', (d) => d.optional ? 'var(--color-success)' : isOn(d.chapter) ? modeColor(d.mode) : null);
    const legLines = legs.map((d) => greatCirclePoints(d.from_lon, d.from_lat, d.to_lon, d.to_lat, 64));
    const dots = svg.append('g').selectAll('circle').data(stops).join('circle')
      .attr('class', (d) => 'trip-map-stop-dot' + (d.optional ? ' is-optional' : '')).attr('r', (d) => focus && d.chapter === focus ? 5 : 3.5)
      .style('stroke', (d) => d.optional ? 'var(--color-success)' : isOn(d.chapter) ? 'var(--color-text)' : null);
    const labelled = stops.filter((d, i) => focus ? d.chapter === focus : i === 0 || i === 1 || i === stops.length - 1);
    const labels = svg.append('g').selectAll('text').data(labelled).join('text')
      .attr('class', 'trip-map-city-label').attr('dy', '-0.75em').attr('text-anchor', 'middle').text((d) => d.city);

    let view = from;
    const toScreen = (lon, lat) => { const p = projectWorldPoint(lon, lat); return [W / 2 + view.k * (p[0] - view.cx), H / 2 + view.k * (p[1] - view.cy)]; };

    const tip = document.createElement('div'); tip.className = 'chart-tooltip'; tip.hidden = true; el.append(tip);
    const hits = svg.append('g').selectAll('circle').data(stops).join('circle').attr('class', 'trip-map-stop-hover-area').attr('r', 11)
      .on('pointerenter', (ev, d) => {
        const t1 = document.createElement('div'); t1.textContent = d.city + ', ' + d.country;
        const t2 = document.createElement('div'); t2.className = 'chart-tooltip-secondary-line';
        t2.textContent = (d.arrive ? formatDayMonth(new Date(d.arrive)) : 'Start') + ' – ' + (d.depart ? formatDayMonth(new Date(d.depart)) : 'End') + (d.nights ? ' · ' + d.nights + ' nights' : '') + ' · ' + d.status;
        const t3 = document.createElement('div'); t3.className = 'chart-tooltip-secondary-line'; t3.textContent = d.note || '';
        tip.replaceChildren(t1, t2, ...(d.note ? [t3] : [])); tip.hidden = false;
        const [x, y] = toScreen(d.lon, d.lat);
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(4, Math.min(W - tw - 4, x - tw / 2)) + 'px';
        tip.style.top = (y - th - 14 < 4 ? y + 14 : y - th - 14) + 'px';
      })
      .on('pointerleave', () => { tip.hidden = true; });

    const render = (v) => {
      view = v; tripMapState.view = v;
      world.attr('transform', `translate(${W / 2 - v.k * v.cx},${H / 2 - v.k * v.cy}) scale(${v.k})`);
      legPaths.attr('d', (d, i) => {
        let out = '', prev = null;
        legLines[i].forEach(([lo, la]) => {
          const r = longitudeRelativeTo90East(lo), [x, y] = toScreen(lo, la);
          out += (prev === null || Math.abs(r - prev) > 180 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
          prev = r;
        });
        return out;
      });
      dots.attr('cx', (d) => toScreen(d.lon, d.lat)[0]).attr('cy', (d) => toScreen(d.lon, d.lat)[1]);
      hits.attr('cx', (d) => toScreen(d.lon, d.lat)[0]).attr('cy', (d) => toScreen(d.lon, d.lat)[1]);
      labels.attr('x', (d) => toScreen(d.lon, d.lat)[0]).attr('y', (d) => toScreen(d.lon, d.lat)[1]);
    };

    const same = Math.abs(from.k - target.k) / target.k < 0.005 && Math.abs(from.cx - target.cx) < 1 && Math.abs(from.cy - target.cy) < 1;
    if (same || prefersReducedMotion) { render(target); return; }
    render(from);
    const start = performance.now(), lk0 = Math.log(from.k), lk1 = Math.log(target.k);
    const step = (now) => {
      const t = Math.min(1, (now - start) / 900), e = easeInOutCubic(t);
      render({k: Math.exp(lk0 + (lk1 - lk0) * e), cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e, W, H});
      tripMapState.animationFrame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    tripMapState.animationFrame = requestAnimationFrame(step);
  });

  // ===== Timeline =====
  // Timeline: one segment per country, sized by its dates, from the first departure to the last day.
  const scrollToChapter = (ch) => {
    const el = document.getElementById(ch === 'start' ? 'chapter-route-overview' : 'chapter-' + ch);
    if (el) el.scrollIntoView({behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center'});
  };
  dashboard.draw('trip_timeline', (el) => {
    el.replaceChildren();
    const s = dashboard.data('trip_stays_with_nights');
    if (s.status !== 'ok') return;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const stops = s.data;
    const day = (v) => new Date(v + 'T00:00:00Z');
    const first = stops[0], last = stops[stops.length - 1];
    const t0 = day(first.depart), t1 = day(last.depart || last.arrive);
    const segs = [...new Set(stops.filter((d) => d.chapter !== 'start').map((d) => d.chapter))].map((chapter) => {
      const ss = stops.filter((d) => d.chapter === chapter);
      const a = d3.min(ss, (d) => day(d.arrive)), b = d3.max(ss, (d) => day(d.depart || d.arrive));
      return {chapter, country: ss[0].country, optional: ss.every((d) => d.optional), a, b};
    });
    const cur = tripMapState.chapter;
    const lit = (g) => cur === 'all' || cur === 'totals' || g.chapter === cur;
    const fmt = d3.utcFormat('%-d %b');
    const horizontal = el.dataset.orient === 'h';
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', 'Trip timeline from ' + first.city + ' to ' + last.country);
    const main = segs.filter((g) => !g.optional), opt = segs.filter((g) => g.optional);

    if (!horizontal) {
      const y = d3.scaleUtc([t0, t1], [10, H - 10]);
      const x = 14;
      svg.append('line').attr('class', 'trip-timeline-axis').attr('x1', x).attr('x2', x).attr('y1', y(t0)).attr('y2', y(t1));
      const ends = [[first, t0, first.city], [last, t1, last.country]];
      ends.forEach(([d, tt, name], i) => {
        svg.append('circle').attr('cx', x).attr('cy', y(tt)).attr('r', 4).style('fill', 'var(--color-panel)').style('stroke', 'var(--color-text)').style('stroke-width', 2);
      });
      const g = svg.append('g').selectAll('g').data(main).join('g').attr('class', 'trip-timeline-segment')
        .on('click', (ev, d) => scrollToChapter(d.chapter));
      g.append('rect').attr('x', x - 4).attr('width', 8).attr('y', (d) => y(d.a) + 1).attr('height', (d) => Math.max(2, y(d.b) - y(d.a) - 2)).attr('rx', 3)
        .style('fill', (d) => lit(d) ? dashboard.colors[0] : 'var(--color-chart-muted)').style('opacity', (d) => lit(d) ? 1 : 0.5);
      g.append('rect').attr('x', 0).attr('width', W).attr('y', (d) => y(d.a)).attr('height', (d) => Math.max(2, y(d.b) - y(d.a))).style('fill', 'transparent');
      const mid = (d) => (y(d.a) + y(d.b)) / 2;
      g.append('text').attr('class', (d) => 'trip-timeline-country-name' + (lit(d) && cur !== 'all' && cur !== 'totals' ? ' is-on' : '')).attr('x', x + 12).attr('y', (d) => mid(d) - 2).text((d) => d.country);
      g.append('text').attr('class', 'trip-timeline-dates').attr('x', x + 12).attr('y', (d) => mid(d) + 11).text((d) => fmt(d.a) + ' – ' + fmt(d.b));
      const og = svg.append('g').selectAll('g').data(opt).join('g').attr('class', 'trip-timeline-segment').on('click', (ev, d) => scrollToChapter(d.chapter));
      og.append('rect').attr('x', x - 13).attr('width', 4).attr('y', (d) => y(d.a) + 1).attr('height', (d) => Math.max(2, y(d.b) - y(d.a) - 2)).attr('rx', 2)
        .style('fill', 'var(--color-success)').style('opacity', (d) => d.chapter === cur || cur === 'all' || cur === 'totals' ? 1 : 0.55);
      svg.append('text').attr('class', 'trip-timeline-dates').attr('x', x + 12).attr('y', y(t0) + 4).text(first.city.replace(/ \(.*\)/, '') + ' · ' + fmt(t0));
      svg.append('text').attr('class', 'trip-timeline-dates').attr('x', x + 12).attr('y', y(t1) + 4).text('End · ' + fmt(t1));
      if (cur !== 'all' && cur !== 'totals') {
        const c = segs.find((d) => d.chapter === cur);
        if (c) svg.append('circle').attr('cx', c.optional ? x - 11 : x).attr('cy', mid(c)).attr('r', 6).style('fill', 'var(--color-panel)').style('stroke', c.optional ? 'var(--color-success)' : dashboard.colors[0]).style('stroke-width', 3);
      }
      // Keep labels from meeting: hide a segment's date line when the segment is short.
      g.selectAll('.trip-timeline-dates').style('display', (d) => y(d.b) - y(d.a) < 30 ? 'none' : null);
      g.selectAll('.trip-timeline-country-name').style('display', (d) => y(d.b) - y(d.a) < 14 ? 'none' : null);
    } else {
      const x = d3.scaleUtc([t0, t1], [4, W - 4]);
      const g = svg.append('g').selectAll('g').data(main).join('g').attr('class', 'trip-timeline-segment').on('click', (ev, d) => scrollToChapter(d.chapter));
      g.append('rect').attr('y', 8).attr('height', 8).attr('x', (d) => x(d.a) + 1).attr('width', (d) => Math.max(2, x(d.b) - x(d.a) - 2)).attr('rx', 3)
        .style('fill', (d) => lit(d) ? dashboard.colors[0] : 'var(--color-chart-muted)').style('opacity', (d) => lit(d) ? 1 : 0.5);
      svg.append('g').selectAll('rect').data(opt).join('rect').attr('y', 1).attr('height', 4).attr('x', (d) => x(d.a) + 1).attr('width', (d) => Math.max(2, x(d.b) - x(d.a) - 2)).attr('rx', 2)
        .style('fill', 'var(--color-success)');
      const c = segs.find((d) => d.chapter === cur);
      const label = c ? c.country + ' · ' + fmt(c.a) + ' – ' + fmt(c.b) : first.city.replace(/ \(.*\)/, '') + ' ' + fmt(t0) + ' → ' + last.country + ' ' + fmt(t1);
      const lx = c ? Math.min(Math.max(4, (x(c.a) + x(c.b)) / 2), W - 4) : W / 2;
      const txt = svg.append('text').attr('class', 'trip-timeline-country-name is-on').attr('y', 34).attr('x', lx).attr('text-anchor', 'middle').text(label);
      const tw = txt.node().getComputedTextLength();
      txt.attr('x', Math.min(Math.max(tw / 2 + 2, lx), W - tw / 2 - 2));
    }
  });

  // ===== Chapter scroll tracking: the chapter in the middle of the screen drives the map and timeline =====
  const tripChapterSections = document.querySelectorAll('.trip-chapter');
  const chapterVisibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const ch = en.target.dataset.chapter;
      tripChapterSections.forEach((s) => s.classList.toggle('is-active', s === en.target));
      if (tripMapState.chapter !== ch) { tripMapState.chapter = ch; dashboard.draw('trip_world_map'); dashboard.draw('trip_timeline'); }
    });
  }, {root: document, rootMargin: '-45% 0px -45% 0px'});
  tripChapterSections.forEach((s) => chapterVisibilityObserver.observe(s));
})();
