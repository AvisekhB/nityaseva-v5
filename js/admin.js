import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allData = { seniors: [], workOrders: [], staff: [], doctors: [], families: [], familyLinks: [], subscriptions: [], entitlements: [], appointments: [], reviews: [], logs: [] };
let practitionerList = [];
let sortState = {};

async function init() {
  setupTabs();

  currentProfile = await requireAuth('admin');
  if (!currentProfile) return;

  document.getElementById('user-display').textContent = currentProfile.full_name || currentProfile.email || 'Admin';
  document.getElementById('btn-logout').addEventListener('click', signOut);

  const dateInput = document.getElementById('wo-scheduled-at');
  if (dateInput) {
    const d = new Date(Date.now() + 3600000);
    dateInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  const aptDateInput = document.getElementById('apt-scheduled-at');
  if (aptDateInput) {
    const d2 = new Date(Date.now() + 3600000);
    aptDateInput.value = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  setupSearchableStaffDropdown();
  await loadAdminDashboard();
}

function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const contents = document.querySelectorAll('.tab-content');
  tabs.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabs.forEach(b => b.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const target = document.getElementById(e.currentTarget.getAttribute('data-tab'));
      if (target) target.classList.add('active');
    });
  });
}

async function loadAdminDashboard() {
  try {
    const data = await callApi('getAdminDashboard');
    allData = data;

    practitionerList = [
      ...(data.staff || []).map(s => ({ id: s.staff_id, name: s.full_name, type: 'Nurse' })),
      ...(data.doctors || []).map(d => ({ id: d.doctor_id, name: d.full_name, type: 'Doctor' }))
    ];

    populateSeniorDropdowns(data.seniors || []);

    renderWorkOrders(data.workOrders || []);
    renderSeniors(data.seniors || []);
    renderFamilies(data.families || [], data.familyLinks || []);
    renderStaff(data.staff || []);
    renderDoctors(data.doctors || []);
    renderSubscriptions(data.subscriptions || []);
    renderEntitlements(data.entitlements || []);
    renderAppointments((data.appointments || []).filter(a => a.type === 'DoctorConsult'));
    renderReviews(data.reviews || []);
    renderAudit(data.logs || []);

    setupAllColumnSorting();
    wireAllSearchBoxes();

  } catch (err) {
    console.error('Dashboard load error:', err);
    alert('Dashboard load error: ' + err.message);
  }
}

function getSeniorName(id) {
  const s = (allData.seniors || []).find(x => x.senior_id === id);
  return s ? s.full_name : id;
}

function getStaffName(id) {
  if (!id) return '<span style="color:#a0aec0;">Unassigned</span>';
  const p = practitionerList.find(x => x.id === id);
  if (!p) return id;
  return p.type === 'Doctor' ? `🩺 Dr. ${p.name}` : `👩‍⚕️ ${p.name}`;
}

function populateSeniorDropdowns(seniors) {
  const subDropdown = document.getElementById('sub-senior-id');
  const aptDropdown = document.getElementById('apt-senior-id');

  const buildOptions = () => {
    let html = '<option value="">-- Choose Senior --</option>';
    seniors.forEach(s => {
      html += `<option value="${s.senior_id}">${s.full_name} (${s.senior_id})</option>`;
    });
    return html;
  };

  if (subDropdown) {
    const currentVal = subDropdown.value;
    subDropdown.innerHTML = buildOptions();
    if (currentVal) subDropdown.value = currentVal;
  }
  if (aptDropdown) {
    const currentVal = aptDropdown.value;
    aptDropdown.innerHTML = buildOptions();
    if (currentVal) aptDropdown.value = currentVal;
  }
}

