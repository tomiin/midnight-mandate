// Printable documents built from the agency's private records (never from the chain):
//   client invoice  -> for the traveller: what was booked and what they owe. No chain internals.
//   internal audit  -> for the agency: every purchase AND refusal per agent, with the on-chain
//                      receipt (tx, block, order reference) an auditor can check against the ledger.
type O = { id: string; client?: string; agent?: string; merchant: string; item: string; amount: number; status: string;
  txId?: string; blockHeight?: number; orderRef?: string; verified?: string; period?: number; createdAt: number; contract?: string; tripId?: string; requestedBy?: string; approvedBy?: string; paidBy?: string };
const verifyUrl = (o: O) => `/verify?c=${encodeURIComponent(o.contract ?? '')}&m=${encodeURIComponent(o.merchant)}&o=${encodeURIComponent(o.id)}&a=${o.amount}`;

const AGENCY = { name: 'Harbor & Co. Travel', line: '214 Bay Street · Nassau · hello@harborco.travel' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const when = (ts: number) => `${day(ts)} ${new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
const time = (ts: number) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
const sim = (m: string) => esc(m.replace(' (simulated)', ''));

const CSS = `*{box-sizing:border-box}body{margin:0;background:#eef0f6;font:14px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:#151829}
.page{max-width:860px;margin:28px auto;background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(20,24,60,.12);padding:44px 52px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #151829;padding-bottom:18px;margin-bottom:22px}
.brand{font-size:22px;font-weight:800;letter-spacing:-.4px}.small{color:#6a6f88;font-size:12px}
.doc{text-align:right}.doc h1{margin:0;font-size:24px;letter-spacing:-.3px}.tag{display:inline-block;margin-top:6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:99px;background:#eef0ff;color:#3a46b8}
.tag.int{background:#fff1e6;color:#b4520a}
.meta{display:flex;gap:40px;margin-bottom:22px}.meta div b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6a6f88}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#6a6f88;border-bottom:1px solid #dfe2ee;padding:8px 6px}
td{padding:10px 6px;border-bottom:1px solid #eef0f6;vertical-align:top}td.mono{white-space:nowrap}.r{text-align:right}.mono{font:11px ui-monospace,Menlo,monospace;color:#555b78;word-break:break-all}
.total td{border:0;font-size:18px;font-weight:800;padding-top:16px}
.st{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px}.paid{background:#e6f8ef;color:#13985b}.refused{background:#ffecee;color:#c92a42}.open{background:#f0f1f6;color:#6a6f88}
h2{font-size:15px;margin:26px 0 8px}.note{margin-top:26px;padding:14px 16px;border-radius:10px;background:#f6f7fb;color:#4a4f68;font-size:12.5px}
.bar{max-width:860px;margin:18px auto 0;display:flex;gap:10px;justify-content:flex-end}.bar button{font:inherit;font-weight:600;border:0;border-radius:9px;padding:9px 14px;background:#151829;color:#fff;cursor:pointer}
a.vfy{color:#0E5E63;font-weight:700;text-decoration:none;white-space:nowrap}
@media print{.noprint{display:none}body{background:#fff}.page{box-shadow:none;margin:0;max-width:none}.bar{display:none}}`;

const shell = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="bar"><button onclick="print()">Print / save as PDF</button></div><div class="page">${body}</div></body></html>`;

export function renderInvoice(kind: 'client' | 'internal', all: O[], opts: { client?: string; date?: string; contract?: string; network?: string; trip?: { id: string; title: string; start: string; end: string } }) {
  const date = opts.date || day(Date.now());
  if (kind === 'client') {
    const client = opts.client || 'Unassigned';
    // A trip has one invoice for all its bookings. Bookings outside a trip get one invoice per client per day.
    const rows = all.filter((o) => o.status === 'paid' && (opts.trip ? o.tripId === opts.trip.id : !o.tripId && (o.client ?? 'Unassigned') === client && day(o.createdAt) === date)).sort((a, b) => a.createdAt - b.createdAt);
    const total = rows.reduce((a, o) => a + o.amount, 0);
    const no = opts.trip ? `INV-${opts.trip.id.replace(/^TR-/, 'T')}` : `INV-${date.replace(/-/g, '')}-${client.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'CLNT'}`;
    return shell(`Invoice ${no}`, `
<div class="head"><div><div class="brand">${AGENCY.name}</div><div class="small">${AGENCY.line}</div></div>
<div class="doc"><h1>Invoice</h1><div class="small">${no}</div><span class="tag">Client copy</span></div></div>
<div class="meta"><div><b>Bill to</b>${esc(client)}</div>${opts.trip ? `<div><b>Trip</b>${esc(opts.trip.title)} · ${esc(opts.trip.start)} → ${esc(opts.trip.end)}</div>` : ''}<div><b>${opts.trip ? 'Issued' : 'Date'}</b>${esc(opts.trip ? day(Date.now()) : date)}</div><div><b>Bookings</b>${rows.length}</div></div>
<table><tr><th>Booked</th><th>Booking</th><th>Booked by</th><th>Ref</th><th class="r">Amount</th><th class="r noprint">Proof</th></tr>
${rows.map((o) => `<tr><td style="white-space:nowrap">${esc(when(o.createdAt))}</td><td>${esc(o.item)}<div class="small">${sim(o.merchant)}</div></td><td class="small">${esc(o.requestedBy ?? o.agent ?? 'AI agent')}${o.approvedBy ? `<br>approved by ${esc(o.approvedBy)}` : ''}</td><td class="mono">${esc(o.id)}</td><td class="r">${money(o.amount)}</td><td class="r noprint">${o.contract ? `<a class="vfy" href="${esc(verifyUrl(o))}" target="_blank">Verify ✓</a>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="small">${opts.trip ? 'No paid bookings on this trip yet.' : 'No paid bookings outside a trip for this client on this date.'}</td></tr>`}
<tr class="total"><td colspan="4">Total due</td><td class="r">${money(total)}</td><td></td></tr></table>
<div class="note">Booked on your behalf by ${AGENCY.name}'s AI booking agent within the travel budget you approved. Each booking was paid through Mandate, so suppliers were never told who you are. You can check any booking yourself: <b>Verify</b> reads the public Midnight ledger and confirms that exact order was paid that exact amount within an approved mandate. The ledger never shows your name or ours. Questions: ${AGENCY.line.split('·').pop()?.trim()}.</div>`);
  }
  // internal audit
  const rows = all.filter((o) => day(o.createdAt) === date && o.status !== 'cancelled');
  const byAgent = new Map<string, O[]>();
  for (const o of rows) byAgent.set(o.agent ?? 'Unknown agent', [...(byAgent.get(o.agent ?? 'Unknown agent') ?? []), o]);
  const paid = rows.filter((o) => o.status === 'paid'), refused = rows.filter((o) => o.status === 'refused');
  const section = ([agent, list]: [string, O[]]) => `<h2>${esc(agent)}</h2>
<table><tr><th>Time</th><th>Client</th><th>Supplier · item</th><th>Status</th><th class="r">Amount</th></tr>
${list.map((o) => `<tr><td>${time(o.createdAt)}</td><td>${esc(o.client ?? 'Unassigned')}</td><td>${sim(o.merchant)} · ${esc(o.item)}<div class="mono">order ${esc(o.id)}${o.orderRef ? ` · ref ${esc(o.orderRef)}` : ''}${o.txId ? `<br>tx ${esc(o.txId)} · block ${esc(o.blockHeight)}` : ''}</div>${o.status === 'refused' ? `<div class="small" style="color:#c92a42">${esc(o.verified)}</div>` : ''}</td>
<td><span class="st ${o.status === 'paid' ? 'paid' : o.status === 'refused' ? 'refused' : 'open'}">${esc(o.status.replace('_', ' '))}</span></td><td class="r">${money(o.amount)}</td></tr>`).join('')}
<tr><td colspan="4" class="small">Agent total paid</td><td class="r"><b>${money(list.filter((o) => o.status === 'paid').reduce((a, o) => a + o.amount, 0))}</b></td></tr></table>`;
  return shell(`Internal audit ${date}`, `
<div class="head"><div><div class="brand">${AGENCY.name}</div><div class="small">Internal · not for distribution</div></div>
<div class="doc"><h1>Daily audit report</h1><div class="small">${esc(date)}</div><span class="tag int">Internal copy</span></div></div>
<div class="meta"><div><b>Paid</b>${paid.length} · ${money(paid.reduce((a, o) => a + o.amount, 0))}</div><div><b>Refused by contract</b>${refused.length}</div><div><b>Agents active</b>${byAgent.size}</div><div><b>Network</b>${esc(opts.network ?? '')}</div></div>
${[...byAgent.entries()].map(section).join('') || '<p class="small">No agent activity on this date.</p>'}
<div class="note"><b>How to verify:</b> every paid line carries its Midnight transaction and order reference. On the public ledger of Mandate contract <span class="mono">${esc(opts.contract ?? '')}</span>, the order reference maps to the exact amount paid, so an auditor can confirm each charge without access to these records. Client and agent names exist only in these private records and were never written on chain.</div>`);
}

