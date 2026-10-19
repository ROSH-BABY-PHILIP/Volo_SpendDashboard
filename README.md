# Northstar Projects | Spend Analytics Dashboard

Open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari). No server, install or internet connection is needed.

## Views
- **Overview**: eight headline measures, monthly trend with month-on-month change, generated alerts, department, site and payment method splits, largest transactions.
- **Budget**: budget against actual by month, utilisation heatmap by department and month, department and site tables, every budget line over 100%.
- **Spend breakdown**: category, project, transaction type, payment method mix, weekday, site by month heatmap, category movers, recurring spend, currency exposure.
- **Vendors**: concentration (top 1, 3, 5 share, Herfindahl index, Pareto), payment route by vendor, full vendor register.
- **People**: top spenders, risk points per employee, searchable employee register.
- **Controls**: approval status, turnaround histogram, approver performance, missing receipts, policy exception reasons, entry source quality, paid-without-approval list.
- **Exceptions**: rule-based scoring of every transaction, split payment clusters, searchable and filterable queue, record drawer, CSV export.
- **Findings**: top three insights and the item to investigate further.
- **Data notes**: data issues found and how they are treated.

## Interaction
- Ten global filters: month, department, site, project, employee, vendor, category, payment method, approval, status. Each takes multiple values.
- Click any bar, table row or heatmap-linked item to filter by it. Click again to clear.
- Basis switch: Net spend (default) excludes declined, reversed and duplicate records. All records shows everything.
- Click any transaction row to open the full record and the reason it was flagged.

## Rebuilding the data file
`python3 build_data.py` reads `source/*.xlsx` and rewrites `assets/data.js` (needs pandas and openpyxl). All flag rules and thresholds are at the top of that script.

## Files
- `index.html`, `assets/styles.css`, `assets/app.js`: the dashboard (no external libraries).
- `assets/data.js`: cleaned data with derived fields and flags.
- `INSIGHTS.md`: submission text.
