// Working holiday jobs around Auckland page (no tab: opened from the New Zealand chapter of the trip page).
// Data: nz-jobs-research.json (settings, tax brackets, visa steps, job types).
(function () {
  // ===== Data sources: the sections of nz-jobs-research.json =====
  const NZ_JOBS_FILE = 'pages/nz_jobs/nz-jobs-research.json';
  dashboard.registerDataSource('nz_jobs_settings', NZ_JOBS_FILE, 'settings');
  dashboard.registerDataSource('nz_jobs_tax_brackets', NZ_JOBS_FILE, 'tax_brackets');
  dashboard.registerDataSource('nz_jobs_visa_steps', NZ_JOBS_FILE, 'visa_steps');
  dashboard.registerDataSource('nz_jobs_job_types', NZ_JOBS_FILE, 'job_types');

  const HOURS_PER_WEEK = [20, 30, 40];

  // ===== Calculations =====
  dashboard.calc('nz_jobs_earnings_by_hours', {
    inputs: ['nz_jobs_settings', 'nz_jobs_tax_brackets'],
    title: 'Earnings at the minimum wage, by hours per week',
    description: 'Per person: minimum wage plus 8% holiday pay, income tax as if the weekly pay lasted a year (tax code M), minus the ACC levy; then over the weeks of work, and for the two of us in euros.',
    fn: (settings, brackets) => {
      const s = settings[0];
      const yearlyTax = (income) => {
        let tax = 0, from = 0;
        brackets.forEach((b) => {
          const to = b.up_to_nzd == null ? Infinity : b.up_to_nzd;
          if (income > from) tax += (Math.min(income, to) - from) * b.rate;
          from = to;
        });
        return tax;
      };
      return HOURS_PER_WEEK.map((hours) => {
        const weekly_gross_nzd = hours * s.minimum_wage_nzd_per_hour * (1 + s.holiday_pay_rate);
        const weekly_net_nzd = weekly_gross_nzd - yearlyTax(weekly_gross_nzd * 52) / 52 - weekly_gross_nzd * s.acc_levy_rate;
        return {hours, weekly_gross_nzd, weekly_net_nzd, weeks: s.weeks_working, total_net_nzd: weekly_net_nzd * s.weeks_working,
          couple_net_eur: weekly_net_nzd * s.weeks_working * 2 * s.eur_per_nzd};
      });
    }
  });

  // ===== Hours per week toggle =====
  // The stat tiles read the row for the chosen hours through data-where="hours=...".
  document.querySelectorAll('[data-jobs-hours]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-jobs-hours]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    document.querySelectorAll('[data-source="nz_jobs_earnings_by_hours"]').forEach((el) => { el.dataset.where = 'hours=' + b.dataset.jobsHours; });
    dashboard.draw('number_value');
  }));
})();
