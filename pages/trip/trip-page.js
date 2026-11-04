// Trip page: the route story. Data: trip-route-stops.csv (one row per stop) and the world outlines.
// Draws: trip_world_map, trip_timeline, trip_stop_list (+ number_value elements in the chapters).
// A chapter is a <section class="trip-chapter" data-chapter="<chapter>" id="chapter-<chapter>"> in index.html
// whose data-chapter matches the "chapter" column of the CSV.
(function () {
  // ===== Data sources =====
  dashboard.registerDataSource('trip_route_stops', 'pages/trip/trip-route-stops.csv');
  dashboard.registerDataSource('world_country_outlines', 'pages/trip/world-country-outlines-do-not-edit.json');
  dashboard.registerDataSource('trip_disease_risk', 'pages/trip/trip-disease-risk.csv');
  dashboard.registerDataSource('trip_region_outlines', 'pages/trip/trip-region-outlines-do-not-edit.json');
  dashboard.registerDataSource('trip_climate_by_month', 'pages/trip/trip-climate-by-month.csv');

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
  const tripMapState = {chapter: 'all', view: null, animationFrame: 0, diseases: new Set(), climateOn: false, climateMonth: 1, paintClimate: null};
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

  // ===== Disease layers =====
  // Each disease has its own colour: darker = higher risk. `hatchAngle` keeps the "no data" hatching apart when layers overlap.
  const TRIP_DISEASES = [
    {id: 'rabies', label: 'Rabies', levels: {low: '#f2a39b', moderate: '#d64a3a', high: '#7d1a12'}, hatchAngle: 45,
      rule: 'Dark: human cases reported in the province. Mid: animal cases only (WOAH), or dogs commonly infected (US CDC). Light: dogs sometimes infected, or wildlife only. Human cases are under-reported, so a lighter region is not proof of safety.'},
    {id: 'dengue', label: 'Dengue', levels: {low: '#f7c27a', moderate: '#e08a1e', high: '#8a4b05'}, hatchAngle: -45,
      rule: 'Dark: above the HCSP endemic threshold of 100 per 100,000. Taiwan and Queensland are light because their cases are probably mostly imported.'},
    {id: 'chikungunya', label: 'Chikungunya', levels: {low: '#c9aee8', moderate: '#8a5cd1', high: '#43238a'}, hatchAngle: 0,
      rule: 'Dark: epidemic. Mid: active circulation in the previous 12 months (HCSP). Light: cases reported, local transmission not shown.'},
    {id: 'malaria', label: 'Malaria', levels: {low: '#8fd6c8', moderate: '#1f9c89', high: '#0b4f45'}, hatchAngle: 90,
      rule: 'HCSP high, moderate and low risk zones, US CDC transmission areas, and WHO district case counts.'},
  ];
  const RISK_LEVELS = ['low', 'moderate', 'high'];
  const riskRank = (level) => RISK_LEVELS.indexOf(level);
  // 90% for this year's data, 10% lighter per year of age, never below 40%.
  const opacityForDataYear = (year) => Math.max(0.4, 0.9 - 0.1 * Math.max(0, new Date().getFullYear() - year));
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // What one source says about a region: its row for that region if it has one, otherwise its row for the whole country.
  const rowsBySourceForRegion = (rows, region) => {
    const bySource = new Map();
    rows.forEach((r) => { if (r.region === region || (!r.region && !bySource.has(r.source))) bySource.set(r.source, r); });
    return [...bySource.values()];
  };
  // A region's state for one disease. The highest risk any source gives wins, even if another source disagrees.
  const diseaseStateForRegion = (rows, region) => {
    const sources = rowsBySourceForRegion(rows, region);
    const risky = sources.filter((r) => riskRank(r.level) >= 0).sort((a, b) => riskRank(b.level) - riskRank(a.level) || b.year - a.year);
    if (risky.length) return {state: 'risk', level: risky[0].level, year: risky[0].year, sources};
    return {state: sources.some((r) => r.level === 'none') ? 'none' : 'nodata', sources};
  };

  dashboard.calc('trip_disease_regions', {
    inputs: ['trip_disease_risk', 'trip_region_outlines', 'world_country_outlines'],
    title: 'Disease state of each region',
    description: 'One row per region on the map, with the state of each disease. Countries without province outlines are shown whole, and only for the diseases they have rows for.',
    fn: (risk, regions, countries) => {
      const rows = risk.map((r) => ({...r, year: +r.year}));
      const inRegionFile = new Set(regions.map((r) => r.country));
      const wholeCountries = countries.filter((c) => !inRegionFile.has(c.country) && rows.some((r) => r.country === c.country)).map((c) => ({country: c.country, region: '', d: c.d}));
      return [...regions, ...wholeCountries].map((f) => {
        const byDisease = {};
        TRIP_DISEASES.forEach(({id}) => {
          const own = rows.filter((r) => r.disease === id && r.country === f.country);
          if (own.length || inRegionFile.has(f.country)) byDisease[id] = diseaseStateForRegion(own, f.region);
        });
        return {...f, byDisease};
      });
    },
  });

  const tooltipLine = (text, secondary) => {
    const line = document.createElement('div'); line.textContent = text;
    if (secondary) line.className = 'chart-tooltip-secondary-line';
    return line;
  };
  const diseaseTooltipLines = (region) => {
    const lines = [tooltipLine(region.region ? region.region + ', ' + region.country : region.country)];
    TRIP_DISEASES.filter((d) => tripMapState.diseases.has(d.id) && region.byDisease[d.id]).forEach((d) => {
      const s = region.byDisease[d.id];
      lines.push(tooltipLine(d.label + ': ' + (s.state === 'risk' ? s.level + ' (' + s.year + ')' : s.state === 'none' ? 'none reported' : 'no data')));
      s.sources.filter((r) => r.source || r.note).forEach((r) => {
        const verdict = r.source ? r.source + (r.level === 'nodata' ? '' : ' [' + r.level + ', ' + r.year + ']') + (r.note ? ': ' : '') : '';
        lines.push(tooltipLine(verdict + r.note, true));
      });
    });
    return lines;
  };

  // The layer buttons turn on and off independently.
  document.querySelectorAll('.trip-disease-toggles button').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.disease, on = !tripMapState.diseases.has(id);
      if (on) tripMapState.diseases.add(id); else tripMapState.diseases.delete(id);
      button.setAttribute('aria-pressed', String(on));
      dashboard.draw('trip_world_map');
      dashboard.draw('trip_disease_legend');
    });
  });

  // ===== Best season layer =====
  const CLIMATE_LEVELS = [
    {label: 'Ideal', color: '#1a7a3e'}, {label: 'Good', color: '#7cc36b'}, {label: 'Mixed', color: '#f2d64b'},
    {label: 'Poor', color: '#ee9237'}, {label: 'Avoid', color: '#cf3226'},
  ];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  dashboard.calc('trip_climate_places', {
    inputs: ['trip_climate_by_month', 'trip_region_outlines', 'world_country_outlines'],
    title: 'Best season of each place',
    description: 'One row per place with its twelve months. Places with a lat and lon are drawn as a dot; the others use their country or region outline.',
    fn: (rows, regions, countries) => [...d3.group(rows, (r) => r.place).values()].map((own) => {
      const {place, country, region, lat, lon} = own[0];
      const outline = lat ? null : region ? regions.find((f) => f.country === country && f.region === region) : countries.find((f) => f.country === country);
      return {place, country, region, lat: +lat, lon: +lon, d: outline ? outline.d : null, months: Object.fromEntries(own.map((r) => [+r.month, r]))};
    }),
  });

  const climateLinesForPlace = (place) => {
    if (!tripMapState.climateOn || !place) return [];
    const r = place.months[tripMapState.climateMonth];
    const listed = r.on_best_list === 'yes' ? ', a listed best month' : r.on_best_list === 'no' ? ', not a listed best month' : '';
    return [
      tooltipLine(`${MONTH_NAMES[tripMapState.climateMonth - 1]} in ${place.place}: ${CLIMATE_LEVELS[+r.level].label}`),
      tooltipLine(`Où et Quand: ${r.temp_min}° to ${r.temp_max}°${listed}`, true),
      ...(r.weather ? [tooltipLine(r.weather, true)] : []),
      ...(r.plus ? [tooltipLine('+ ' + r.plus, true)] : []),
      ...(r.minus ? [tooltipLine('− ' + r.minus, true)] : []),
      ...(r.hazard_source ? [tooltipLine('Hazard source: ' + r.hazard_source, true)] : []),
    ];
  };
  // The place shown at a country or region on the map: a region's own place first, then its country's. Dots are found by their own hover.
  const climatePlaceAt = (country, region) => {
    const places = dashboard.data('trip_climate_places');
    if (places.status !== 'ok') return null;
    const areas = places.data.filter((p) => p.d && p.country === country);
    return areas.find((p) => p.region && p.region === region) || areas.find((p) => !p.region) || null;
  };

  const climateToggle = document.getElementById('trip-climate-toggle');
  const climateSlider = document.getElementById('trip-climate-month');
  const climateMonthName = document.getElementById('trip-climate-month-name');
  climateToggle.addEventListener('click', () => {
    tripMapState.climateOn = !tripMapState.climateOn;
    climateToggle.setAttribute('aria-pressed', String(tripMapState.climateOn));
    climateSlider.disabled = !tripMapState.climateOn;
    dashboard.draw('trip_world_map');
    dashboard.draw('trip_climate_legend');
  });
  // Moving the slider only recolours the layer, so dragging stays smooth.
  climateSlider.addEventListener('input', () => {
    tripMapState.climateMonth = +climateSlider.value;
    const name = MONTH_NAMES[tripMapState.climateMonth - 1];
    climateSlider.setAttribute('aria-valuetext', name);
    climateMonthName.textContent = name;
    if (tripMapState.paintClimate) tripMapState.paintClimate();
  });

  dashboard.draw('trip_climate_legend', (el) => {
    el.replaceChildren();
    if (!tripMapState.climateOn) return;
    const places = dashboard.data('trip_climate_places');
    if (places.status === 'error') { el.append(tooltipLine('The best season data failed to load.')); return; }
    const row = document.createElement('div'); row.className = 'trip-disease-legend-row';
    CLIMATE_LEVELS.forEach(({label, color}) => {
      const key = document.createElement('span'); key.className = 'trip-disease-legend-key';
      const swatch = document.createElement('i'); swatch.style.background = color;
      key.append(swatch, label); row.append(key);
    });
    const note = document.createElement('p');
    note.textContent = "Starts from Où et Quand's best months, then adjusted for measured heat, humidity and rain (2015–2024) and for typhoon, cyclone and smoke seasons. Figures are country-level averages, so conditions vary within a country. ";
    const link = document.createElement('a'); link.href = 'pages/trip/trip-climate-by-month.csv'; link.textContent = 'All months and sources';
    note.append(link, '.');
    el.append(row, note);
  });

  dashboard.draw('trip_disease_legend', (el) => {
    el.replaceChildren();
    const active = TRIP_DISEASES.filter((d) => tripMapState.diseases.has(d.id));
    if (!active.length) return;
    if (dashboard.data('trip_disease_regions').status === 'error') { el.append(tooltipLine('The disease data failed to load.')); return; }
    active.forEach((d) => {
      const row = document.createElement('div'); row.className = 'trip-disease-legend-row';
      const name = document.createElement('b'); name.textContent = d.label; row.append(name);
      RISK_LEVELS.forEach((level) => {
        const key = document.createElement('span'); key.className = 'trip-disease-legend-key';
        const swatch = document.createElement('i'); swatch.style.background = d.levels[level];
        key.append(swatch, capitalize(level)); row.append(key);
      });
      const key = document.createElement('span'); key.className = 'trip-disease-legend-key';
      const hatch = document.createElement('i');
      hatch.style.background = `repeating-linear-gradient(${d.hatchAngle + 90}deg, ${d.levels.moderate} 0 1px, transparent 1px 4px)`;
      key.append(hatch, 'No data'); row.append(key);
      const rule = document.createElement('p'); rule.textContent = d.rule; row.append(rule);
      el.append(row);
    });
    const note = document.createElement('p');
    const year = new Date().getFullYear();
    note.textContent = `Lighter = older data: ${year} at 90%, 10% less per year, 40% at the lightest. No colour: the sources report none. Where sources disagree, the highest risk is shown; hover a region for each source. Check with a travel clinic before relying on this. `;
    const link = document.createElement('a'); link.href = 'pages/trip/trip-disease-risk.csv'; link.textContent = 'All readings and sources';
    note.append(link, '.');
    el.append(note);
  });

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
    } else if (tripMapState.climateOn) {
      // At world scale Southeast Asia is lost under the stop dots, so the overview frames Asia-Pacific while this layer is on.
      fitPts = [];
      for (let lon = 92; lon <= 180; lon += 4) fitPts.push(projectWorldPoint(lon, 46), projectWorldPoint(lon, -48));
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
    const followPointerWithTip = (ev, lines) => {
      tip.replaceChildren(...lines); tip.hidden = false;
      const [x, y] = d3.pointer(ev, el);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = Math.max(4, Math.min(W - tw - 4, x + 12)) + 'px';
      tip.style.top = Math.max(4, y + th + 16 > H ? y - th - 12 : y + 12) + 'px';
    };
    // The best season layer sits directly on the land, so disease layers can still blend over it.
    const climatePlaces = dashboard.data('trip_climate_places');
    const shownClimatePlaces = tripMapState.climateOn && climatePlaces.status === 'ok' ? climatePlaces.data : [];
    const climateFill = (p) => CLIMATE_LEVELS[+p.months[tripMapState.climateMonth].level].color;
    const climateAreas = world.append('g').selectAll('path').data(shownClimatePlaces.filter((p) => p.d)).join('path')
      .attr('class', 'trip-map-climate-region').attr('d', (p) => p.d)
      .on('pointermove', (ev, p) => followPointerWithTip(ev, climateLinesForPlace(p)))
      .on('pointerleave', () => { tip.hidden = true; });
    tripMapState.paintClimate = () => {
      climateAreas.style('fill', climateFill);
      climateDots.style('fill', climateFill);
    };
    // Disease layers sit above the land and below the route. The hatching is redrawn at each zoom so it keeps its screen size.
    const activeDiseases = TRIP_DISEASES.filter((d) => tripMapState.diseases.has(d.id));
    const diseaseRegions = dashboard.data('trip_disease_regions');
    const showDiseases = activeDiseases.length > 0 && diseaseRegions.status === 'ok';
    const hatchPatterns = svg.append('defs').selectAll('pattern').data(showDiseases ? activeDiseases : []).join('pattern')
      .attr('id', (d) => 'trip-disease-hatch-' + d.id).attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6);
    hatchPatterns.append('line').attr('x1', 0).attr('y1', 3).attr('x2', 6).attr('y2', 3).attr('stroke-width', 1.2).style('stroke', (d) => d.levels.moderate);
    if (showDiseases) {
      const diseaseLayers = world.append('g').attr('class', 'trip-map-disease-layers');
      activeDiseases.forEach((disease) => {
        const shown = diseaseRegions.data.filter((f) => f.byDisease[disease.id] && f.byDisease[disease.id].state !== 'none');
        diseaseLayers.append('g').attr('class', 'trip-map-disease-layer').selectAll('path').data(shown).join('path').attr('class', 'trip-map-disease-region').attr('d', (f) => f.d)
          .style('fill', (f) => {
            const s = f.byDisease[disease.id];
            return s.state === 'risk' ? disease.levels[s.level] : `url(#trip-disease-hatch-${disease.id})`;
          })
          .style('fill-opacity', (f) => {
            const s = f.byDisease[disease.id];
            return s.state === 'risk' ? opacityForDataYear(s.year) : 1;
          });
      });
      world.append('g').selectAll('path').data(diseaseRegions.data.filter((f) => activeDiseases.some((d) => f.byDisease[d.id]))).join('path')
        .attr('class', 'trip-map-disease-hover-area').attr('d', (f) => f.d)
        .on('pointermove', (ev, f) => followPointerWithTip(ev, [...diseaseTooltipLines(f), ...climateLinesForPlace(climatePlaceAt(f.country, f.region))]))
        .on('pointerleave', () => { tip.hidden = true; });
    }
    // Islands too small to colour on the map (Koh Samui, Cebu) get a dot that keeps its size at every zoom.
    const climateDots = svg.append('g').selectAll('circle').data(shownClimatePlaces.filter((p) => !p.d)).join('circle')
      .attr('class', 'trip-map-climate-dot').attr('r', 6)
      .on('pointermove', (ev, p) => followPointerWithTip(ev, climateLinesForPlace(p)))
      .on('pointerleave', () => { tip.hidden = true; });
    tripMapState.paintClimate();
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
        tip.replaceChildren(t1, t2, ...(d.note ? [t3] : []), ...climateLinesForPlace(climatePlaceAt(d.country))); tip.hidden = false;
        const [x, y] = toScreen(d.lon, d.lat);
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        tip.style.left = Math.max(4, Math.min(W - tw - 4, x - tw / 2)) + 'px';
        tip.style.top = (y - th - 14 < 4 ? y + 14 : y - th - 14) + 'px';
      })
      .on('pointerleave', () => { tip.hidden = true; });

    const render = (v) => {
      view = v; tripMapState.view = v;
      world.attr('transform', `translate(${W / 2 - v.k * v.cx},${H / 2 - v.k * v.cy}) scale(${v.k})`);
      hatchPatterns.attr('patternTransform', (d) => `scale(${1 / v.k}) rotate(${d.hatchAngle})`);
      legPaths.attr('d', (d, i) => {
        let out = '', prev = null;
        legLines[i].forEach(([lo, la]) => {
          const r = longitudeRelativeTo90East(lo), [x, y] = toScreen(lo, la);
          out += (prev === null || Math.abs(r - prev) > 180 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
          prev = r;
        });
        return out;
      });
      climateDots.attr('cx', (p) => toScreen(p.lon, p.lat)[0]).attr('cy', (p) => toScreen(p.lon, p.lat)[1]);
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
