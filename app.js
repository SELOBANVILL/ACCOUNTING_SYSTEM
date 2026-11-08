/* =====================================================
   1. CONNECT TO SUPABASE
   ===================================================== */
const SUPABASE_URL = 'https://othezxiodffoywrniyci.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90aGV6eGlvZGZmb3l3cm5peWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxNjI4MjQsImV4cCI6MjEwNzczODgyNH0.Hsjyq3ybHX5DvyhQANeWDMJmgaYJA_Ej4fB5ylsUkiM';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =====================================================
   2. HELPERS AND ACCOUNTING CONSTANTS
   ===================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const state = { accounts: [], entries: [] };

const TYPE_ORDER = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
const NORMAL = { Asset: 'debit', Expense: 'debit', Liability: 'credit', Equity: 'credit', Revenue: 'credit' };

const toCents = v => Math.round((parseFloat(v) || 0) * 100);
const money = c => (c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedMoney = c => (c < 0 ? '-' : '') + money(Math.abs(c));
const todayStr = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const isContra = a => NORMAL[a.type] !== a.normal_balance;

// Fixed labels used on the financial statements
const COMPANY_LABEL = 'Company';
const OWNER_LABEL = 'Owner';

function longDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric'
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), 3500);
}
function sortAccounts(list) {
  return [...list].sort((a, b) =>
    TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
    a.code.localeCompare(b.code, undefined, { numeric: true }));
}
const acctName = id => {
  const a = state.accounts.find(x => x.id === id);
  return a ? a.name : '(deleted account)';
};

/* =====================================================
   3. LOGIN / LOGOUT
   ===================================================== */
const authMsg = (text, info = false) => {
  const el = $('#auth-msg');
  el.textContent = text;
  el.className = 'auth-msg' + (info ? ' info' : '');
};

$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  authMsg('');
  const { error } = await sb.auth.signInWithPassword({
    email: $('#email').value.trim(), password: $('#password').value
  });
  if (error) authMsg(error.message);
});

$('#signup-btn').addEventListener('click', async () => {
  if (!$('#auth-form').reportValidity()) return;
  authMsg('');
  const { data, error } = await sb.auth.signUp({
    email: $('#email').value.trim(), password: $('#password').value
  });
  if (error) return authMsg(error.message);
  if (!data.session) authMsg('Account created. Check your email to confirm, then log in.', true);
});

$('#logout-btn').addEventListener('click', () => sb.auth.signOut());

let currentUserId = null;
sb.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id || null;
  if (uid === currentUserId) return;
  currentUserId = uid;

  if (session) {
    $('#auth-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-email').textContent = session.user.email;
    setTimeout(loadAll, 0);
  } else {
    state.accounts = []; state.entries = [];
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    $('#password').value = '';
  }
});

/* =====================================================
   4. TABS / SIDEBAR
   ===================================================== */
function closeSidebar() {
  $('.sidebar').classList.remove('open');
  $('#sidebar-backdrop').classList.remove('show');
}
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('hidden', v.id !== 'view-' + btn.dataset.view));
    closeSidebar();
  });
});
$('#sidebar-toggle').addEventListener('click', () => {
  $('.sidebar').classList.toggle('open');
  $('#sidebar-backdrop').classList.toggle('show');
});
$('#sidebar-backdrop').addEventListener('click', closeSidebar);

/* =====================================================
   5. LOAD DATA FROM SUPABASE
   ===================================================== */
async function loadAll() {
  const [a, e] = await Promise.all([
    sb.from('accounts').select('*'),
    sb.from('journal_entries').select('*, journal_lines(*)')
      .order('entry_date').order('created_at')
  ]);
  if (a.error || e.error) return toast((a.error || e.error).message, true);
  state.accounts = sortAccounts(a.data);
  state.entries = e.data;
  renderAll();
}

function renderAll() {
  renderAccounts();
  renderEntries('regular');
  renderEntries('adjusting');
  renderTrial();
  renderIncome();
  renderEquity();
  renderPosition();
  refreshSelects();
}

/* =====================================================
   6. CHART OF ACCOUNTS
   ===================================================== */
