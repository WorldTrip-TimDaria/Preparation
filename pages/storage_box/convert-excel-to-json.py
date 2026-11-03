"""Convert storage_boxes_belgium.xlsx into storage-box-comparison.json for the Storage box page.

Run it after every change to the Excel file (Python 3 only, nothing to install):

    python3 pages/storage_box/convert-excel-to-json.py

It reads three sheets:
  - "Comparison"   -> section "boxes"        (rows without a monthly price are skipped)
  - "Open points"  -> section "open_points"
  - "Read me"      -> section "read_me"      (topics that only describe the Excel file are skipped)
Formula cells use the value Excel saved, so the numbers match the sheet exactly.
"""
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ElementTree
import zipfile

FOLDER = pathlib.Path(__file__).resolve().parent
EXCEL_FILE = FOLDER / 'storage_boxes_belgium.xlsx'
JSON_FILE = FOLDER / 'storage-box-comparison.json'

SPREADSHEET_NAMESPACE = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
RELATIONSHIP_NAMESPACE = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

# Excel column header -> JSON field name. A missing header stops the script.
COMPARISON_COLUMNS = {
    'Brand': 'brand',
    'Location': 'location',
    'Box / size': 'box',
    'Floor area (m²)': 'floor_area_m2',
    'Height (m)': 'height_m',
    'Volume (m³)': 'volume_m3',
    'Monthly price (€)': 'monthly_eur',
    'Total 12 months (€)': 'total_12_months_eur',
    'Notes': 'notes',
    'Source and date consulted': 'source',
}
NUMBER_FIELDS = {'floor_area_m2', 'height_m', 'volume_m3', 'monthly_eur', 'total_12_months_eur'}
OPEN_POINTS_COLUMNS = {
    'Item': 'item',
    'Type': 'type',
    'What I could not open or get': 'missing',
    'Suggested next step': 'next_step',
}
# "Read me" topics about the Excel file itself (cell colours, font colours), not about the prices.
EXCEL_ONLY_READ_ME_TOPICS = {'Colours', 'Blue numbers'}


def read_sheets(excel_path):
    """Return {sheet name: list of rows}, each row a list of cell values (str or None), columns A, B, C..."""
    with zipfile.ZipFile(excel_path) as archive:
        shared_strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            for item in ElementTree.fromstring(archive.read('xl/sharedStrings.xml')).iter(SPREADSHEET_NAMESPACE + 'si'):
                shared_strings.append(''.join(text.text or '' for text in item.iter(SPREADSHEET_NAMESPACE + 't')))
        workbook = ElementTree.fromstring(archive.read('xl/workbook.xml'))
        relationships = {relationship.get('Id'): relationship.get('Target')
                         for relationship in ElementTree.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in workbook.iter(SPREADSHEET_NAMESPACE + 'sheet'):
            target = relationships[sheet.get(RELATIONSHIP_NAMESPACE + 'id')].lstrip('/')
            sheet_path = target if target.startswith('xl/') else 'xl/' + target
            rows = []
            for row in ElementTree.fromstring(archive.read(sheet_path)).iter(SPREADSHEET_NAMESPACE + 'row'):
                values = {}
                for cell in row.iter(SPREADSHEET_NAMESPACE + 'c'):
                    column = re.match(r'[A-Z]+', cell.get('r')).group(0)
                    value_element = cell.find(SPREADSHEET_NAMESPACE + 'v')
                    if cell.get('t') == 's' and value_element is not None:
                        value = shared_strings[int(value_element.text)]
                    elif cell.get('t') == 'inlineStr':
                        value = ''.join(text.text or '' for text in cell.iter(SPREADSHEET_NAMESPACE + 't'))
                    else:
                        value = value_element.text if value_element is not None else None
                    values[column_index(column)] = value.strip() if isinstance(value, str) else value
                if values:
                    rows.append([values.get(index) for index in range(max(values) + 1)])
            sheets[sheet.get('name')] = rows
        return sheets


def column_index(letters):
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter) - ord('A') + 1
    return index - 1


def rows_as_records(rows, columns, sheet_name):
    header = [cell or '' for cell in rows[0]]
    missing = [name for name in columns if name not in header]
    if missing:
        sys.exit(f'Sheet "{sheet_name}" has no column {missing}. Columns found: {header}')
    positions = {field: header.index(name) for name, field in columns.items()}
    records = []
    for row in rows[1:]:
        record = {field: (row[position] if position < len(row) else None) or None for field, position in positions.items()}
        if any(record.values()):
            records.append(record)
    return records


def to_number(text):
    if text is None:
        return None
    number = round(float(text), 4)
    return int(number) if number.is_integer() else number


def main():
    sheets = read_sheets(EXCEL_FILE)
    for name in ('Comparison', 'Open points', 'Read me'):
        if name not in sheets:
            sys.exit(f'No sheet "{name}" in {EXCEL_FILE.name}. Sheets found: {list(sheets)}')

    boxes, skipped = [], []
    for record in rows_as_records(sheets['Comparison'], COMPARISON_COLUMNS, 'Comparison'):
        for field in NUMBER_FIELDS:
            record[field] = to_number(record[field])
        if record['monthly_eur'] is None:
            skipped.append(record['brand'])
            continue
        source = record.pop('source') or ''
        source_match = re.match(r'(\S+)\s*\((\d{4}-\d{2}-\d{2})\)\s*$', source)
        record['source_url'], record['consulted_on'] = source_match.groups() if source_match else (source or None, None)
        boxes.append(record)

    open_points = rows_as_records(sheets['Open points'], OPEN_POINTS_COLUMNS, 'Open points')
    read_me = [{'topic': row[0], 'text': row[1]} for row in sheets['Read me']
               if len(row) > 1 and row[0] and row[0] not in EXCEL_ONLY_READ_ME_TOPICS]

    JSON_FILE.write_text(json.dumps({'boxes': boxes, 'open_points': open_points, 'read_me': read_me},
                                    ensure_ascii=False, indent=2) + '\n')
    print(f'Wrote {JSON_FILE.name}: {len(boxes)} boxes, {len(open_points)} open points, {len(read_me)} read-me topics.')
    if skipped:
        print(f'Skipped {len(skipped)} rows without a monthly price: {", ".join(skipped)}')


if __name__ == '__main__':
    main()
