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
const state = { accounts: [], entries: [], period: { from: '', to: '' } };

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

// Show / hide password (only when the lock icon is clicked)
const pwInput = $('#password');
const pwToggle = $('#toggle-password');

function setPasswordVisible(show) {
  pwInput.type = show ? 'text' : 'password';
  pwToggle.classList.toggle('showing', show);
  pwToggle.setAttribute('aria-pressed', String(show));
  pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

pwToggle.addEventListener('click', () => {
  setPasswordVisible(pwInput.type === 'password');
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
    setTimeout(() => $('.tab[data-view="dashboard"]').click(), 0);
    setTimeout(loadAll, 0);
  } else {
    state.accounts = []; state.entries = [];
    $('#app').classList.add('hidden');
    $('#auth-screen').classList.remove('hidden');
    $('#password').value = '';
    setPasswordVisible(false); 
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
  renderCashFlow();
  renderDashboard();
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
      <td class="num">
        <button class="btn ghost" data-edit-acc="${a.id}">Edit</button>
        <button class="btn danger" data-del-acc="${a.id}">Delete</button>
      </td>
    </tr>`).join('');
}

let editingAccId = null;

function resetAccountForm() {
  editingAccId = null;
  $('#account-form').reset();
  $('#acc-submit').textContent = 'Add account';
  $('#acc-cancel').classList.add('hidden');
}

$('#account-form').addEventListener('submit', async e => {
  e.preventDefault();
  const type = $('#acc-type').value;
  const contra = $('#acc-contra').checked;
  let normal = NORMAL[type];
  if (contra) normal = normal === 'debit' ? 'credit' : 'debit';

  const payload = {
    code: $('#acc-code').value.trim(), name: $('#acc-name').value.trim(),
    type, normal_balance: normal,
    cash_flow_category: $('#acc-cf').value || null
  };

  const wasEditing = !!editingAccId;
  const { error } = wasEditing
    ? await sb.from('accounts').update(payload).eq('id', editingAccId)
    : await sb.from('accounts').insert(payload);

  if (error) return toast(error.code === '23505' ? 'That account code already exists.' : error.message, true);
  resetAccountForm();
  toast(wasEditing ? 'Account updated' : 'Account added');
  loadAll();
});

$('#acc-cancel').addEventListener('click', resetAccountForm);

$('#accounts-body').addEventListener('click', async e => {
  const id = e.target.dataset.delAcc;
  if (!id || !confirm('Delete this account?')) return;
  const { error } = await sb.from('accounts').delete().eq('id', id);
  if (error) return toast(error.code === '23503'
    ? 'This account is used in journal entries and cannot be deleted.' : error.message, true);
  toast('Account deleted');
  loadAll();
});

$('#accounts-body').addEventListener('click', e => {
  const id = e.target.dataset.editAcc;
  if (!id) return;
  const a = state.accounts.find(x => String(x.id) === id);
  if (!a) return;
  editingAccId = a.id;
  $('#acc-code').value = a.code;
  $('#acc-name').value = a.name;
  $('#acc-type').value = a.type;
  $('#acc-cf').value = a.cash_flow_category || '';
  $('#acc-contra').checked = isContra(a);
  $('#acc-submit').textContent = 'Save changes';
  $('#acc-cancel').classList.remove('hidden');
  $('#account-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
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

const entryForms = {};   // lets the Edit buttons reach each form

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
    <div class="row" style="margin-top:16px">
      <button type="button" class="btn primary e-save">Save entry</button>
      <button type="button" class="btn ghost e-cancel hidden">Cancel edit</button>
    </div>`;

  const linesBody = $('.e-lines', root);
  let editingId = null;   // set while you are editing an existing entry

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
    editingId = null;
    $('.e-save', root).disabled = false;
    $('.e-date', root).value = todayStr();
    $('.e-desc', root).value = '';
    linesBody.innerHTML = '';
    addLine(); addLine();
    updateTotals();
    $('.e-save', root).textContent = 'Save entry';
    $('.e-cancel', root).classList.add('hidden');
  }

  function load(entry) {
    editingId = entry.id;
    $('.e-date', root).value = entry.entry_date;
    $('.e-desc', root).value = entry.description;
    linesBody.innerHTML = '';
    [...entry.journal_lines]
      .sort((a, b) => (b.debit > 0) - (a.debit > 0))
      .forEach(l => {
        addLine();
        const tr = linesBody.lastElementChild;
        $('.acct-select', tr).value = l.account_id;
        if (l.debit > 0) $('.dr', tr).value = (toCents(l.debit) / 100).toFixed(2);
        if (l.credit > 0) $('.cr', tr).value = (toCents(l.credit) / 100).toFixed(2);
      });
    while (linesBody.children.length < 2) addLine();
    updateTotals();
    $('.e-save', root).textContent = 'Update entry';
    $('.e-cancel', root).classList.remove('hidden');
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('.e-cancel', root).addEventListener('click', reset);
  $('.e-add', root).addEventListener('click', addLine);

$('.e-save', root).addEventListener('click', async () => {
  const saveBtn = $('.e-save', root);
  if (saveBtn.disabled) return;
  const date = $('.e-date', root).value;
  const desc = $('.e-desc', root).value.trim();
  if (!date) return toast('Please choose a date.', true);
  if (!desc) return toast('Please enter a description.', true);

  const lines = [];
  for (const tr of linesBody.querySelectorAll('tr')) {
    const acct = $('.acct-select', tr).value;
    const dr = toCents($('.dr', tr).value), cr = toCents($('.cr', tr).value);
        if (dr < 0 || cr < 0) return toast('Amounts cannot be negative.', true);
    if (!acct && !dr && !cr) continue;                       // skip blank rows
    if (!acct) return toast('Every line with an amount needs an account.', true);
    if (!dr && !cr) return toast('Every line needs a debit or credit.', true);
    lines.push({ account_id: acct, debit: dr / 100, credit: cr / 100 });
  }
  if (lines.length < 2) return toast('An entry needs at least two lines.', true);
  const { dr, cr } = updateTotals();
  if (dr !== cr) return toast('Debits must equal credits.', true);

    // Warn about an identical entry, then lock the button
  const sig = ls => ls.map(l => `${l.account_id}|${toCents(l.debit)}|${toCents(l.credit)}`).sort().join(';');
  const mySig = sig(lines);
  const dup = state.entries.some(e =>
    e.id !== editingId && e.kind === kind && e.entry_date === date &&
    e.description.trim().toLowerCase() === desc.toLowerCase() &&
    sig(e.journal_lines) === mySig);
  if (dup && !confirm('An identical entry already exists. Save it anyway?')) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const wasEditing = editingId;
  const { error } = await sb.rpc('save_entry', {
    p_date: date, p_description: desc, p_kind: kind, p_lines: lines
  });
  if (error) {
    saveBtn.disabled = false;
    saveBtn.textContent = wasEditing ? 'Update entry' : 'Save entry';
    return toast(error.message, true);
  }

  if (wasEditing) {
    const del = await sb.from('journal_entries').delete().eq('id', wasEditing);
    if (del.error) { reset(); loadAll();
      return toast('Updated version saved, but the old copy could not be deleted.', true); }
  }
  toast(wasEditing ? 'Entry updated' : kind === 'regular' ? 'Journal entry saved' : 'Adjusting entry saved');
  reset();
  loadAll();
});

  reset();   // start with a date and two blank lines
  entryForms[kind] = { load };
}

function renderEntries(kind) {
  const box = $(kind === 'regular' ? '#journal-list' : '#adjust-list');
  const list = state.entries.filter(e => e.kind === kind && inRange(e));
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
          <div style="display:flex;gap:8px">
            <button class="btn ghost" data-edit-entry="${e.id}">Edit</button>
            <button class="btn danger" data-del-entry="${e.id}">Delete</button>
          </div>
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

[['#journal-list', 'regular'], ['#adjust-list', 'adjusting']].forEach(([sel, kind]) => {
  $(sel).addEventListener('click', e => {
    const id = e.target.dataset.editEntry;
    if (!id) return;
    const entry = state.entries.find(x => String(x.id) === id);
    if (entry) entryForms[kind].load(entry);
  });
});

/* =====================================================
   8. TRIAL BALANCE (all entries, no date filter)
   ===================================================== */
function computeTrial() {
  const rows = new Map(state.accounts.map(a =>
    [a.id, { acct: a, unadj: 0, adjDr: 0, adjCr: 0 }]));

  for (const entry of state.entries) {
    if (!inRange(entry, 'period')) continue;
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

// mode: 'period' = From..To, 'before' = earlier than From, 'upto' = everything up to To
function inRange(e, mode = 'period') {
  const { from, to } = state.period;
  if (mode === 'before') return !!from && e.entry_date < from;      // earlier than From
  if (mode === 'upto')   return !to || e.entry_date <= to;          // everything up to To
  return (!from || e.entry_date >= from) && (!to || e.entry_date <= to);
}

// Net debit-minus-credit for one account, across all entries and adjustments
function netDrCr(accountId, mode = 'period') {
  let net = 0;
  for (const e of state.entries) {
    if (!inRange(e, mode)) continue;
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
  // Contra-assets: ticked "Contra account" on an Asset, or named Accumulated Depreciation
  if (/accumulated\s+depreciation/i.test(n) || (acct.type === 'Asset' && isContra(acct))) return 'contra-asset';
  // Drawings: only Equity accounts (ticked Contra, or named withdrawal/drawing)
  if (acct.type === 'Equity' && (isContra(acct) || /withdraw|drawing/i.test(n))) return 'drawings';
  if (acct.type === 'Revenue') return 'revenue';
  if (acct.type === 'Expense') return 'expense';
  if (acct.type === 'Equity') return 'capital';
  return 'other';
}

function cfCategory(a) {
  if (a.cash_flow_category) return a.cash_flow_category;
  const n = a.name, role = roleOf(a);
  if (a.type === 'Asset' && role === 'other' && /\b(cash|bank|checking|savings|gcash|maya)\b/i.test(n)) return 'cash';
  if (role === 'drawings' || role === 'capital') return 'financing';
  if (a.type === 'Liability' && /loan|note|mortgage|bond/i.test(n)) return 'financing';
  if (role === 'contra-asset' ||
      (a.type === 'Asset' && /equipment|furniture|fixture|building|land|vehicle|machinery|property|computer/i.test(n))) return 'investing';
  return 'operating';
}

// First and last entry dates, so headings follow your records (e.g. Dec 1 to Dec 31, 2024)
function entryRange() {
  const dates = state.entries.filter(e => inRange(e, 'period')).map(e => e.entry_date).sort();
  return {
    from: state.period.from || dates[0] || '',
    to:   state.period.to   || dates[dates.length - 1] || ''
  };
}

function periodCaption(from, to) {
  if (!to) return '';
  const sameMonth = from && from.slice(0, 7) === to.slice(0, 7);
  return (sameMonth ? 'For the Month Ended ' : 'For the Period Ended ') + longDate(to);
}

// Label follows the result: "Net Income" when positive, "Net Loss" when negative
const netLabel = n => (n < 0 ? 'Net Loss' : 'Net Income');
function computeIncome(mode = 'period') {
  const revenues = [];
  const expenses = [];
  for (const acct of state.accounts) {
    const role = roleOf(acct);
    const net = netDrCr(acct.id, mode);
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

  if (!state.accounts.length || !state.entries.some(e => inRange(e))) {
    box.innerHTML = '<div class="empty">No transactions in this period.</div>';
    return;
  }

  let beginning = 0, investment = 0, withdrawal = 0, priorWithdrawal = 0;
  for (const acct of state.accounts) {
    const role = roleOf(acct);
    if (role === 'capital') {
      const before = -netDrCr(acct.id, 'before');   // capital from earlier periods
      const during = -netDrCr(acct.id, 'period');
      beginning += before;
      if (/beginning|opening/i.test(acct.name)) beginning += during;
      else investment += during;
    }
    if (role === 'drawings') {
      withdrawal += netDrCr(acct.id, 'period');
      priorWithdrawal += netDrCr(acct.id, 'before');
    }
  }
  // Earlier periods' profit and withdrawals roll into beginning capital
  beginning += computeIncome('before').net - priorWithdrawal;

  const { net } = computeIncome();
  const niAndWd = net - withdrawal;
  const ending = beginning + investment + net - withdrawal;
  const { to } = entryRange();

  box.innerHTML = `
    <div class="statement">
      ${stmtHeader("Statement of Owner's Equity")}
      <table class="stmt-table">
        <tbody>
          <tr>
            <td>${OWNER_LABEL}, Capital, Beginning</td>
            <td class="amt"></td>
            <td class="amt">${signedMoney(beginning)}</td>
          </tr>
          <tr>
            <td>Add: ${OWNER_LABEL} Investment</td>
            <td class="amt"></td>
            <td class="amt">${signedMoney(investment)}</td>
          </tr>
          <tr>
            <td class="nested">${netLabel(net)}</td>
            <td class="amt ${net < 0 ? 'loss' : ''}">${signedMoney(net)}</td>
            <td class="amt"></td>
          </tr>
          <tr>
            <td class="nested">Less: Withdrawal</td>
            <td class="amt single">${signedMoney(withdrawal)}</td>
            <td class="amt"></td>
          </tr>
          <tr>
            <td>Net ${niAndWd < 0 ? 'Decrease' : 'Increase'} in Capital</td>
            <td class="amt"></td>
            <td class="amt single ${niAndWd < 0 ? 'loss' : ''}">${signedMoney(niAndWd)}</td>
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
    const net = netDrCr(acct.id, 'upto');        // inside the for loop
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

  const { net: income } = computeIncome('upto');
  const ownerEquity = investment + income - withdrawal;
  const totalAssets = assets.reduce((s, r) => s + r.bal, 0);
  const totalLiab = liabilities.reduce((s, r) => s + r.bal, 0);
  const totalLiabEquity = totalLiab + ownerEquity;
  const diff = totalAssets - totalLiabEquity;
  const checkBadge = diff === 0
    ? '<span class="badge ok">✓ Balanced</span>'
    : `<span class="badge bad">✗ Off by ₱${money(Math.abs(diff))}</span>`;

  // The last item in a group gets a single underline before the total
  const itemRows = list => list.map((r, i) => `
    <tr>
      <td class="nested">${esc(r.acct.name)}</td>
      <td class="amt ${i === list.length - 1 ? 'single' : ''}">${signedMoney(r.bal)}</td>
    </tr>`).join('');

  box.innerHTML = `
    <div style="margin-bottom:12px">${checkBadge}</div>
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

function renderCashFlow() {
  const box = $('#cashflow-report');
  const byId = new Map(state.accounts.map(a => [a.id, a]));
  const isCash = a => cfCategory(a) === 'cash';

  let receipts = 0, suppliers = 0, salaries = 0;
  const investing = new Map();
  const financing = new Map();
  const bump = (map, key, c) => map.set(key, (map.get(key) || 0) + c);
  let touched = false;

  for (const entry of state.entries) {
    if (!inRange(entry, 'period')) continue;
    const lines = entry.journal_lines;
    if (!lines.some(l => { const a = byId.get(l.account_id); return a && isCash(a); })) continue;
    touched = true;

    // Non-cash lines: credit = cash came in, debit = cash went out
    const eff = [];
    let pos = 0, neg = 0;
    for (const l of lines) {
      const acct = byId.get(l.account_id);
      if (!acct || isCash(acct)) continue;
      const c = toCents(l.credit) - toCents(l.debit);
      if (!c) continue;
      eff.push({ acct, c });
      if (c > 0) pos += c; else neg += -c;
    }

    // Remove the part with no cash (e.g. equipment bought with a loan)
    const offset = Math.min(pos, neg);
    for (const e of eff) {
      if (e.c > 0) e.c = pos ? Math.round(e.c * (pos - offset) / pos) : 0;
      else         e.c = neg ? -Math.round(-e.c * (neg - offset) / neg) : 0;
    }
    const drift = (pos - neg) - eff.reduce((s, e) => s + e.c, 0);   // fix rounding
    const first = eff.find(e => e.c);
    if (first) first.c += drift;

    // Classify using the account's cash flow category
    for (const { acct, c } of eff) {
      if (!c) continue;
      const cat = cfCategory(acct), role = roleOf(acct), n = acct.name;
      if (cat === 'financing')
        bump(financing, role === 'drawings' ? "Owner's withdrawal" : role === 'capital' ? 'Investment by owner' : n, c);
      else if (cat === 'investing') bump(investing, n, c);
      else if (role === 'revenue' || /receivable|unearned/i.test(n) || c > 0) receipts += c;
      else if (/salar|wage/i.test(n)) salaries += c;
      else suppliers += c;
    }
  }

  if (!touched) {
    box.innerHTML = '<div class="empty">No cash transactions in this period. Record entries that involve a cash account.</div>';
    return;
  }

  const sumMap = m => [...m.values()].reduce((s, v) => s + v, 0);
  const payments = [];
  if (suppliers) payments.push({ label: 'Cash paid to suppliers', bal: suppliers });
  if (salaries)  payments.push({ label: 'Cash paid for salaries', bal: salaries });
  if (!payments.length) payments.push({ label: 'None', bal: 0 });
  const totalPay = suppliers + salaries;

  const operating = receipts + totalPay;
  const invTotal = sumMap(investing);
  const finTotal = sumMap(financing);
  const netChange = operating + invTotal + finTotal;
  const beginning = state.accounts.filter(isCash).reduce((s, a) => s + netDrCr(a.id, 'before'), 0);
  const ending = beginning + netChange;
  const { to } = entryRange();

  const E = '<td class="amt"></td>';

  const payRows = payments.map((p, i) => {
    const last = i === payments.length - 1;
    return `
      <tr>
        <td class="nested">${p.label}</td>
        <td class="amt ${last ? 'single' : ''}">${signedMoney(p.bal)}</td>
        ${last ? `<td class="amt single">${signedMoney(totalPay)}</td>` : E}
        ${E}
      </tr>`;
  }).join('');

  const invLabel = (name, c) => (c < 0 ? 'Cash paid for ' : 'Cash received from ') + esc(name.toLowerCase());
  const invList = [...investing].filter(([, c]) => c);
  const invRows = !invList.length
    ? `<tr><td class="nested">None</td>${E}${E}<td class="amt">0.00</td></tr>`
    : invList.length === 1
      ? `<tr><td class="nested">${invLabel(invList[0][0], invList[0][1])}</td>${E}${E}<td class="amt">${signedMoney(invList[0][1])}</td></tr>`
      : invList.map(([name, c], i) => `
          <tr><td class="nested">${invLabel(name, c)}</td>
          <td class="amt ${i === invList.length - 1 ? 'single' : ''}">${signedMoney(c)}</td>${E}${E}</tr>`).join('') + `
          <tr class="total-row"><td>Net cash from investing activities</td>${E}${E}<td class="amt">${signedMoney(invTotal)}</td></tr>`;

  const finList = [...financing].filter(([, c]) => c);
  const finRows = (finList.length ? finList : [['None', 0]]).map(([name, c], i, arr) => `
    <tr><td class="nested">${esc(name)}</td>
    <td class="amt ${i === arr.length - 1 ? 'single' : ''}">${signedMoney(c)}</td>${E}${E}</tr>`).join('');

  box.innerHTML = `
    <div class="statement">
      ${stmtHeader('Statement of Cash Flows')}
      <table class="stmt-table">
        <tbody>
          <tr><td class="section">Cash from Operating Activities</td>${E}${E}${E}</tr>
          <tr><td class="section" style="padding-top:4px">Cash Receipts</td>${E}${E}${E}</tr>
          <tr><td class="nested">Cash receipts from customers</td>${E}<td class="amt">${signedMoney(receipts)}</td>${E}</tr>
          <tr><td class="section">Cash Payments</td>${E}${E}${E}</tr>
          ${payRows}
          <tr class="total-row"><td>Net cash from operating activities</td>${E}${E}<td class="amt">${signedMoney(operating)}</td></tr>

          <tr><td class="section" style="padding-top:28px">Cash from Investing Activities</td>${E}${E}${E}</tr>
          ${invRows}

          <tr><td class="section" style="padding-top:28px">Cash from Financing Activities</td>${E}${E}${E}</tr>
          ${finRows}
          <tr class="total-row"><td>Net cash from financing activities</td>${E}${E}<td class="amt single">${signedMoney(finTotal)}</td></tr>

          <tr class="net-row"><td>Net ${netChange < 0 ? 'Decrease' : 'Increase'} in Cash</td>${E}${E}<td class="amt single ${netChange < 0 ? 'loss' : ''}">${signedMoney(netChange)}</td></tr>
          <tr><td>Cash, Beginning</td>${E}${E}<td class="amt single">${signedMoney(beginning)}</td></tr>
          <tr class="net-row"><td>Cash, Ending (${esc(longDate(to))})</td>${E}${E}<td class="amt double">${signedMoney(ending)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

/* =====================================================
   DASHBOARD
   ===================================================== */
function renderDashboard() {
  const peso = c => (c < 0 ? '-' : '') + '₱' + money(Math.abs(c));
  const byId = new Map(state.accounts.map(a => [a.id, a]));

  /* ---- A. Financial summary cards ---- */
  // Same cash-account rule used in the cash flow statement
  const isCash = a => cfCategory(a) === 'cash';
  const cash = state.accounts.filter(isCash).reduce((s, a) => s + netDrCr(a.id, 'upto'), 0);
  const { totalRev, totalExp, net } = computeIncome();

  const stats = [
    ['Cash Balance', cash],
    ['Total Revenue', totalRev],
    ['Total Expenses', totalExp],
    [netLabel(net), net]
  ];
  $('#dash-cards').innerHTML = stats.map(([label, c]) => `
    <div class="card dash-stat">
      <span>${label}</span>
      <strong class="${c < 0 ? 'loss' : ''}">${peso(c)}</strong>
    </div>`).join('');

  /* ---- B. Revenue vs. Expenses by month ---- */
  const pie = $('#dash-chart');
  const rev = Math.max(0, totalRev);
  const exp = Math.max(0, totalExp);
  const pieTotal = rev + exp;

  if (pieTotal <= 0) {
    pie.innerHTML = '<div class="empty">No revenue or expense activity yet.</div>';
  } else {
    const revPct = rev / pieTotal * 100;
    const pct = v => (v / pieTotal * 100).toFixed(1) + '%';
    pie.innerHTML = `
  <div class="dash-pie"
       style="background:conic-gradient(#ffee00 0 ${revPct}%, #000000 ${revPct}% 100%)"
       title="Revenue ${pct(rev)} / Expenses ${pct(exp)}"></div>
  <div class="dash-pie-legend">
    <div><i class="l-rev"></i><span>Revenue</span><strong>${peso(rev)}</strong><em>${pct(rev)}</em></div>
    <div><i class="l-exp"></i><span>Expenses</span><strong>${peso(exp)}</strong><em>${pct(exp)}</em></div>
  </div>`;
  }

  /* ---- C. Accounting overview ---- */
  const nReg = state.entries.filter(e => e.kind === 'regular' && inRange(e)).length;
  const nAdj = state.entries.filter(e => e.kind === 'adjusting' && inRange(e)).length;
  $('#dash-overview').innerHTML = [
    ['Total Chart of Accounts', state.accounts.length],
    ['Total Business Transactions', nReg],
    ['Total Adjusting Entries', nAdj]
  ].map(([label, n]) => `
    <div class="dash-ov"><span>${label}</span><strong>${n}</strong></div>`).join('');

  /* ---- D. Recent transactions (latest 3 entries, journal and adjustments) ---- */
  // state.entries is already sorted by entry date, then by time created
  const recent = state.entries.filter(e => inRange(e)).slice(-3).reverse();
  if (!recent.length) {
    $('#dash-recent').innerHTML = '<div class="empty">No transactions recorded yet.</div>';
  } else {
    $('#dash-recent').innerHTML = `
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>${recent.map(e => {
          // Total of the debit side only; the credit side is the same amount
          const total = e.journal_lines.reduce((s, l) => s + toCents(l.debit), 0);
          const date = new Date(e.entry_date + 'T00:00:00')
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          const isAdj = e.kind === 'adjusting';
          return `<tr>
            <td class="dash-date">${date}</td>
            <td><span class="pill dash-kind ${isAdj ? 'adj' : ''}">${isAdj ? 'Adjustment' : 'Journal'}</span></td>
            <td class="dash-desc">${esc(e.description)}</td>
            <td class="num"><strong>${peso(total)}</strong></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  /* ---- E. Trial balance status (adjusted columns) ---- */
  const tb = computeTrial();
  const dr = tb.reduce((s, r) => s + r.a.dr, 0);
  const cr = tb.reduce((s, r) => s + r.a.cr, 0);
  let badge;
  if (!tb.length)    badge = '<span class="badge">No transactions yet</span>';
  else if (dr === cr) badge = '<span class="badge ok">✓ Balanced</span>';
  else               badge = `<span class="badge bad">Out of Balance by ${peso(Math.abs(dr - cr))}</span>`;

  $('#dash-trial').innerHTML = `
    <div class="dash-tb-badge">${badge}</div>
    <div class="dash-tb-row"><span>Total Debits</span><strong>${peso(dr)}</strong></div>
    <div class="dash-tb-row"><span>Total Credits</span><strong>${peso(cr)}</strong></div>`;
}

/* =====================================================
   10. START
   ===================================================== */
function applyPeriod() {
  const from = $('#period-from').value, to = $('#period-to').value;
  if (from && to && from > to) return toast('"From" cannot be later than "To".', true);
  state.period = { from, to };
  renderAll();
}
$('#period-from').addEventListener('change', applyPeriod);
$('#period-to').addEventListener('change', applyPeriod);
$('#period-clear').addEventListener('click', () => {
  $('#period-from').value = ''; $('#period-to').value = '';
  applyPeriod();
});
buildEntryForm('regular');
buildEntryForm('adjusting');