function renderAccounts() {
  const body = $('#accounts-body');
  if (!state.accounts.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No accounts yet. Add your first account using the form above.</td></tr>';
    return;
  }
  body.innerHTML = state.accounts.map(a => `
    <tr>
      <td><strong>${esc(a.code)}</strong></td>
      <td>${esc(a.name)}</td>
      <td><span class="pill">${a.type}</span></td>
      <td>${a.normal_balance === 'debit' ? 'Debit' : 'Credit'}</td>
      <td class="num"><button class="btn danger" data-del-acc="${a.id}">Delete</button></td>
    </tr>`).join('');
}

$('#account-form').addEventListener('submit', async e => {
  e.preventDefault();
  const type = $('#acc-type').value;
  const contra = $('#acc-contra').checked;
  let normal = NORMAL[type];
  if (contra) normal = normal === 'debit' ? 'credit' : 'debit';

  const { error } = await sb.from('accounts').insert({
    code: $('#acc-code').value.trim(), name: $('#acc-name').value.trim(),
    type, normal_balance: normal
  });
  if (error) return toast(error.code === '23505' ? 'That account code already exists.' : error.message, true);
  e.target.reset();
  toast('Account added');
  loadAll();
});

$('#accounts-body').addEventListener('click', async e => {
  const id = e.target.dataset.delAcc;
  if (!id || !confirm('Delete this account?')) return;
  const { error } = await sb.from('accounts').delete().eq('id', id);
  if (error) return toast(error.code === '23503'
    ? 'This account is used in journal entries and cannot be deleted.' : error.message, true);
  toast('Account deleted');
  loadAll();
});

/* =====================================================
   7. JOURNAL ENTRIES AND ADJUSTMENTS
   ===================================================== */