// ===== Searchable Staff/Doctor Dropdown =====
function setupSearchableStaffDropdown() {
  const searchInput = document.getElementById('wo-staff-search');
  const hiddenInput = document.getElementById('wo-staff-id');
  const suggestionsBox = document.getElementById('wo-staff-suggestions');

  if (!searchInput || !hiddenInput || !suggestionsBox) return;

  function renderSuggestions(query) {
    const q = query.trim().toLowerCase();
    const matches = practitionerList.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));

    if (matches.length === 0) {
      suggestionsBox.innerHTML = '<div class="suggestion-empty">No matching staff/doctor found</div>';
    } else {
      suggestionsBox.innerHTML = matches.map(p => `
        <div class="suggestion-item" data-id="${p.id}" data-name="${p.name}" data-type="${p.type}">
          ${p.type === 'Doctor' ? 'Dr. ' + p.name : p.name}
          <span class="tag ${p.type === 'Doctor' ? 'badge-doctor-consult' : 'badge-nurse-visit'}">${p.type}</span>
        </div>
      `).join('');
    }
    suggestionsBox.classList.add('open');
  }

  searchInput.addEventListener('focus', () => renderSuggestions(searchInput.value));
  searchInput.addEventListener('input', () => {
    hiddenInput.value = '';
    renderSuggestions(searchInput.value);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown')) {
      suggestionsBox.classList.remove('open');
    }
  });

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    const name = item.getAttribute('data-name');
    const type = item.getAttribute('data-type');
    hiddenInput.value = id;
    searchInput.value = (type === 'Doctor' ? 'Dr. ' : '') + name + ' (' + id + ')';
    suggestionsBox.classList.remove('open');
  });
}

// ===== Generic Column-Header Click-to-Sort =====
function makeSortable(tableId, dataGetter, renderFn, extractors) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const ths = table.querySelectorAll('thead th[data-key]');
  ths.forEach(th => {
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    if (!th.querySelector('.sort-arrow')) {
      th.innerHTML = th.textContent.trim() + ' <span class="sort-arrow">⇕</span>';
    }

    // Remove old listener by cloning (prevents duplicate bindings on re-render)
    const freshTh = th;
    freshTh.onclick = () => {
      const col = freshTh.getAttribute('data-key');
      if (!sortState[tableId] || sortState[tableId].col !== col) {
        sortState[tableId] = { col: col, dir: 'asc' };
      } else {
        sortState[tableId].dir = sortState[tableId].dir === 'asc' ? 'desc' : 'asc';
      }

      ths.forEach(h => {
        const arrow = h.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '⇕';
      });
      const activeArrow = freshTh.querySelector('.sort-arrow');
      if (activeArrow) activeArrow.textContent = sortState[tableId].dir === 'asc' ? '▲' : '▼';

      const data = [...dataGetter()];
      const extractor = extractors[col] || (row => row[col]);
      data.sort((a, b) => {
        const va = extractor(a);
        const vb = extractor(b);
        let cmp;
        if (typeof va === 'number' && typeof vb === 'number') {
          cmp = va - vb;
        } else {
          cmp = String(va || '').localeCompare(String(vb || ''));
        }
        return sortState[tableId].dir === 'asc' ? cmp : -cmp;
      });
      renderFn(data);
    };
  });
}

