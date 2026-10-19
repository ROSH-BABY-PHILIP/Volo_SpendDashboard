import pandas as pd, numpy as np, json

import os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source', 'Builder_Assignment___Spend_Analytics_Dashboard.xlsx')
t = pd.read_excel(SRC, sheet_name='Transactions')
b = pd.read_excel(SRC, sheet_name='Budgets')
e = pd.read_excel(SRC, sheet_name='Employees')
v = pd.read_excel(SRC, sheet_name='Vendors')
A = 'Amount (INR)'
END = pd.Timestamp('2026-09-30')

t['d'] = pd.to_datetime(t['Transaction Date'])
t['wk_actual'] = t.d.dt.dayofweek >= 5

# ---- duplicate detection (same invoice / receipt id) ----
t['doc'] = t['Invoice / Receipt ID']
dup_mask = t.doc.notna() & t.doc.duplicated(keep=False)
t['dup_group'] = dup_mask
t['dup_copy'] = t.doc.notna() & t.doc.duplicated(keep='first')  # later record = the copy

# ---- split / near-threshold detection ----
g = t.groupby(['Employee ID', 'Vendor ID', 'Transaction Date'])[A].transform(['count']) if False else None
grp = t.groupby(['Employee ID', 'Vendor ID', 'Transaction Date'])
t['_n'] = grp[A].transform('size')
t['_sum'] = grp[A].transform('sum')
t['split'] = (t._n > 1) & (t._sum >= 50000) & t['Vendor ID'].notna() & ~t.dup_group
t['near_limit'] = (t[A] >= 49000) & (t[A] < 50000)

# ---- statistical outlier within category (robust z) ----
def rz(s):
    med = s.median(); mad = (s - med).abs().median() * 1.4826
    return (s - med) / (mad if mad else 1)
t['rz'] = t.groupby('Spend Category')[A].transform(rz)
t['outlier'] = (t.rz > 3.5) & (t[A] >= 100000)

eff_mask = ~t['Transaction Status'].isin(['Declined', 'Reversed']) & ~t.dup_copy
completed = t['Transaction Status'] == 'Completed'
t['paid_no_appr'] = completed & t['Approval Status'].isin(['Pending', 'Rejected'])
t['rej_paid'] = completed & (t['Approval Status'] == 'Rejected')
t['reimb_large'] = (t['Payment Method'] == 'Reimbursement') & (t[A] >= 100000) & t['Vendor ID'].notna()
t['slow'] = t['Approval Turnaround (Hours)'] >= 72
t['aged_pending'] = (t['Approval Status'] == 'Pending') & ((END - t.d).dt.days > 30)

FLAGS = {
    'DUP':  ('Duplicate invoice ID', 5),
    'REJ':  ('Rejected yet completed', 5),
    'NAP':  ('Completed without approval', 3),
    'SPL':  ('Same-day split payments', 5),
    'NLM':  ('Just below 50,000', 2),
    'OUT':  ('Amount outlier for category', 3),
    'NRC':  ('Receipt missing', 2),
    'POL':  ('Policy non-compliant', 2),
    'RMB':  ('Large vendor spend via reimbursement', 2),
    'AGE':  ('Approval pending over 30 days', 2),
    'SLW':  ('Approval took 72 hours or more', 1),
}
def flags(r):
    f = []
    if r.dup_group: f.append('DUP')
    if r.rej_paid: f.append('REJ')
    elif r.paid_no_appr: f.append('NAP')
    if r.split: f.append('SPL')
    if r.near_limit: f.append('NLM')
    if r.outlier: f.append('OUT')
    if r['Receipt Attached'] == 'No': f.append('NRC')
    if r['Policy Compliant'] == 'No': f.append('POL')
    if r.reimb_large: f.append('RMB')
    if r.aged_pending: f.append('AGE')
    if r.slow: f.append('SLW')
    return f
t['flg'] = t.apply(flags, axis=1)
t['score'] = t['flg'].apply(lambda fl: sum(FLAGS[x][1] for x in fl))

def nz(x):
    return None if pd.isna(x) else x

rows = []
for _, r in t.iterrows():
    rows.append(dict(
        id=r['Transaction ID'], date=r['Transaction Date'], m=r['Transaction Date'][:7],
        eid=r['Employee ID'], emp=r['Employee Name'], dept=r['Department'], role=r['Role'],
        site=r['Location / Site'],
        vid=nz(r['Vendor ID']), vendor=(r['Vendor Name'] if pd.notna(r['Vendor Name']) else 'Unknown'),
        cat=r['Spend Category'], pay=r['Payment Method'], type=r['Transaction Type'],
        cur=r['Currency'], orig=float(r['Original Amount']), fx=float(r['FX Rate to INR']),
        amt=round(float(r[A]), 2), btype=r['Budget Type'], appr=r['Approval Status'],
        approver=nz(r['Approver']),
        tat=None if pd.isna(r['Approval Turnaround (Hours)']) else float(r['Approval Turnaround (Hours)']),
        rc=r['Receipt Attached'] == 'Yes', pol=r['Policy Compliant'] == 'Yes',
        exc=nz(r['Policy Exception Reason']), rec=r['Recurring / One-time'],
        st=r['Transaction Status'], desc=r['Description'], proj=r['Project / Cost Centre'],
        wk=bool(r.wk_actual), wkflag=r['Weekend Transaction'] == 'Yes', by=r['Entered By'],
        doc=nz(r.doc), dupcopy=bool(r.dup_copy), eff=bool(eff_mask[_]),
        fl=r.flg, sc=int(r.score)))

