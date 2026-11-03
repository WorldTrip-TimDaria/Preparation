// Storage box page: storage boxes in Belgium compared by size and 12-month cost.
// Data: storage-box-comparison.json, written from storage_boxes_belgium.xlsx by convert-excel-to-json.py.
// The measure buttons (volume / floor area) and the size-range buttons filter the tiles, the chart and the table.
(function () {
  // ===== Data sources =====
  const STORAGE_BOX_DATA_FILE = 'pages/storage_box/storage-box-comparison.json';
  dashboard.registerDataSource('storage_box_options', STORAGE_BOX_DATA_FILE, 'boxes');
  dashboard.registerDataSource('storage_box_open_points', STORAGE_BOX_DATA_FILE, 'open_points');
  dashboard.registerDataSource('storage_box_read_me', STORAGE_BOX_DATA_FILE, 'read_me');

  // ===== Size ranges: edit here. A range [low, high] holds sizes above low and up to high. =====
  const SIZE_MEASURES = {
    volume: {sizeField: 'volume_m3', unitPriceField: 'price_per_m3_per_month', unit: 'm³', name: 'volume',
      ranges: [[0, 10], [10, 15], [15, 20], [20, 30], [30, Infinity]], defaultRangeIndex: 1},
    floor_area: {sizeField: 'floor_area_m2', unitPriceField: 'price_per_m2_per_month', unit: 'm²', name: 'floor area',
      ranges: [[0, 4], [4, 6], [6, 8], [8, 10], [10, Infinity]], defaultRangeIndex: 2},
  };
  const ALL_SIZES = 'all';

  // ===== Calculations =====
  dashboard.calc('storage_box_options_with_unit_prices', {
    inputs: ['storage_box_options'],
    title: 'Storage boxes with prices per m³ and per m²',
    description: 'Each priced box with its monthly cost per m³ and per m² (12-month total ÷ 12 ÷ size), when the size is known.',
    fn: (options) => options.map((box) => ({...box,
      price_per_m3_per_month: box.volume_m3 ? box.total_12_months_eur / 12 / box.volume_m3 : null,
      price_per_m2_per_month: box.floor_area_m2 ? box.total_12_months_eur / 12 / box.floor_area_m2 : null}))
  });
  dashboard.calc('storage_box_totals', {
    inputs: ['storage_box_options'],
    title: 'Storage box counts',
    description: 'Number of priced boxes and of companies.',
    fn: (options) => [{box_count: options.length, brand_count: new Set(options.map((box) => box.brand)).size}]
  });

  // ===== Page state: chosen measure, size range and table sort =====
  const storageBoxState = {measure: 'volume', rangeIndex: SIZE_MEASURES.volume.defaultRangeIndex, sortField: 'total_12_months_eur', sortAscending: true};
  const currentMeasure = () => SIZE_MEASURES[storageBoxState.measure];
  const isInRange = (size, [low, high]) => size != null && size > low && size <= high;
  const formatSize = (value) => d3.format(',.1~f')(value);
  const formatEuros = (value) => '€' + d3.format(Number.isInteger(value) ? ',' : ',.2f')(value);
  const formatUnitPrice = (value) => '€' + d3.format(',.2f')(value);
  const rangeLabel = ([low, high], unit) => low === 0 ? '≤ ' + high + ' ' + unit : high === Infinity ? '> ' + low + ' ' + unit : low + '–' + high + ' ' + unit;
  const selectedRangeLabel = () => storageBoxState.rangeIndex === ALL_SIZES
    ? 'all sizes' : rangeLabel(currentMeasure().ranges[storageBoxState.rangeIndex], currentMeasure().unit);
  // The boxes shown in the tiles and table: in the chosen range, or every box for "All".
  const selectedBoxes = (boxes) => storageBoxState.rangeIndex === ALL_SIZES
    ? boxes : boxes.filter((box) => isInRange(box[currentMeasure().sizeField], currentMeasure().ranges[storageBoxState.rangeIndex]));
  // One chart colour per company, in the order the companies first appear in the Excel.
  const brandColor = (brand, boxes) => {
    const brands = [...new Set(boxes.map((box) => box.brand))];
    return dashboard.colors[brands.indexOf(brand) % dashboard.colors.length];
  };
  const brandDot = (color) => { const dot = document.createElement('span'); dot.className = 'storage-box-brand-dot'; dot.style.background = color; return dot; };

  const STORAGE_BOX_VIEWS = ['storage_box_size_range_buttons', 'storage_box_selected_range_label', 'storage_box_best_value_tiles',
    'storage_box_cost_chart', 'storage_box_missing_size_note', 'storage_box_comparison_table'];
  const redrawStorageBoxViews = () => STORAGE_BOX_VIEWS.forEach((name) => dashboard.draw(name));

  document.querySelectorAll('[data-storage-box-measure]').forEach((button) => button.addEventListener('click', () => {
    storageBoxState.measure = button.dataset.storageBoxMeasure;
    storageBoxState.rangeIndex = currentMeasure().defaultRangeIndex;
    document.querySelectorAll('[data-storage-box-measure]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    redrawStorageBoxViews();
  }));

  // ===== Size-range buttons, with the number of boxes in each range =====
  dashboard.draw('storage_box_size_range_buttons', (el) => {
    const d = dashboard.data('storage_box_options_with_unit_prices');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    const measure = currentMeasure();
    const choices = measure.ranges.map((range, index) => ({index, label: rangeLabel(range, measure.unit),
      count: d.data.filter((box) => isInRange(box[measure.sizeField], range)).length}));
    choices.push({index: ALL_SIZES, label: 'All', count: d.data.length});
    choices.forEach((choice) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label + ' (' + choice.count + ')';
      button.setAttribute('aria-pressed', String(choice.index === storageBoxState.rangeIndex));
      button.addEventListener('click', () => { storageBoxState.rangeIndex = choice.index; redrawStorageBoxViews(); });
      el.append(button);
    });
  });

  dashboard.draw('storage_box_selected_range_label', (el) => { el.textContent = selectedRangeLabel(); });

  // ===== Best value: the three lowest 12-month totals in the chosen range =====
  dashboard.draw('storage_box_best_value_tiles', (el) => {
    const d = dashboard.data('storage_box_options_with_unit_prices');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    const measure = currentMeasure();
    const cheapest = selectedBoxes(d.data).slice().sort((a, b) => a.total_12_months_eur - b.total_12_months_eur).slice(0, 3);
    if (!cheapest.length) {
      const empty = document.createElement('p'); empty.className = 'card-note'; empty.textContent = 'No box in this size range.'; el.append(empty);
      return;
    }
    cheapest.forEach((box) => {
      const tile = document.createElement('div'); tile.className = 'stat-tile';
      const label = document.createElement('p'); label.className = 'stat-tile-label';
      label.append(brandDot(brandColor(box.brand, d.data)), box.brand + ' · ' + box.location);
      const value = document.createElement('p'); value.className = 'stat-tile-value'; value.textContent = formatEuros(box.total_12_months_eur);
      const details = document.createElement('p'); details.className = 'storage-box-tile-details';
      const size = box[measure.sizeField] != null ? formatSize(box[measure.sizeField]) + ' ' + measure.unit : box.box;
      details.textContent = 'for 12 months · ' + size + ' · ' + formatEuros(box.monthly_eur) + '/month'
        + (box[measure.unitPriceField] != null ? ' · ' + formatUnitPrice(box[measure.unitPriceField]) + ' per ' + measure.unit + ' per month' : '');
      tile.append(label, value, details);
      el.append(tile);
    });
  });

  // ===== Chart: 12-month cost against size, one colour and line per company =====
  dashboard.draw('storage_box_cost_chart', (el) => {
    el.replaceChildren();
    const d = dashboard.data('storage_box_options_with_unit_prices');
    if (d.status === 'error' || d.status === 'missing') {
      el.classList.remove('loading-skeleton');
      const failure = document.createElement('div'); failure.className = 'load-failure-message'; failure.textContent = 'Failed to load'; el.append(failure);
      return;
    }
    if (d.status !== 'ok') { el.classList.add('loading-skeleton'); return; }
    el.classList.remove('loading-skeleton');
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const measure = currentMeasure();
    const boxes = d.data.filter((box) => box[measure.sizeField] != null);
    const range = storageBoxState.rangeIndex === ALL_SIZES ? null : measure.ranges[storageBoxState.rangeIndex];
    const isHighlighted = (box) => !range || isInRange(box[measure.sizeField], range);
    const margin = {top: 10, right: 12, bottom: 38, left: 56};
    const x = d3.scaleLinear([0, d3.max(boxes, (box) => box[measure.sizeField]) * 1.05], [margin.left, W - margin.right]).nice();
    const y = d3.scaleLinear([0, d3.max(boxes, (box) => box.total_12_months_eur) * 1.08], [H - margin.bottom, margin.top]).nice();
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img').attr('aria-label', '12-month cost of each storage box against its ' + measure.name);
    if (range) {
      const [low, high] = range;
      svg.append('rect').attr('class', 'storage-box-chart-selected-range')
        .attr('x', x(low)).attr('width', Math.max(0, x(Math.min(high, x.domain()[1])) - x(low)))
        .attr('y', margin.top).attr('height', H - margin.top - margin.bottom);
    }
    svg.append('g').attr('class', 'storage-box-chart-axis').attr('transform', `translate(0,${H - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(Math.max(2, Math.floor(W / 80))));
    svg.append('g').attr('class', 'storage-box-chart-axis').attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((value) => '€' + d3.format(',')(value)));
    svg.append('text').attr('class', 'storage-box-chart-axis-title').attr('x', W - margin.right).attr('y', H - 4).attr('text-anchor', 'end')
      .text(measure.name[0].toUpperCase() + measure.name.slice(1) + ' (' + measure.unit + ')');
    svg.append('text').attr('class', 'storage-box-chart-axis-title').attr('x', margin.left + 4).attr('y', margin.top + 4).attr('dominant-baseline', 'hanging')
      .text('12-month total');

    const byBrand = d3.groups(boxes, (box) => box.brand);
    const line = d3.line((box) => x(box[measure.sizeField]), (box) => y(box.total_12_months_eur));
    svg.append('g').selectAll('path').data(byBrand).join('path').attr('class', 'storage-box-chart-brand-line')
      .attr('d', ([, brandBoxes]) => line(brandBoxes.slice().sort((a, b) => a[measure.sizeField] - b[measure.sizeField] || a.total_12_months_eur - b.total_12_months_eur)))
      .style('stroke', ([brand]) => brandColor(brand, d.data))
      .style('opacity', ([, brandBoxes]) => brandBoxes.some(isHighlighted) ? 0.7 : 0.15);
    svg.append('g').selectAll('circle').data(boxes).join('circle').attr('class', 'storage-box-chart-dot').attr('r', 5)
      .attr('cx', (box) => x(box[measure.sizeField])).attr('cy', (box) => y(box.total_12_months_eur))
      .style('fill', (box) => brandColor(box.brand, d.data)).style('opacity', (box) => isHighlighted(box) ? 1 : 0.2);

    const tooltip = document.createElement('div'); tooltip.className = 'chart-tooltip'; tooltip.hidden = true; el.append(tooltip);
    svg.append('g').selectAll('circle').data(boxes).join('circle').attr('r', 11).style('fill', 'transparent')
      .attr('cx', (box) => x(box[measure.sizeField])).attr('cy', (box) => y(box.total_12_months_eur))
      .on('pointermove', (event, box) => {
        const lines = [box.brand + ' · ' + box.location, box.box,
          formatEuros(box.total_12_months_eur) + ' for 12 months · ' + formatEuros(box.monthly_eur) + '/month',
          formatUnitPrice(box[measure.unitPriceField]) + ' per ' + measure.unit + ' per month'];
        tooltip.replaceChildren(...lines.map((text, index) => {
          const row = document.createElement('div'); if (index) row.className = 'chart-tooltip-secondary-line'; row.textContent = text; return row;
        }));
        tooltip.hidden = false;
        const [pointerX, pointerY] = d3.pointer(event, el);
        const tooltipWidth = tooltip.offsetWidth, tooltipHeight = tooltip.offsetHeight;
        tooltip.style.left = Math.max(4, Math.min(W - tooltipWidth - 4, pointerX - tooltipWidth / 2)) + 'px';
        tooltip.style.top = (pointerY - tooltipHeight - 14 < 4 ? pointerY + 16 : pointerY - tooltipHeight - 14) + 'px';
      })
      .on('pointerleave', () => { tooltip.hidden = true; });
  });

  dashboard.draw('storage_box_brand_legend', (el) => {
    const d = dashboard.data('storage_box_options_with_unit_prices');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    [...new Set(d.data.map((box) => box.brand))].forEach((brand) => {
      const item = document.createElement('span'); item.append(brandDot(brandColor(brand, d.data)), brand); el.append(item);
    });
  });

  // Boxes the chart can't place because the chosen size isn't known.
  dashboard.draw('storage_box_missing_size_note', (el) => {
    const d = dashboard.data('storage_box_options_with_unit_prices');
    el.textContent = '';
    if (d.status !== 'ok') return;
    const measure = currentMeasure();
    const missing = d.data.filter((box) => box[measure.sizeField] == null);
    if (!missing.length) return;
    const otherMeasure = Object.values(SIZE_MEASURES).find((other) => other !== measure);
    const byBrand = d3.rollups(missing, (brandBoxes) => brandBoxes.length, (box) => box.brand).map(([brand, count]) => brand + ' ×' + count).join(', ');
    el.textContent = missing.length + ' boxes have no ' + measure.name + ' in the comparison (' + byBrand + '), so they are not in the chart'
      + (storageBoxState.rangeIndex === ALL_SIZES ? '' : ' or the size ranges') + '. Switch to ' + otherMeasure.name + ' to see them.';
  });

  // ===== Table: every box in the chosen range, sortable, with notes and source =====
  const TABLE_COLUMNS = [
    {field: 'brand', header: 'Company'}, {field: 'location', header: 'Location'}, {field: 'box', header: 'Box'},
    {field: 'floor_area_m2', header: 'Floor area (m²)', format: formatSize},
    {field: 'height_m', header: 'Height (m)', format: formatSize},
    {field: 'volume_m3', header: 'Volume (m³)', format: formatSize},
    {field: 'monthly_eur', header: 'Per month', format: formatEuros},
    {field: 'total_12_months_eur', header: '12 months', format: formatEuros},
    {field: 'unit_price', header: 'Per m³ per month', format: formatUnitPrice},
  ];
  dashboard.draw('storage_box_comparison_table', (el) => {
    const d = dashboard.data('storage_box_options_with_unit_prices');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    const measure = currentMeasure();
    const valueOf = (box, field) => field === 'unit_price' ? box[measure.unitPriceField] : box[field];
    const rows = selectedBoxes(d.data).slice().sort((a, b) => {
      const first = valueOf(a, storageBoxState.sortField), second = valueOf(b, storageBoxState.sortField);
      if (first == null || second == null) return (first == null) - (second == null);  // unknown values last
      const order = typeof first === 'string' ? first.localeCompare(second) : first - second;
      return storageBoxState.sortAscending ? order : -order;
    });
    const headerRow = el.createTHead().insertRow();
    TABLE_COLUMNS.forEach((column) => {
      const th = document.createElement('th'); th.scope = 'col';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'storage-box-sort-button';
      const isSorted = storageBoxState.sortField === column.field;
      button.textContent = (column.field === 'unit_price' ? 'Per ' + measure.unit + ' per month' : column.header) + (isSorted ? (storageBoxState.sortAscending ? ' ▲' : ' ▼') : '');
      if (isSorted) th.setAttribute('aria-sort', storageBoxState.sortAscending ? 'ascending' : 'descending');
      button.addEventListener('click', () => {
        storageBoxState.sortAscending = isSorted ? !storageBoxState.sortAscending : true;
        storageBoxState.sortField = column.field;
        dashboard.draw('storage_box_comparison_table');
      });
      th.append(button); headerRow.append(th);
    });
    const notesHeader = document.createElement('th'); notesHeader.scope = 'col'; notesHeader.textContent = 'Notes and source'; headerRow.append(notesHeader);
    const body = el.createTBody();
    rows.forEach((box) => {
      const tr = body.insertRow();
      TABLE_COLUMNS.forEach((column) => {
        const td = tr.insertCell();
        const value = valueOf(box, column.field);
        if (column.field === 'brand') td.append(brandDot(brandColor(box.brand, d.data)));
        td.append(value == null ? '–' : column.format ? column.format(value) : value);
        if (column.format) td.classList.add('is-num');
      });
      const notesCell = tr.insertCell(); notesCell.className = 'storage-box-notes-cell';
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = 'Notes';
      const notes = document.createElement('p'); notes.textContent = box.notes || '';
      details.append(summary, notes);
      if (box.source_url) {
        const source = document.createElement('a'); source.href = box.source_url; source.target = '_blank'; source.rel = 'noopener';
        source.textContent = 'Source' + (box.consulted_on ? ' (consulted ' + box.consulted_on + ')' : '');
        details.append(source);
      }
      notesCell.append(details);
    });
  });

  // ===== How the prices are counted (Read me sheet) =====
  dashboard.draw('storage_box_read_me_list', (el) => {
    const d = dashboard.data('storage_box_read_me');
    el.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.forEach((row) => {
      const item = document.createElement('li');
      const topic = document.createElement('b'); topic.textContent = row.topic + ': ';
      item.append(topic, row.text); el.append(item);
    });
  });
})();
