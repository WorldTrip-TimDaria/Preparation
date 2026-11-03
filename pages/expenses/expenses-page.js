// Expenses page: totals, tickets on the route and the spending log.
// Data: expenses-notion-export.csv (exported from Notion) + the trip legs calculated on the trip page.
(function () {
  // ===== Data sources =====
  dashboard.registerDataSource('expenses_notion_export', 'pages/expenses/expenses-notion-export.csv');

  // ===== Calculations: expenses =====
  dashboard.calc('expenses_cleaned_rows', {
    inputs: ['expenses_notion_export'],
    title: 'Expenses, cleaned',
    description: 'Each expense with its amount read as a number of euros and its date as YYYY-MM-DD, oldest first.',
    fn: (expenses) => expenses.map((r) => {
      const day = new Date(Date.parse(r.Date + ' UTC'));
      return {date: isNaN(day) ? r.Date : day.toISOString().slice(0, 10), expense: r.Expense, category: r.Category,
        amount_eur: Number(String(r.Amount).replace(/[^0-9.\-]/g, '')) || 0, who_paid: r['who paid'], for_whom: r['for whom'],
        country: r.pays, merchant: r.Merchant, notes: r.Notes};
    }).sort((a, b) => String(a.date).localeCompare(String(b.date))).map((r, i) => ({n: i + 1, ...r}))
  });

  dashboard.calc('expenses_total_by_payer', {
    inputs: ['expenses_cleaned_rows'],
    title: 'Expenses by who paid',
    description: 'Total euros paid by each person.',
    fn: (expense_rows) => [...new Set(expense_rows.map((r) => r.who_paid))].map((who_paid) => ({who_paid,
      amount_eur: expense_rows.filter((r) => r.who_paid === who_paid).reduce((t, r) => t + r.amount_eur, 0)}))
  });

  dashboard.calc('expenses_total_by_category', {
    inputs: ['expenses_cleaned_rows'],
    title: 'Expenses by category',
    description: 'Total euros per category.',
    fn: (expense_rows) => [...new Set(expense_rows.map((r) => r.category))].map((category) => ({category,
      amount_eur: expense_rows.filter((r) => r.category === category).reduce((t, r) => t + r.amount_eur, 0)}))
  });

  dashboard.calc('expenses_overall_total', {
    inputs: ['expenses_cleaned_rows'],
    title: 'Expenses total',
    description: 'All expenses summed, in euros.',
    fn: (expense_rows) => [{total_eur: expense_rows.reduce((t, r) => t + r.amount_eur, 0), count: expense_rows.length}]
  });

  // ===== Calculations: tickets (joins the trip legs from pages/trip/trip-page.js with Travel expenses) =====
  dashboard.calc('expenses_travel_tickets', {
    inputs: ['trip_travel_legs', 'trip_stays_with_nights', 'expenses_cleaned_rows'],
    title: 'Tickets on the route',
    description: 'Every flight, train and bus leg of the route in travel order with its estimated cost (campervan driving is left out: the van is in the daily cost); a leg is bought when its stop names a keyword (paid_expense) found in Travel expenses, whose amounts are summed as paid.',
    fn: (legs, stays, expense_rows) => legs.filter((l) => l.mode !== 'campervan').map((l) => {
      const from = stays.find((s) => s.city === l.from), to = stays.find((s) => s.city === l.to);
      const key = l.optional ? '' : (to && to.paid_expense) || '';
      const hits = key ? expense_rows.filter((e) => e.category === 'Travel' && String(e.expense).toLowerCase().includes(key)) : [];
      const paid = hits.reduce((t, e) => t + e.amount_eur, 0);
      return {date: (from && from.depart) || '', from: l.from, to: l.to, mode: l.mode, estimate_eur: l.optional && l.transport_eur === 0 ? null : l.transport_eur,
        paid_eur: hits.length ? paid : null, status: l.optional ? 'Optional' : hits.length ? 'Bought' : 'To buy'};
    }).sort((a, b) => a.date.localeCompare(b.date) || (a.status === 'Optional') - (b.status === 'Optional')).map((r, i) => ({n: i + 1, ...r}))
  });

  dashboard.calc('expenses_travel_ticket_totals', {
    inputs: ['expenses_travel_tickets'],
    title: 'Tickets bought and to buy',
    description: 'Paid total of bought legs, and the estimate and count of main-route legs not bought yet.',
    fn: (tickets) => {
      const left = tickets.filter((t) => t.status === 'To buy');
      return [{paid_eur: tickets.reduce((s, t) => s + (t.paid_eur || 0), 0), to_buy_eur: left.reduce((s, t) => s + (t.estimate_eur || 0), 0), to_buy_count: left.length}];
    }
  });

  // ===== Totals by payer and by category =====
  dashboard.draw('expenses_amount_list', (el) => {
    const d = dashboard.data(el.dataset.source);
    el.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.slice().sort((a, b) => b.amount_eur - a.amount_eur).forEach((r) => {
      const li = document.createElement('li');
      const k = document.createElement('span'); k.textContent = r[el.dataset.key];
      const v = document.createElement('span'); v.textContent = '€' + d3.format(',.2f')(r.amount_eur);
      li.append(k, v); el.append(li);
    });
  });

  // ===== CSV download =====
  // Download the expenses table as a CSV (UTF-8 with BOM so Excel keeps accents).
  const expensesCsvColumns = [['date', 'Date'], ['expense', 'Expense'], ['category', 'Category'], ['amount_eur', 'Amount (EUR)'], ['who_paid', 'Who paid'],
    ['for_whom', 'For whom'], ['country', 'Country'], ['merchant', 'Merchant'], ['notes', 'Notes']];
  const escapeCsvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  dashboard.onData(() => {
    const ok = dashboard.data('expenses_cleaned_rows').status === 'ok';
    document.querySelectorAll('.expenses-csv-download-button').forEach((b) => { b.disabled = !ok; });
  });
  const downloadsCapabilityReady = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  const showCsvDownloadMessage = (name) => document.querySelectorAll('.expenses-csv-download-message').forEach((m) => { m.hidden = m.dataset.msg !== name; });
  document.querySelectorAll('.expenses-csv-download-button').forEach((b) => b.addEventListener('click', async () => {
    const d = dashboard.data('expenses_cleaned_rows');
    if (d.status !== 'ok') return;
    const lines = [expensesCsvColumns.map(([, h]) => escapeCsvCell(h)).join(',')]
      .concat(d.data.map((r) => expensesCsvColumns.map(([f]) => escapeCsvCell(r[f])).join(',')));
    const csv = '﻿' + lines.join('\r\n') + '\r\n';
    showCsvDownloadMessage(null);
    const downloads = await downloadsCapabilityReady;
    if (!downloads) {
      const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
      const a = document.createElement('a'); a.href = url; a.download = 'trip-expenses.csv';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showCsvDownloadMessage('saved');
      return;
    }
    try {
      await downloads.save({filename: 'trip-expenses.csv', data: csv});
      showCsvDownloadMessage('saved');
    } catch (e) {
      const code = e && e.code;
      showCsvDownloadMessage(code === 'declined' ? 'declined' : code === 'rate_limited' ? 'busy' : 'unavailable');
    }
  }));
})();
