# World trip 2027

A static website for planning our trip. It has the route story with a map and timeline, our insurance research, expenses and tickets, and the Okinawa campervan plan. There's no build step and no server code: just HTML, CSS, JavaScript and data files.

## Run it

Browsers block `fetch()` from `file://`, so serve the folder:

```bash
cd Preparation
python3 -m http.server 8000
# open http://localhost:8000
```

Or publish with GitHub Pages (Settings → Pages → deploy from branch, root folder).
**Privacy:** on a free GitHub plan a Pages site is public even if the repo is private, and the data holds our expenses, names and dates. Keep it local, or use a plan with private Pages, if that matters.

## Where things are

**One folder per page.** Everything a page needs (its styles, its script and its data) sits in `pages/<page>/`. Things used by several pages sit in `shared/`.

```
index.html                    the page shell: tab bar + one <section class="page"> per page (markup only)
shared/
  shared-styles.css           colours, fonts and spacing (light and dark), tabs, page headers,
                              cards, data tables, stat tiles, tooltips, buttons
  shared-scripts.js           the runtime that loads data and redraws, the number_value and
                              data_table draw functions, tab switching and #links
pages/
  trip/                       the "Trip" tab: route story, world map, timeline
    trip-page.css
    trip-page.js
    trip-route-stops.csv                      ← edit: the route, one row per stop
    trip-disease-risk.csv                     ← edit: disease risk by country and region
    trip-climate-by-month.csv                 ← edit: best season rating by place and month
    world-country-outlines-do-not-edit.json   generated map outlines
    trip-region-outlines-do-not-edit.json     generated province outlines for the disease layers
  insurance/                  the "Insurance" tab
    insurance-page.css
    insurance-page.js
    insurance-research.json                   ← edit: all insurance tables, one section each
  expenses/                   the "Expenses" tab: totals, tickets, spending log
    expenses-page.css
    expenses-page.js
    expenses-notion-export.csv                ← replace: export from Notion
  okinawa/                    the Okinawa campervan page (no tab, see below)
    okinawa-page.css
    okinawa-page.js
    okinawa-campervan-plan.json               ← edit: loop, overnight spots, rental offers
    okinawa-municipality-outlines-do-not-edit.json   generated map outlines
  storage_box/                the "Storage box" tab: storage boxes in Belgium compared by size
    storage-box-page.css
    storage-box-page.js
    storage_boxes_belgium.xlsx                ← edit: the comparison sheet
    convert-excel-to-json.py                  run after editing the Excel
    storage-box-comparison.json               written by the script, don't edit
```

d3 v7 loads from cdnjs. The fonts load from Google Fonts; they're optional, and the page falls back to system fonts.

Some things are easy to miss:

- **The Okinawa page has no tab.** You open it from the "Okinawa campervan plan" button in the Japan chapter, and its back button returns to that chapter.
- **The Expenses page uses the Trip data.** The tickets table joins the trip legs (`trip_travel_legs`, calculated in `trip-page.js`) with the Travel expenses. That's why `trip-page.js` is loaded before `expenses-page.js`.
- **A `#link` opens the right page.** `index.html#okinawa-spots` opens the Okinawa page and scrolls to that heading. This works for any element `id`.
- **The map projection is defined in two places.** The outline files were projected once, and the JS uses the same constants to place the dots:
  - world: Natural Earth centred on 90°E (`trip-page.js`, "World map");
  - Okinawa: 127.95°E, 26.5°N (`OKINAWA_PROJECTION` in `okinawa-page.js`).

  If you regenerate an outline file, keep these in step.

## How a page works

Each piece of a page is an HTML element with a `data-draw` attribute. The page's JS fills that element from named data.

```
data file ──registerDataSource──▶ data source id ──dashboard.calc──▶ calculation id
                                                  │                      │
                                                  ▼                      ▼
          <element data-draw="<draw name>" data-source="<id>">  ◀── dashboard.draw('<draw name>', fn)
```

The JS calls look like this:

```js
// 1. Register a data file (optionally one section of a merged JSON file).
dashboard.registerDataSource('insurance_needs', 'pages/insurance/insurance-research.json', 'needs');

// 2. Derive data. The calculation reruns automatically when its inputs change.
dashboard.calc('trip_overall_totals', {inputs: ['trip_stays_with_nights', 'trip_totals_by_chapter'], fn: (stays, byChapter) => [...]});

// 3. Draw: the function runs for every element with that data-draw.
//    It runs when the data arrives, when the element is resized and when its page is shown.
dashboard.draw('insurance_needs_list', (element) => { const rows = dashboard.data('insurance_needs').data; ... });
```

