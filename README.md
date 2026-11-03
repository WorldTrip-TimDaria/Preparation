# World trip 2027

A static website for planning our trip: the route story with map and timeline, insurance research, expenses and tickets, and the Okinawa campervan plan. There's no build step and no server code: just HTML, one JavaScript file and the data files.

## Run it

Browsers block `fetch()` from `file://`, so serve the folder:

```bash
cd world-trip
python3 -m http.server 8000
# open http://localhost:8000
```

Or publish with GitHub Pages (Settings → Pages → deploy from branch, root folder).
**Privacy:** on a free GitHub plan a Pages site is public even if the repo is private, and the data holds our expenses, names and dates. Keep it local, or use a plan with private Pages, if that matters.

## Files

```
index.html          all pages (Trip, Insurance, Expenses, Okinawa) + the page script
js/dash.js          loads data/, runs the calculations, redraws on data and size changes
data/               everything you edit
```

d3 v7 loads from cdnjs; fonts from Google Fonts (optional, falls back to system fonts).

## Editing the data

Edit the files in `data/` (any text editor, or a spreadsheet for the CSVs) and reload. Keep the column names unchanged.

### `stops.csv`: the route (one row per stop, in travel order)

| column | meaning |
|---|---|
| `stop` | order number, starting at 0 |
| `city`, `country` | names shown on the page; `country` must match the map's country names to be shaded |
| `chapter` | which story chapter the stop belongs to: `start`, `taiwan`, `japan`, `korea`, `thailand`, `laos`, `vietnam`, `australia`, `nz` |
| `lat`, `lon` | position on the map |
| `arrive`, `depart` | `YYYY-MM-DD`; nights = depart − arrive |
| `transport_in` | how we get there: `flight`, `train`, `bus` |
| `transport_eur` | cost of that leg for two (for an optional stop: the extra cost of the detour) |
| `daily_eur` | daily allowance for two while there (lodging, food, activities) |
| `status` | `given`, `from notes`, `idea`, `optional` |
| `optional` | `yes` for a stop that may not happen (drawn green, left out of totals) |
| `note` | free text shown under the stop |
| `paid_expense` | a word found in a Travel expense's name: the leg arriving here shows as bought, with what we paid |

Adding a new chapter (country) also needs a matching `<section ... data-chapter="...">` in `index.html`.

### `expenses.csv`: our Notion export

Same columns as the Notion table (`Category, Expense, Amount, who paid, for whom, Date, pays, Merchant, Notes`). Re-export from Notion and replace the file.

### Insurance (`needs.json`, `coverage.json`, `verdicts.json`, `desk.json`, `prices.json`)

From our Notion "Assurance" notes. `prices.json` is the comparison grid (`profile`: `couple_u40`, `solo_u40`, `solo_o40`; `base_eur`, `usa_canada_eur`).

### Okinawa (`okinawa_loop.json`, `okinawa_spots.json`, `okinawa_vans.json`)

- `okinawa_loop.json`: the campervan loop in order (`arrive`/`depart`, `daily_eur` for two, `parking_jpy` per night, `null` if unknown).
- `okinawa_spots.json`: every overnight spot found (`type` starting with `Paid`, `Free`, `Roadside` or anything else decides the marker; coordinates are approximate).
- `okinawa_vans.json`: rental offers.

### Map outlines (don't edit)

`countries.json` (Natural Earth via world-atlas, pre-projected and centred on 90°E) and `okinawa_shapes.json` (GSI Global Map Japan via jpn-atlas, projected around 127.95°E, 26.5°N; `index.html` uses the same constants).

## What's real and what's a placeholder

- Real: country months, Brussels → Taipei on 14 Jan 2027 (bought, €1,146), Okinawa → Kyushu → Kyoto, Melbourne at Mark's, the insurance notes, the expenses, the Okinawa fees and rental terms from the linked guides.
- Placeholders: cities within each country (apart from those above), exact days, every daily allowance and leg cost, the Okinawa loop, the Hijet price (assumed ¥9,900/day until Evertrail quotes).