budgets = [dict(m=x['Month'][:7], dept=x['Department'], site=x['Location / Site'],
                b=float(x['Monthly Budget (INR)'])) for _, x in b.iterrows()]
emps = [dict(id=x['Employee ID'], name=x['Employee Name'], dept=x['Department'], role=x['Role'],
             site=x['Primary Location / Site'], mgr=x['Manager'], method=x['Primary Spend Method'])
        for _, x in e.iterrows()]
vend = [dict(id=x['Vendor ID'], name=x['Vendor Name'], cat=x['Category'], crit=x['Vendor Criticality'],
             terms=x['Payment Terms'], vtype=x['Vendor Type']) for _, x in v.iterrows()]

# ---- numbers for the findings narrative (full data) ----
E = t[eff_mask]
def cr(x): return f"INR {x/1e7:.2f} Cr"
def lk(x): return f"INR {x/1e5:.1f} L"
tot = E[A].sum()
nap = t[t.paid_no_appr]; rej = t[t.rej_paid]; pend_c = t[completed & (t['Approval Status'] == 'Pending')]
ss = E[E['Vendor Name'] == 'SiteServe Contractors']
ss_sep = ss[ss.Month == '2026-09-01'][A].sum(); sep_tot = E[E.Month == '2026-09-01'][A].sum()
ss_vp = ss[ss['Payment Method'] == 'Vendor Payment'][A].sum()
ss_med = ss.groupby('Month')[A].median()
dups = t[t.dup_copy]; spl = t[t.split & t.near_limit]
dd = t[(t['Employee Name'] == 'Diya Sharma') & t.near_limit & (t['Vendor Name'] == 'Metro Hardware')]
fin = E[E.Department == 'Finance'][A].sum(); fin_b = b[b.Department == 'Finance']['Monthly Budget (INR)'].sum()
big3 = ['Operations', 'Procurement', 'Projects']
big_b = b[b.Department.isin(big3)]['Monthly Budget (INR)'].sum(); big_a = E[E.Department.isin(big3)][A].sum()
top_ss_row = ss.sort_values(A, ascending=False).iloc[0]

F = dict(
    total=tot, nap_n=int(len(nap)), nap_v=nap[A].sum(), pend_n=int(len(pend_c)), pend_v=pend_c[A].sum(),
    rej_n=int(len(rej)), rej_v=rej[A].sum(),
    ss_share=ss[A].sum() / tot, ss_total=ss[A].sum(), ss_sep=ss_sep, ss_sep_share=ss_sep / sep_tot,
    ss_vp_share=ss_vp / ss[A].sum(), ss_med_jan=float(ss_med.loc['2026-01-01']), ss_med_sep=float(ss_med.loc['2026-09-01']),
    ss_top=dict(id=top_ss_row['Transaction ID'], amt=float(top_ss_row[A]), emp=top_ss_row['Employee Name'],
                site=top_ss_row['Location / Site'], pay=top_ss_row['Payment Method'], appr=top_ss_row['Approval Status']),
    dup_n=int(len(dups)), dup_v=dups[A].sum(), dd_n=int(len(dd)), dd_v=dd[A].sum(),
    fin=fin, fin_b=fin_b, big_b=big_b, big_a=big_a, bud_total=b['Monthly Budget (INR)'].sum(),
)
print(json.dumps(F, indent=1, default=float))
print('flag counts', t['flg'].explode().value_counts().to_dict())
print('score dist', (t.score >= 7).sum(), ((t.score >= 4) & (t.score < 7)).sum())
print('eff rows', int(eff_mask.sum()), 'eff spend', tot)
print('outliers', t.outlier.sum(), 'split', t.split.sum(), 'near', t.near_limit.sum(), 'reimb_large', t.reimb_large.sum())

payload = dict(tx=rows, budgets=budgets, emps=emps, vendors=vend,
               flags={k: dict(label=x[0], w=x[1]) for k, x in FLAGS.items()}, F=F,
               asof='2026-09-30')
open(os.path.join(HERE, 'assets', 'data.js'), 'w').write(
    'window.NSDATA = ' + json.dumps(payload, default=float, separators=(',', ':')) + ';')