Two draw functions are shared and need no JavaScript at all:

- **A single number:**
  `<b data-draw="number_value" data-source="trip_overall_totals" data-row="0" data-field="km">—</b>`
  - Use `data-where="chapter=japan"` instead of `data-row` to pick the row.
  - Add `data-fmt="pct"` for a percentage, or `data-fmt="eur2"` for two decimals.
- **A table:**
  `<table class="data-table" data-draw="data_table" data-source="okinawa_overnight_spots" data-cols="name|Spot;fee|Fee"></table>`
  - Columns whose names end in `_eur` are formatted as money.
  - Cells in a `verdict` or `status` column get an `is-<value>` class, which colours them.

### Naming rules

- **CSS classes** start with the page name (`trip-…`, `insurance-…`, `okinawa-…`, `expenses-…`). Shared classes have no page prefix (`card`, `data-table`, `stat-tile`, `page-header`…).
- **Data source ids and calculation ids** start with the page name too (`trip_travel_legs`, `okinawa_overall_totals`). Draw names follow the same pattern.
- **Modifier classes** start with `is-` (`is-active`, `is-must`, `is-Bought`).

## Checklists

### Add a new tab (page)

1. Create `pages/<page>/` with `<page>-page.css`, `<page>-page.js` and its data file.
2. In `index.html`:
   - add a tab button `<button type="button" data-page="<page>" aria-pressed="false">Name</button>` in `<nav class="page-tabs">`;
   - add a `<section class="page content-page" id="<page>" hidden>` with a `<header class="page-header">`;
   - add a `<link rel="stylesheet">` in `<head>` and a `<script>` at the end of `<body>`.
3. In `<page>-page.js`, wrap the code in `(function () { ... })();`. Register the data first, then add the calculations and draw functions.

You can reuse `card`, `card-grid`, `section-heading`, `stat-tiles`/`stat-tile`, `data-table` and `toggle-button-group` (a row of buttons, one pressed at a time) from the shared styles. For a page without a tab (like Okinawa), skip the tab button and link to it with any `data-page="<page>"` button.

### Add a chapter (country) to the trip

1. Use a new `chapter` value in the rows of `trip-route-stops.csv`.
2. Add a matching `<section class="trip-chapter" data-chapter="<chapter>" id="chapter-<chapter>">` in `index.html`, in travel order. Copy an existing chapter, including its `<ol class="trip-stop-list" data-draw="trip_stop_list" …>`.

### Add a data file to a page

1. Put the file in the page's folder (or add a section to the page's JSON file).
2. Register it at the top of the page's JS, for example `dashboard.registerDataSource('<page>_<what>', 'pages/<page>/<file>', '<section>')`.
3. Use the id in a `data-source` attribute or a `dashboard.data('<id>')` call.

## Editing the data

Edit the data file (in any text editor, or a spreadsheet for the CSVs), then reload the page. Keep the column and key names unchanged.

### `pages/trip/trip-route-stops.csv`: the route (one row per stop, in travel order)

| column | meaning |
|---|---|
| `stop` | order number, starting at 0 |
| `city`, `country` | names shown on the page; `country` must match the map's country names to be shaded |
| `chapter` | the story chapter the stop belongs to: `start`, `taiwan`, `japan`, `korea`, `thailand`, `laos`, `vietnam`, `australia`, `nz` |
| `lat`, `lon` | position on the map |
| `arrive`, `depart` | `YYYY-MM-DD`; nights = depart − arrive |
| `transport_in` | how we get there: `flight`, `train`, `bus` |
| `transport_eur` | cost of that leg for two (for an optional stop: the extra cost of the detour) |
| `daily_eur` | daily allowance for two while there (lodging, food, activities) |
| `status` | `given`, `from notes`, `idea`, `optional` |
| `optional` | `yes` for a stop that may not happen (drawn green, left out of totals) |
| `note` | free text shown under the stop |
| `paid_expense` | a word found in a Travel expense's name: the leg arriving here shows as bought, with what we paid |

### `pages/trip/trip-climate-by-month.csv`: the best season layer on the map (one row per place and month)

The "Best season" button under the map turns the layer on and enables the month slider. It is off by default. While it is on, the route overview frames Asia-Pacific.