function setupAllColumnSorting() {
  makeSortable('admin-wo-table', () => allData.workOrders || [], renderWorkOrders, {
    work_order_id: r => r.work_order_id,
    senior: r => getSeniorName(r.senior_id),
    type: r => r.type,
    created_at: r => r.created_at || '',
    status: r => r.status
  });

  makeSortable('admin-seniors-table', () => allData.seniors || [], renderSeniors, {
    senior_id: r => r.senior_id,
    full_name: r => r.full_name,
    phone: r => r.phone || '',
    email: r => r.email || '',
    address: r => r.address || '',
    status: r => r.status || ''
  });

  makeSortable('admin-families-table', () => allData.families || [], (f) => renderFamilies(f, allData.familyLinks || []), {
    family_id: r => r.family_id,
    full_name: r => r.full_name,
    relationship: r => r.relationship || '',
    email: r => r.email || '',
    phone: r => r.phone || ''
  });

  makeSortable('admin-staff-table', () => allData.staff || [], renderStaff, {
    staff_id: r => r.staff_id,
    full_name: r => r.full_name,
    role: r => r.role || '',
    email: r => r.email || '',
    phone: r => r.phone || '',
    status: r => r.status || ''
  });

  makeSortable('admin-doctors-table', () => allData.doctors || [], renderDoctors, {
    doctor_id: r => r.doctor_id,
    full_name: r => r.full_name,
    specialty: r => r.specialty || '',
    email: r => r.email || '',
    phone: r => r.phone || '',
    status: r => r.status || ''
  });

  makeSortable('admin-subs-table', () => allData.subscriptions || [], renderSubscriptions, {
    subscription_id: r => r.subscription_id,
    senior: r => getSeniorName(r.senior_id),
    plan_name: r => r.plan_name || '',
    nurse_visits_per_month: r => Number(r.nurse_visits_per_month || 0),
    doctor_consults_per_month: r => Number(r.doctor_consults_per_month || 0),
    status: r => r.status || ''
  });

  makeSortable('admin-entitlements-table', () => allData.entitlements || [], renderEntitlements, {
    senior: r => getSeniorName(r.senior_id),
    month: r => r.month || '',
    nurse_used: r => Number(r.nurse_used || 0),
    doctor_used: r => Number(r.doctor_used || 0)
  });

  makeSortable('admin-apts-table', () => (allData.appointments || []).filter(a => a.type === 'DoctorConsult'), renderAppointments, {
    appointment_id: r => r.appointment_id,
    senior: r => getSeniorName(r.senior_id),
    scheduled_at: r => r.scheduled_at || '',
    status: r => r.status || ''
  });
}

// ===== Search Boxes (filter without needing asc/desc buttons) =====
function wireAllSearchBoxes() {
  const map = [
    ['search-wo', () => allData.workOrders || [], renderWorkOrders],
    ['search-seniors', () => allData.seniors || [], renderSeniors],
    ['search-families', () => allData.families || [], (f) => renderFamilies(f, allData.familyLinks || [])],
    ['search-staff', () => allData.staff || [], renderStaff],
    ['search-doctors', () => allData.doctors || [], renderDoctors],
    ['search-subs', () => allData.subscriptions || [], renderSubscriptions],
    ['search-ent', () => allData.entitlements || [], renderEntitlements],
    ['search-apts', () => (allData.appointments || []).filter(a => a.type === 'DoctorConsult'), renderAppointments]
  ];

  map.forEach(([inputId, getData, renderFn]) => {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.bound) return;
    input.dataset.bound = 'true';
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const filtered = getData().filter(row => JSON.stringify(row).toLowerCase().includes(q));
      renderFn(filtered);
    });
  });
}