function fillSelect(sel) {
  const keep = sel.value;
  sel.innerHTML = '<option value="">Select account…</option>' +
    state.accounts.map(a => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('');
  sel.value = keep;
}
function refreshSelects() { document.querySelectorAll('.acct-select').forEach(fillSelect); }

function buildEntryForm(kind) {
  const root = $(kind === 'regular' ? '#journal-form' : '#adjust-form');
  const example = kind === 'regular'
    ? 'e.g. Owner invested cash to start the business'
    : 'e.g. To record supplies used during the month';

  root.innerHTML = `
    <div class="row">
      <label>Date <input type="date" class="e-date"></label>
      <label class="grow">Description <input type="text" class="e-desc" placeholder="${example}"></label>
    </div>
    <table class="lines" style="margin-top:16px">
      <thead><tr><th>Account</th><th class="num" style="width:160px">Debit</th><th class="num" style="width:160px">Credit</th><th style="width:50px"></th></tr></thead>
      <tbody class="e-lines"></tbody>
      <tfoot><tr><td>Totals</td><td class="num e-tdr">0.00</td><td class="num e-tcr">0.00</td><td></td></tr></tfoot>
    </table>
    <div class="row between">
      <button type="button" class="btn ghost e-add">+ Add line</button>
      <span class="badge e-status">Enter amounts</span>
    </div>
    <div style="margin-top:16px"><button type="button" class="btn primary e-save">Save entry</button></div>`;

  const linesBody = $('.e-lines', root);

  function updateTotals() {
    let dr = 0, cr = 0;
    linesBody.querySelectorAll('tr').forEach(tr => {
      dr += toCents($('.dr', tr).value);
      cr += toCents($('.cr', tr).value);
    });
    $('.e-tdr', root).textContent = money(dr);
    $('.e-tcr', root).textContent = money(cr);
    const st = $('.e-status', root);
    if (dr === 0 && cr === 0) { st.textContent = 'Enter amounts'; st.className = 'badge e-status'; }
    else if (dr === cr)       { st.textContent = '✓ Balanced'; st.className = 'badge ok e-status'; }
    else                      { st.textContent = 'Out of balance by ' + money(Math.abs(dr - cr)); st.className = 'badge bad e-status'; }
    return { dr, cr };
  }

  function addLine() {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><select class="acct-select"></select></td>
      <td><input type="number" class="dr" min="0" step="0.01" placeholder="0.00"></td>
      <td><input type="number" class="cr" min="0" step="0.01" placeholder="0.00"></td>
      <td><button type="button" class="icon-btn rm" title="Remove line">✕</button></td>`;
    fillSelect($('.acct-select', tr));
    const dr = $('.dr', tr), cr = $('.cr', tr);
    dr.addEventListener('input', () => { if (toCents(dr.value) > 0) cr.value = ''; updateTotals(); });
    cr.addEventListener('input', () => { if (toCents(cr.value) > 0) dr.value = ''; updateTotals(); });
    $('.rm', tr).addEventListener('click', () => {
      if (linesBody.children.length > 2) { tr.remove(); updateTotals(); }
      else toast('An entry needs at least two lines.', true);
    });
    linesBody.appendChild(tr);
  }

  function reset() {
    $('.e-date', root).value = todayStr();
    $('.e-desc', root).value = '';
    linesBody.innerHTML = '';
    addLine(); addLine();
    updateTotals();
  }

  $('.e-add', root).addEventListener('click', addLine);

  $('.e-save', root).addEventListener('click', async () => {
    const date = $('.e-date', root).value;
    const desc = $('.e-desc', root).value.trim();
    if (!date) return toast('Please choose a date.', true);
    if (!desc) return toast('Please enter a description.', true);

    const lines = [];
    for (const tr of linesBody.querySelectorAll('tr')) {
      const acct = $('.acct-select', tr).value;
      const dr = toCents($('.dr', tr).value), cr = toCents($('.cr', tr).value);
      if (!acct && !dr && !cr) continue;
      if (!acct) return toast('Every line with an amount needs an account.', true);
      if (!dr && !cr) return toast('Every selected account needs a debit or credit amount.', true);
      lines.push({ account_id: acct, debit: dr / 100, credit: cr / 100 });
    }
    if (lines.length < 2) return toast('An entry needs at least two lines.', true);
    const { dr, cr } = updateTotals();
    if (dr !== cr) return toast('Debits must equal credits before saving.', true);

    const { error } = await sb.rpc('save_entry', {
      p_date: date, p_description: desc, p_kind: kind, p_lines: lines
    });
    if (error) return toast(error.message, true);
    toast(kind === 'regular' ? 'Journal entry saved' : 'Adjusting entry saved');
    reset();
    loadAll();
  });

  reset();
}

function renderEntries(kind) {
  const box = $(kind === 'regular' ? '#journal-list' : '#adjust-list');
  const list = state.entries.filter(e => e.kind === kind);
  if (!list.length) {
    box.innerHTML = '<div class="card empty">Nothing recorded yet.</div>';
    return;
  }
  box.innerHTML = list.map(e => {
    const lines = [...e.journal_lines].sort((a, b) => (b.debit > 0) - (a.debit > 0));
    const rows = lines.map(l => `
      <tr>
        <td class="${l.credit > 0 ? 'indent' : ''}">${esc(acctName(l.account_id))}</td>
        <td class="num">${l.debit > 0 ? money(toCents(l.debit)) : ''}</td>
        <td class="num">${l.credit > 0 ? money(toCents(l.credit)) : ''}</td>
      </tr>`).join('');
    return `
      <div class="card">
        <div class="entry-head">
          <div><span class="date">${e.entry_date}</span> &nbsp; ${esc(e.description)}</div>
          <button class="btn danger" data-del-entry="${e.id}">Delete</button>
        </div>
        <table>
          <thead><tr><th>Account</th><th class="num" style="width:160px">Debit</th><th class="num" style="width:160px">Credit</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

['#journal-list', '#adjust-list'].forEach(sel => {
  $(sel).addEventListener('click', async e => {
    const id = e.target.dataset.delEntry;
    if (!id || !confirm('Delete this entry? This cannot be undone.')) return;
    const { error } = await sb.from('journal_entries').delete().eq('id', id);
    if (error) return toast(error.message, true);
    toast('Entry deleted');
    loadAll();
  });
});

/* =====================================================
   8. TRIAL BALANCE (all entries, no date filter)
   ===================================================== */
function computeTrial() {
  const rows = new Map(state.accounts.map(a =>
    [a.id, { acct: a, unadj: 0, adjDr: 0, adjCr: 0 }]));

  for (const entry of state.entries) {
    for (const l of entry.journal_lines) {
      const r = rows.get(l.account_id);
      if (!r) continue;
      const dr = toCents(l.debit), cr = toCents(l.credit);
      if (entry.kind === 'regular') r.unadj += dr - cr;
      else { r.adjDr += dr; r.adjCr += cr; }
    }
  }

  const split = net => net >= 0 ? { dr: net, cr: 0 } : { dr: 0, cr: -net };
  const out = [];
  for (const r of rows.values()) {
    const adjNet = r.unadj + r.adjDr - r.adjCr;
    if (!r.unadj && !r.adjDr && !r.adjCr) continue;
    out.push({ acct: r.acct, u: split(r.unadj), adjDr: r.adjDr, adjCr: r.adjCr, a: split(adjNet) });
  }
  return sortAccounts(out.map(o => ({ ...o, type: o.acct.type, code: o.acct.code })));
}

function renderTrial() {
  const rows = computeTrial();
  const table = $('#tb-table');
  const status = $('#tb-status');

  if (!rows.length) {
    table.innerHTML = '';
    status.innerHTML = '<div class="card empty">No transactions yet. Record entries to see the trial balance.</div>';
    return;
  }
  status.innerHTML = '';

  const T = { udr: 0, ucr: 0, adr: 0, acr: 0, jdr: 0, jcr: 0 };
  const body = rows.map(r => {
    T.udr += r.u.dr; T.ucr += r.u.cr; T.jdr += r.adjDr; T.jcr += r.adjCr; T.adr += r.a.dr; T.acr += r.a.cr;
    const f = c => c ? money(c) : '';
    return `<tr>
      <td>${esc(r.acct.code)} · ${esc(r.acct.name)}</td>
      <td class="num">${f(r.u.dr)}</td><td class="num">${f(r.u.cr)}</td>
      <td class="num">${f(r.adjDr)}</td><td class="num">${f(r.adjCr)}</td>
      <td class="num">${f(r.a.dr)}</td><td class="num">${f(r.a.cr)}</td></tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr><th class="left" rowspan="2">Account</th>
        <th class="group" colspan="2">Unadjusted</th>
        <th class="group" colspan="2">Adjustments</th>
        <th class="group" colspan="2">Adjusted</th></tr>
      <tr><th>Debit</th><th>Credit</th><th>Debit</th><th>Credit</th><th>Debit</th><th>Credit</th></tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td>Total</td>
      <td class="num">${money(T.udr)}</td><td class="num">${money(T.ucr)}</td>
      <td class="num">${money(T.jdr)}</td><td class="num">${money(T.jcr)}</td>
      <td class="num">${money(T.adr)}</td><td class="num">${money(T.acr)}</td></tr></tfoot>`;

  const ok = T.udr === T.ucr && T.jdr === T.jcr && T.adr === T.acr;
  status.innerHTML = ok
    ? '<span class="badge ok">✓ Trial balance is in balance: total debits equal total credits</span>'
    : `<span class="badge bad">Out of balance (adjusted difference: ${money(Math.abs(T.adr - T.acr))})</span>`;
}

/* =====================================================
   9. FINANCIAL STATEMENTS (all entries, dates from your entries)
   ===================================================== */

// Net debit-minus-credit for one account, across all entries and adjustments
function netDrCr(accountId) {
  let net = 0;
  for (const e of state.entries) {
    for (const l of e.journal_lines) {
      if (l.account_id === accountId) net += toCents(l.debit) - toCents(l.credit);
    }
  }
  return net;
}

// Decide what an account IS for the statements. Names win over the saved type,
// so a wrongly typed account cannot distort net income or equity.
function roleOf(acct) {
  const n = acct.name;
  if (/accumulated\s+depreciation/i.test(n)) return 'contra-asset';  // never an expense
  if (/withdraw|drawing/i.test(n)) return 'drawings';                // owner withdrawals
  if (acct.type === 'Revenue') return 'revenue';
  if (acct.type === 'Expense') return 'expense';
  if (acct.type === 'Equity') return 'capital';
  return 'other';
}

// First and last entry dates, so headings follow your records (e.g. Dec 1 to Dec 31, 2024)
function entryRange() {
  const dates = state.entries.map(e => e.entry_date).sort();
  return dates.length
    ? { from: dates[0], to: dates[dates.length - 1] }
    : { from: '', to: '' };
}

function periodCaption(from, to) {
  if (!to) return '';
  const sameMonth = from && from.slice(0, 7) === to.slice(0, 7);
  return (sameMonth ? 'For the Month Ended ' : 'For the Period Ended ') + longDate(to);
}

// Label follows the result: "Net Income" when positive, "Net Loss" when negative
const netLabel = n => (n < 0 ? 'Net Loss' : 'Net Income');
function computeIncome() {
  const revenues = [];
  const expenses = [];
  for (const acct of state.accounts) {
    const role = roleOf(acct);
    const net = netDrCr(acct.id);
    if (role === 'revenue' && net) revenues.push({ acct, bal: -net });  // credits increase revenue
    if (role === 'expense' && net) expenses.push({ acct, bal: net });   // debits increase expenses
  }
  const totalRev = revenues.reduce((s, r) => s + r.bal, 0);
  const totalExp = expenses.reduce((s, r) => s + r.bal, 0);
  return { revenues, expenses, totalRev, totalExp, net: totalRev - totalExp };
}

function stmtHeader(title) {
  const { from, to } = entryRange();
  return `
    <div class="stmt-header">
      <h2>${COMPANY_LABEL}</h2>
      <h3>${title}</h3>
      <p>${esc(periodCaption(from, to))}</p>
    </div>`;
}

function renderIncome() {
  const box = $('#income-report');
  const { revenues, expenses, totalRev, totalExp, net } = computeIncome();

  if (!revenues.length && !expenses.length) {
    box.innerHTML = '<div class="empty">No revenue or expense activity yet.</div>';
    return;
  }

  const revRows = revenues.map(r => `
    <tr>
      <td>${esc(r.acct.name)}</td>
      <td class="amt"></td>
      <td class="amt">${signedMoney(r.bal)}</td>
    </tr>`).join('');
  const extraRev = revenues.length > 1 ? `
    <tr class="total-row">
      <td>Total Revenue</td>
      <td class="amt"></td>
      <td class="amt single">${signedMoney(totalRev)}</td>
    </tr>` : '';
  const expRows = expenses.map(r => `
    <tr>
      <td class="nested">${esc(r.acct.name)}</td>
      <td class="amt">${signedMoney(r.bal)}</td>
      <td class="amt"></td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="statement">
      ${stmtHeader('Statement of Income')}
      <table class="stmt-table">
        <tbody>
          ${revRows}
          ${extraRev}
          <tr><td class="section">Less: Operating Expenses</td><td class="amt"></td><td class="amt"></td></tr>
          ${expRows || '<tr><td class="nested">None</td><td class="amt">0.00</td><td class="amt"></td></tr>'}
          <tr class="total-row">
            <td></td>
            <td class="amt single">${signedMoney(totalExp)}</td>
            <td class="amt"></td>
          </tr>
          <tr class="net-row">
            <td>${netLabel(net)}</td>
            <td class="amt"></td>
            <td class="amt double ${net < 0 ? 'loss' : ''}">${signedMoney(net)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderEquity() {
  const box = $('#equity-report');

  if (!state.accounts.length) {
    box.innerHTML = '<div class="empty">Add equity accounts and transactions to build this statement.</div>';
    return;
  }

  let investment = 0;   // credit balances of capital accounts
  let withdrawal = 0;   // debit balances of drawings accounts
  for (const acct of state.accounts) {
    const role = roleOf(acct);
    const net = netDrCr(acct.id);
    if (role === 'capital') investment += -net;
    if (role === 'drawings') withdrawal += net;
  }

  const { net } = computeIncome();
  const niAndWd = net - withdrawal;
  const ending = investment + net - withdrawal;
  const { to } = entryRange();

  box.innerHTML = `
    <div class="statement">
      ${stmtHeader("Statement of Owner's Equity")}
      <table class="stmt-table">
        <tbody>
          <tr>
            <td>Add: ${OWNER_LABEL} Investment</td>
            <td class="amt"></td>
            <td class="amt">${signedMoney(investment)}</td>
          </tr>
          <tr>
            <td>${netLabel(net)}</td>
            <td class="amt"></td>
            <td class="amt ${net < 0 ? 'loss' : ''}">${signedMoney(net)}</td>
          </tr>
          <tr>
            <td>Less: Withdrawal</td>
            <td class="amt">${signedMoney(-withdrawal)}</td>
            <td class="amt"></td>
          </tr>
          <tr class="total-row">
            <td></td>
            <td class="amt single ${niAndWd < 0 ? 'loss' : ''}">${signedMoney(niAndWd)}</td>
            <td class="amt"></td>
          </tr>
          <tr class="net-row">
            <td>Capital, ${esc(longDate(to))}</td>
            <td class="amt"></td>
            <td class="amt double">${signedMoney(ending)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function renderPosition() {
  const box = $('#position-report');

  const assets = [];
  const liabilities = [];
  let investment = 0;   // credit balances of capital accounts
  let withdrawal = 0;   // debit balances of drawings accounts

  for (const acct of state.accounts) {
    const role = roleOf(acct);
    const net = netDrCr(acct.id);
    if (!net) continue;

    if (role === 'contra-asset' || (role === 'other' && acct.type === 'Asset')) {
      assets.push({ acct, bal: net });            // debits increase assets (contra shows negative)
    } else if (role === 'other' && acct.type === 'Liability') {
      liabilities.push({ acct, bal: -net });      // credits increase liabilities
    } else if (role === 'capital') {
      investment += -net;
    } else if (role === 'drawings') {
      withdrawal += net;
    }
  }

  if (!assets.length && !liabilities.length && !investment && !withdrawal) {
    box.innerHTML = '<div class="empty">No transactions yet. Record entries to build this statement.</div>';
    return;
  }

  const { net: income } = computeIncome();
  const ownerEquity = investment + income - withdrawal;
  const totalAssets = assets.reduce((s, r) => s + r.bal, 0);
  const totalLiab = liabilities.reduce((s, r) => s + r.bal, 0);
  const totalLiabEquity = totalLiab + ownerEquity;

  // The last item in a group gets a single underline before the total
  const itemRows = list => list.map((r, i) => `
    <tr>
      <td class="nested">${esc(r.acct.name)}</td>
      <td class="amt ${i === list.length - 1 ? 'single' : ''}">${signedMoney(r.bal)}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div class="statement">
      ${stmtHeader('Statement of Financial Position')}
      <table class="stmt-table">
        <tbody>
          <tr><td class="section">Assets</td><td class="amt"></td></tr>
          ${itemRows(assets)}
          <tr class="net-row">
            <td>Total Assets</td>
            <td class="amt double">${signedMoney(totalAssets)}</td>
          </tr>

          <tr><td class="section" style="padding-top:28px">Liabilities</td><td class="amt"></td></tr>
          ${itemRows(liabilities)}
          <tr class="total-row">
            <td>Total Liabilities</td>
            <td class="amt">${signedMoney(totalLiab)}</td>
          </tr>

          <tr><td class="section" style="padding-top:28px">Owner's Equity</td><td class="amt"></td></tr>
          <tr>
            <td class="nested">${OWNER_LABEL}, Capital</td>
            <td class="amt single">${signedMoney(ownerEquity)}</td>
          </tr>
          <tr class="net-row">
            <td>Total Liabilities &amp; Equity</td>
            <td class="amt double">${signedMoney(totalLiabEquity)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}
/* =====================================================
   10. START
   ===================================================== */
buildEntryForm('regular');
buildEntryForm('adjusting');