| column | meaning |
|---|---|
| `place` | the name shown on hover |
| `country`, `region` | the outline to colour. `region` must match `trip-region-outlines-do-not-edit.json` exactly. Leave it empty for the whole country. |
| `lat`, `lon` | fill these in for an island too small to colour: it is drawn as a dot instead |
| `month` | 1 to 12 |
| `level` | the colour: `0` Ideal (dark green), `1` Good (green), `2` Mixed (yellow), `3` Poor (orange), `4` Avoid (red). Edit it to override the rating. |
| `temp_min`, `temp_max`, `on_best_list` | the place's range and best-month list from [Où et Quand](https://www.ou-et-quand.net/partir/quand/). |
| `weather` | measured monthly averages for the place, from the Open-Meteo archive (2015 to 2024). Empty for New Zealand and Tasmania, which are rated from the best-month list and have no measured figures or hazards. |
| `plus`, `minus` | advantages and disadvantages shown on hover |
| `hazard_source` | where that month's typhoon, cyclone or smoke rating comes from |

`level` was worked out once and stored, so editing a figure does not change it. Each sample city starts at 0 if the month is on the place's best list and 1 if not, then adds:

- **Heat:** +1 if it feels 35° or more, +2 at 40° or more (average daily maximum feels-like temperature).
- **Cold:** +1 if it feels 8° or less, +2 at 0° or less.
- **Humidity:** +1 if the average dew point is 22° or more.
- **Rain:** +1 for 150 mm or 18 rainy days (1 mm or more), +2 for 300 mm or 25 days.
- **Hazard:** +1 in the season, +2 at the peak.

The place's level is the average across its sample cities, rounded, and capped at 4. `weather` averages the same cities, and "in parts" in `minus` means only some of them are affected. A country-level figure can hide big differences (Hanoi and Ho Chi Minh City, Darwin and Melbourne).