// ===== Render Functions
function renderWorkOrders(orders) {
  const tbody = document.querySelector('#admin-wo-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No work orders recorded yet.</td></tr>';
    return;
  }
  orders.forEach(wo => {
    const tr = document.createElement('tr');
    const isClosed = (wo.status === 'COMPLETE' || wo.status === 'CLOSE');
    const badgeColor = isClosed ? 'badge-complete' : (wo.status === 'IN_PROGRESS' ? 'badge-in-progress' : 'badge-scheduled');
    const typeBadge = wo.type === 'DoctorConsult' ? 'badge-doctor-consult' : 'badge-nurse-visit';

    let displayTime = '-';
    if (wo.created_at) {
      try { displayTime = new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { displayTime = wo.created_at; }
    }
    const canCancel = wo.status !== 'CANCELLED' && !isClosed;

    tr.innerHTML = `
      <td><strong>${wo.work_order_id}</strong></td>
      <td>${getSeniorName(wo.senior_id)}</td>
      <td><span class="badge ${typeBadge}">${wo.type}</span></td>
      <td>${displayTime}</td>
      <td><span class="badge ${badgeColor}">${wo.status}</span></td>
      <td>${canCancel ? `<button class="override-btn danger" data-id="${wo.work_order_id}">Cancel</button>` : `<span style="color:#a0aec0;font-size:12px;">Locked</span>`}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.override-btn').forEach(btn => {
    btn.onclick = async () => {
      const woId = btn.getAttribute('data-id');
      const reason = prompt('Enter override/cancellation reason:');
      if (!reason) return;
      try {
        await callApi('adminOverrideWorkOrder', { workOrderId: woId, newStatus: 'CANCELLED', reason: reason });
        alert('Work Order cancelled successfully.');
        await loadAdminDashboard();
      } catch (err) {
        alert('Override failed: ' + err.message);
      }
    };
  });
}

function renderSeniors(seniors) {
  const tbody = document.querySelector('#admin-seniors-table tbody');
  if (!tbody) return;
  tbody.innerHTML = seniors.length === 0 ? '<tr><td colspan="6">No seniors registered yet.</td></tr>' :
    seniors.map(s => `<tr><td><strong>${s.senior_id}</strong></td><td>${s.full_name}</td><td>${s.phone || '-'}</td><td>${s.email || '-'}</td><td>${s.address || '-'}</td><td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td></tr>`).join('');
}

function renderFamilies(families, links) {
  const tbody = document.querySelector('#admin-families-table tbody');
  if (!tbody) return;
  tbody.innerHTML = families.length === 0 ? '<tr><td colspan="6">No families recorded.</td></tr>' :
    families.map(f => {
      const link = links.find(l => l.family_id === f.family_id);
      return `<tr><td><strong>${f.family_id}</strong></td><td>${f.full_name}</td><td>${f.relationship || '-'}</td><td>${link ? `<code>${link.senior_id}</code>` : '<em>Unlinked</em>'}</td><td>${f.email || '-'}</td><td>${f.phone || '-'}</td></tr>`;
    }).join('');
}

function renderStaff(staff) {
  const tbody = document.querySelector('#admin-staff-table tbody');
  if (!tbody) return;
  tbody.innerHTML = staff.length === 0 ? '<tr><td colspan="6">No staff recorded.</td></tr>' :
    staff.map(st => `<tr><td><strong>${st.staff_id}</strong></td><td>${st.full_name}</td><td>${st.role}</td><td>${st.email}</td><td>${st.phone || '-'}</td><td><span class="badge badge-complete">${st.status}</span></td></tr>`).join('');
}

function renderDoctors(doctors) {
  const tbody = document.querySelector('#admin-doctors-table tbody');
  if (!tbody) return;
  tbody.innerHTML = doctors.length === 0 ? '<tr><td colspan="6">No doctors recorded.</td></tr>' :
    doctors.map(d => `<tr><td><strong>${d.doctor_id}</strong></td><td>${d.full_name}</td><td>${d.specialty || 'General'}</td><td>${d.email}</td><td>${d.phone || '-'}</td><td><span class="badge badge-complete">${d.status}</span></td></tr>`).join('');
}

function renderSubscriptions(subs) {
  const tbody = document.querySelector('#admin-subs-table tbody');
  if (!tbody) return;
  tbody.innerHTML = subs.length === 0 ? '<tr><td colspan="6">No active subscriptions found.</td></tr>' :
    subs.map(s => `<tr><td><strong>${s.subscription_id}</strong></td><td>${getSeniorName(s.senior_id)}</td><td>${s.plan_name}</td><td>${s.nurse_visits_per_month}</td><td>${s.doctor_consults_per_month}</td><td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td></tr>`).join('');
}

function renderEntitlements(ents) {
  const tbody = document.querySelector('#admin-entitlements-table tbody');
  if (!tbody) return;
  tbody.innerHTML = ents.length === 0 ? '<tr><td colspan="4">No entitlement records recorded.</td></tr>' :
    ents.map(e => `<tr><td><strong>${getSeniorName(e.senior_id)}</strong></td><td>${e.month}</td><td>${e.nurse_used} / ${e.nurse_allowed}</td><td>${e.doctor_used} / ${e.doctor_allowed}</td></tr>`).join('');
}

function renderAppointments(apts) {
  const tbody = document.querySelector('#admin-apts-table tbody');
  if (!tbody) return;
  tbody.innerHTML = apts.length === 0 ? '<tr><td colspan="4">No doctor appointments recorded.</td></tr>' :
    apts.map(a => {
      let displayTime = a.scheduled_at || '-';
      try { if (a.scheduled_at) displayTime = new Date(a.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) {}
      return `<tr><td><strong>${a.appointment_id}</strong></td><td>${getSeniorName(a.senior_id)}</td><td>${displayTime}</td><td><span class="badge badge-scheduled">${a.status}</span></td></tr>`;
    }).join('');
}

function renderReviews(revs) {
  const tbody = document.querySelector('#admin-reviews-table tbody');
  if (!tbody) return;
  tbody.innerHTML = revs.length === 0 ? '<tr><td colspan="6">No doctor reviews pending.</td></tr>' :
    revs.map(r => {
      const color = r.priority === 'EMERGENCY' ? 'badge-red' : (r.priority === 'URGENT' ? 'badge-yellow' : 'badge-blue');
      return `<tr><td><strong>${r.review_id}</strong></td><td>${getSeniorName(r.senior_id)}</td><td><span class="badge ${color}">${r.priority}</span></td><td>${r.reason}</td><td>${getStaffName(r.assigned_doctor_id)}</td><td><span class="badge badge-yellow">${r.status}</span></td></tr>`;
    }).join('');
}

function renderAudit(logs) {
  const tbody = document.querySelector('#admin-audit-table tbody');
  if (!tbody) return;
  tbody.innerHTML = logs.length === 0 ? '<tr><td colspan="6">No audit records found.</td></tr>' :
    [...logs].reverse().slice(0, 100).map(l => {
      let timeStr = l.timestamp || '-';
      try { timeStr = new Date(l.timestamp).toLocaleTimeString(); } catch (e) {}
      return `<tr><td><small>${timeStr}</small></td><td>${l.actor_id}</td><td><span class="badge badge-blue">${l.actor_role}</span></td><td><strong>${l.event}</strong></td><td>${l.work_order_id || '-'}</td><td><small>${l.reason || ''}</small></td></tr>`;
    }).join('');
}

// ===== Form Bindings & Boot =====
function safeBind(id, eventName, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(eventName, handler);
}

safeBind('create-senior-form', 'submit', async (e) => {
  e.preventDefault();
  try {
    const res = await callApi('adminCreateSenior', {
      fullName: document.getElementById('snr-name').value.trim(),
      dob: document.getElementById('snr-dob').value,
      phone: document.getElementById('snr-phone').value.trim(),
      email: document.getElementById('snr-email').value.trim(),
      address: document.getElementById('snr-address').value.trim()
    });
    alert('Senior created successfully! ID: ' + res.seniorId);
    const woSenior = document.getElementById('wo-senior-id');
    if (woSenior) woSenior.value = res.seniorId;
    document.getElementById('create-senior-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Failed to create senior: ' + err.message);
  }
});

safeBind('create-wo-form', 'submit', async (e) => {
  e.preventDefault();
  const seniorId = document.getElementById('wo-senior-id').value.trim();
  const resultDiv = document.getElementById('wo-result');
  resultDiv.className = 'message hidden';

  // Active Subscription Pre-Check
  const nowStr = new Date().toISOString().slice(0, 10);
  const hasActiveSub = (allData.subscriptions || []).some(s =>
    s.senior_id === seniorId && s.status === 'ACTIVE' && (!s.end_date || s.end_date >= nowStr)
  );

  if (!hasActiveSub) {
    alert('ALERT: Senior ' + seniorId + ' does NOT have an Active Subscription. Please create a Subscription first.');
    return;
  }

  try {
    const scheduledVal = document.getElementById('wo-scheduled-at').value;
    const scheduledIso = scheduledVal ? new Date(scheduledVal).toISOString() : new Date().toISOString();

    const res = await callApi('createWorkOrder', {
      seniorId: seniorId,
      type: document.getElementById('wo-type').value,
      scheduledAt: scheduledIso,
      staffId: document.getElementById('wo-staff-id').value.trim()
    });

    let displayFormatted = scheduledIso;
    try { displayFormatted = new Date(res.scheduledAt).toLocaleString(); } catch (e) {}

    resultDiv.innerHTML = `
      <strong>Work Order Created!</strong><br>
      ID: <code>${res.workOrderId}</code><br>
      Scheduled: <strong>${displayFormatted}</strong><br>
      Start Code: <code>${res.startCode}</code> | End Code: <code>${res.endCode}</code>
    `;
    resultDiv.className = 'message success';
    resultDiv.classList.remove('hidden');

    const staffSearch = document.getElementById('wo-staff-search');
    const staffHidden = document.getElementById('wo-staff-id');
    if (staffSearch) staffSearch.value = '';
    if (staffHidden) staffHidden.value = '';

    await loadAdminDashboard();
  } catch (err) {
    resultDiv.innerHTML = 'Error: ' + err.message;
    resultDiv.className = 'message error';
    resultDiv.classList.remove('hidden');
  }
});

safeBind('create-sub-form', 'submit', async (e) => {
  e.preventDefault();
  const resultDiv = document.getElementById('sub-result');
  try {
    const res = await callApi('adminCreateSubscription', {
      seniorId: document.getElementById('sub-senior-id').value,
      planName: document.getElementById('sub-plan-name').value.trim(),
      nurseVisits: Number(document.getElementById('sub-nurse-visits').value),
      doctorConsults: Number(document.getElementById('sub-doctor-consults').value)
    });
    resultDiv.innerHTML = `<strong>Subscription created!</strong> ID: ${res.subscriptionId}`;
    resultDiv.className = 'message success';
    resultDiv.classList.remove('hidden');
    document.getElementById('create-sub-form').reset();
    document.getElementById('sub-plan-name').value = 'Standard Care';
    document.getElementById('sub-nurse-visits').value = 2;
    document.getElementById('sub-doctor-consults').value = 1;
    await loadAdminDashboard();
  } catch (err) {
    resultDiv.innerHTML = 'Error: ' + err.message;
    resultDiv.className = 'message error';
    resultDiv.classList.remove('hidden');
  }
});

safeBind('create-apt-form', 'submit', async (e) => {
  e.preventDefault();
  try {
    const scheduledVal = document.getElementById('apt-scheduled-at').value;
    await callApi('adminCreateAppointment', {
      seniorId: document.getElementById('apt-senior-id').value,
      type: 'DoctorConsult',
      scheduledAt: scheduledVal ? new Date(scheduledVal).toISOString() : ''
    });
    alert('Doctor appointment created successfully!');
    document.getElementById('create-apt-form').reset();
    const d2 = new Date(Date.now() + 3600000);
    document.getElementById('apt-scheduled-at').value = new Date(d2.getTime() - d2.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await loadAdminDashboard();
  } catch (err) {
    alert('Failed to create appointment: ' + err.message);
  }
});



/**
 * Nityaseva V5 — Admin Entity Management
 */

function adminCreateSenior(auth, params) {
  requireRole_(auth, ['admin']);
  const seniorId = generateId_('SNR');

  // 1. Create Senior Record
  appendRow_('Seniors', {
    senior_id: seniorId,
    full_name: params.fullName,
    dob: params.dob || '',
    gender: params.gender || '',
    phone: params.phone || '',
    email: params.email || '',
    address: params.address || '',
    emergency_contact: params.emergencyContact || '',
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  });

  // 2. Automatically register & link Family Member if details provided
  let familyId = '';
  if (params.familyName && params.familyEmail) {
    familyId = generateId_('FAM');
    appendRow_('Families', {
      family_id: familyId,
      full_name: params.familyName,
      relationship: params.familyRelation || 'Family',
      phone: params.familyPhone || '',
      email: params.familyEmail.trim().toLowerCase(),
      created_at: new Date().toISOString()
    });

    const linkId = generateId_('LNK');
    appendRow_('Family_Senior_Links', {
      link_id: linkId,
      family_id: familyId,
      senior_id: seniorId,
      authorized: 'TRUE',
      created_at: new Date().toISOString()
    });
  }

  try {
    if (typeof logAudit_ === 'function') {
      logAudit_(auth.userId, auth.role, 'ADMIN_CREATE_SENIOR', { seniorId: seniorId, familyId: familyId }, 'Seniors');
    }
  } catch (e) {}

  return { seniorId: seniorId, familyId: familyId };
}

function adminLinkFamilyToSenior(auth, params) {
  requireRole_(auth, ['admin']);
  const linkId = generateId_('LNK');
  appendRow_('Family_Senior_Links', {
    link_id: linkId,
    family_id: params.familyId,
    senior_id: params.seniorId,
    authorized: 'TRUE',
    created_at: new Date().toISOString()
  });
  return { linkId: linkId, success: true };
}

function adminCreateSubscription(auth, params) {
  requireRole_(auth, ['admin']);
  const subId = generateId_('SUB');

  const startDate = params.startDate || new Date().toISOString().slice(0, 10);

  // Auto-calculate end date: exactly 30 days from start date
  const startObj = new Date(startDate);
  const endObj = new Date(startObj.getTime() + (30 * 24 * 60 * 60 * 1000));
  const autoEndDate = endObj.toISOString().slice(0, 10);

  appendRow_('Subscriptions', {
    subscription_id: subId,
    senior_id: params.seniorId,
    plan_name: params.planName || 'Standard Care',
    nurse_visits_per_month: params.nurseVisits || 2,
    doctor_consults_per_month: params.doctorConsults || 1,
    start_date: startDate,
    end_date: params.endDate || autoEndDate,
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  });

  // Pre-create current month's entitlement row
  try {
    const monthStr = currentMonthStr_();
    appendRow_('Monthly_Entitlements', {
      entitlement_id: generateId_('ENT'),
      senior_id: params.seniorId,
      month: monthStr,
      nurse_allowed: params.nurseVisits || 2,
      nurse_used: 0,
      doctor_allowed: params.doctorConsults || 1,
      doctor_used: 0,
      updated_at: new Date().toISOString()
    });
  } catch (e) {
    Logger.log('Entitlement pre-creation skipped: ' + e.message);
  }

  try {
    if (typeof logAudit_ === 'function') {
      logAudit_(auth.userId, auth.role, 'ADMIN_CREATE_SUBSCRIPTION', {
        subscriptionId: subId,
        seniorId: params.seniorId,
        endDate: autoEndDate
      }, 'Subscriptions');
    }
  } catch (e) {}

  return { subscriptionId: subId, success: true, endDate: params.endDate || autoEndDate };
}

function adminCreateAppointment(auth, params) {
  requireRole_(auth, ['admin']);
  const appointmentId = generateId_('APT');

  appendRow_('Appointments', {
    appointment_id: appointmentId,
    senior_id: params.seniorId,
    type: params.type || 'DoctorConsult',
    assigned_staff_id: params.staffId || '',
    assigned_doctor_id: params.doctorId || '',
    scheduled_at: params.scheduledAt || '',
    status: 'REQUESTED',
    created_by: auth.userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  try {
    if (typeof logAudit_ === 'function') {
      logAudit_(auth.userId, auth.role, 'ADMIN_CREATE_APPOINTMENT', { appointmentId: appointmentId, seniorId: params.seniorId }, 'Appointments');
    }
  } catch (e) {}

  return { appointmentId: appointmentId, success: true };
}

function adminCreateReport(auth, params) {
  requireRole_(auth, ['admin', 'doctor', 'nurse']);
  const reportId = generateId_('RPT');

  appendRow_('Reports', {
    report_id: reportId,
    senior_id: params.seniorId,
    type: params.type || 'Other Diagnostics',
    file_url: params.fileUrl,
    source_table: params.sourceTable || 'Manual',
    source_id: params.sourceId || '',
    uploaded_by: auth.userId,
    created_at: new Date().toISOString()
  });

  try {
    if (typeof logAudit_ === 'function') {
      logAudit_(auth.userId, auth.role, 'REPORT_CREATED', {
        reportId: reportId,
        seniorId: params.seniorId,
        type: params.type
      }, 'Reports');
    }
  } catch (e) {}

  return { reportId: reportId, success: true };
}

init().catch(err => {
  console.error('INIT FAILED:', err);
  alert('Dashboard failed to initialize: ' + err.message);
});