Hazard sources: [JMA](https://www.data.jma.go.jp/yoho/typhoon/statistics/average/average.html) (Japan), [KMA](https://www.kma.go.kr/neng/biz/climate/climate-of-korea.do) and published counts (South Korea), [Taipei Times](https://www.taipeitimes.com/News/taiwan/archives/2025/06/27/2003839357) quoting the CWA and [Trip.com](https://fr.trip.com/guide/destination/quand-partir-taiwan.html) (Taiwan), [Vietnam Guide](https://vietnamguide.co.kr/en/blog/typhoons-in-vietnam), a commercial guide (Vietnam), [Bangkok Post](https://www.bangkokpost.com/news/general/1644276/north-air-quality-yet-to-improve) (smoke in northern Thailand, also applied to Laos), [BoM](https://media.bom.gov.au/releases/541/wet-season-fast-approaching-time-to-prepare) (Darwin and Cairns), [Myanmar DMH](https://www.moezala.gov.mm/node/80) (Yangon), and [press reports of PAGASA](https://www.pressreader.com/philippines/the-freeman/20181030/281625306299329) (Cebu). No hazard was collected for Cambodia, Papua New Guinea, Tasmania or New Zealand, so none is counted there.

### `pages/trip/trip-disease-risk.csv`: the disease layers on the map (one row per source and place)

| column | meaning |
|---|---|
| `disease` | `rabies`, `dengue`, `chikungunya` or `malaria` |
| `country`, `region` | `region` must match the name in `trip-region-outlines-do-not-edit.json` exactly, accents included. Leave it empty for the whole country. |
| `level` | `high`, `moderate`, `low`, `none` (the source says there is none) or `nodata` |
| `year` | the year of the data, which sets the opacity: 90% for this year, 10% less per year, 40% at the lightest |
| `source`, `url`, `note` | shown when you hover a region (the note and source) and kept for reference (the url) |

For each source, a region's own row replaces that source's whole-country row. Across sources the highest risk is shown, and ties go to the newest data. A region with no risk and no `none` row is hatched as "no data". Vietnam's dengue layer is shown by province: its national ECDC row is `nodata` on purpose, so the national rate (about 115 per 100,000) appears in the note without colouring provinces that have no figure of their own.

Each disease uses its own definition, and `level` follows it:

- **Chikungunya (HCSP):** `high` is an epidemic, `moderate` is active circulation in the previous 12 months, `low` is cases reported without local transmission being shown.
- **Dengue (HCSP):** `high` is above 100 cases per 100,000, `moderate` is 10 to 100, `low` is under 10. Taiwan and Queensland are `low` because their cases are probably mostly imported.
- **Rabies:** human cases reported in the province are `high`. Animal cases only (WOAH "present") and US CDC "commonly found" in dogs are `moderate`. "Sometimes found" or wildlife only is `low`.
- **Malaria:** the HCSP's own zones. WHO district counts are `low` up to 10 *P. falciparum* or 50 *P. vivax* cases, `moderate` up to 100 or 500, and `high` above that.

`level` is the risk of infection, not the number of cases: Queensland and Taiwan figures mix local and imported cases, so they stay `low` whatever the count, and the note says so. Rows read from a map image are approximate, and the note says that too.

### `pages/expenses/expenses-notion-export.csv`: our Notion export

It has the same columns as the Notion table: `Category, Expense, Amount, who paid, for whom, Date, pays, Merchant, Notes`. To update it, re-export from Notion and replace the file, keeping its name.

### `pages/insurance/insurance-research.json`: our Notion "Assurance" notes

There is one section per table, in page order:

- `needs`: `priority` is `must`, `nice` or `skip`.
- `verdicts_by_insurer`
- `coverage_by_insurer`
- `prices_by_profile`: the comparison grid. `profile` is one of `couple_u40`, `solo_u40` or `solo_o40`; prices go in `base_eur` and `usa_canada_eur`.
- `comparison_desk`

### `pages/okinawa/okinawa-campervan-plan.json`

- `loop`: the campervan loop in order. Each stop has:
  - `arrive`/`depart`;
  - `daily_eur` for two;
  - `parking_jpy` per night, or `null` if unknown.
- `overnight_spots`: every overnight spot we found. A `type` starting with `Paid`, `Free` or `Roadside` sets the marker shape; any other type gets the campsite marker. Coordinates are approximate.
- `rental_offers`: the rental offers.

### `pages/storage_box/storage_boxes_belgium.xlsx`: the storage box comparison

Edit the Excel file, then rebuild the page's data:

```bash
python3 pages/storage_box/convert-excel-to-json.py
# Wrote storage-box-comparison.json: 47 boxes, 12 open points, 3 read-me topics.
```

The script needs only Python 3 and reads three sheets:

- **Comparison** becomes the boxes. It needs these column headers exactly: `Brand`, `Location`, `Box / size`, `Floor area (m²)`, `Height (m)`, `Volume (m³)`, `Monthly price (€)`, `Total 12 months (€)`, `Notes` and `Source and date consulted` (a URL followed by `(YYYY-MM-DD)`).
  - A row without a monthly price is skipped.
  - Formula cells use the value Excel saved, so save the file in Excel before converting.
  - A box without a volume (or a floor area) stays out of the chart and the size ranges for that measure. The page says which boxes are missing.
- **Open points** (`Item`, `Type`, `What I could not open or get`, `Suggested next step`) becomes the "Still to check" table.
- **Read me** becomes "How the prices are counted". The `Colours` and `Blue numbers` topics are left out, because they describe the Excel file only.

If a header is renamed, the script stops and says which one is missing. To change the size ranges (m³ and m²) or the default range, edit `SIZE_MEASURES` at the top of `storage-box-page.js`.

### Map outlines (`*-do-not-edit.json`)

- `pages/trip/world-country-outlines-do-not-edit.json`: Natural Earth via world-atlas, pre-projected and centred on 90°E.
- `pages/trip/trip-region-outlines-do-not-edit.json`: Natural Earth 10m provinces for the countries on the disease layers, simplified and projected the same way as the world outlines. Three Vietnamese provinces that Natural Earth mislabels were renamed (Đồng Nai, Bắc Kạn, Hưng Yên).
- `pages/okinawa/okinawa-municipality-outlines-do-not-edit.json`: GSI Global Map Japan via jpn-atlas, projected around 127.95°E, 26.5°N.

## What's real and what's a placeholder

- **Real:**
  - the month in each country;
  - Brussels → Taipei on 14 Jan 2027 (bought, €1,146);
  - Okinawa → Kyushu → Kyoto;
  - Melbourne at Mark's;
  - the insurance notes and the expenses;
  - the Okinawa fees and rental terms from the linked guides.
- **Placeholders:**
  - the cities within each country (apart from those above);
  - the exact days;
  - every daily allowance and leg cost;
  - the Okinawa loop;
  - the Hijet price (assumed ¥9,900/day until Evertrail quotes).
