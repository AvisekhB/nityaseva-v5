import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allData = { seniors: [], workOrders: [], staff: [], doctors: [], families: [], familyLinks: [], subscriptions: [], entitlements: [], reports: [], reviews: [], logs: [] };
let practitionerList = [];
let activeSlicer = 'ALL';
let sortState = {};

async function init() {
  setupTabs();
  setupSlicers();

  currentProfile = await requireAuth('admin');
  if (!currentProfile) return;

  const userDisplay = document.getElementById('user-display');
  if (userDisplay) userDisplay.textContent = currentProfile.full_name || 'Admin';

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', signOut);

  const dateInput = document.getElementById('wo-scheduled-at');
  if (dateInput) {
    const d = new Date(Date.now() + 3600000);
    dateInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  const subDate = document.getElementById('sub-start-date');
  if (subDate) subDate.value = new Date().toISOString().slice(0, 10);

  setupSearchableStaffDropdown();
  await loadAdminDashboard();
}

function setupTabs() {
  document.querySelectorAll('.admin-nav .nav-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.admin-nav .nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.getAttribute('data-tab'));
      if (target) target.classList.add('active');
    };
  });
}

function setupSlicers() {
  document.querySelectorAll('.sub-nav .sub-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.sub-nav .sub-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSlicer = btn.getAttribute('data-slicer');
      renderWorkOrders(allData.workOrders || []);
    };
  });
}

async function loadAdminDashboard() {
  try {
    const data = await callApi('getAdminDashboard');
    allData = data || {};

    practitionerList = [
      ...(allData.staff || []).map(s => ({ id: s.staff_id, name: s.full_name, type: 'Nurse' })),
      ...(allData.doctors || []).map(d => ({ id: d.doctor_id, name: d.full_name, type: 'Doctor' }))
    ];

    populateSeniorDropdowns(allData.seniors || []);

    renderWorkOrders(allData.workOrders || []);
    renderSeniors(allData.seniors || []);
    renderFamilies(allData.families || [], allData.familyLinks || []);
    renderStaff(allData.staff || []);
    renderDoctors(allData.doctors || []);
    renderSubscriptions(allData.subscriptions || []);
    renderEntitlements(allData.entitlements || []);
    renderReports(allData.reports || []);
    renderReviews(allData.reviews || []);
    renderAudit(allData.logs || []);

    setupTableSortAndSearch();
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
  const options = '<option value="">-- Choose Senior --</option>' +
    seniors.map(s => `<option value="${s.senior_id}">${s.full_name} (${s.senior_id})</option>`).join('');

  ['wo-senior-id', 'sub-senior-id', 'report-senior-id'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = options;
  });
}

function setupSearchableStaffDropdown() {
  const searchInput = document.getElementById('wo-staff-search');
  const hiddenInput = document.getElementById('wo-staff-id');
  const box = document.getElementById('wo-staff-suggestions');
  if (!searchInput || !hiddenInput || !box) return;

  searchInput.oninput = () => {
    const q = searchInput.value.trim().toLowerCase();
    hiddenInput.value = '';
    const matches = practitionerList.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    if (matches.length === 0) {
      box.innerHTML = '<div class="suggestion-empty">No staff found</div>';
    } else {
      box.innerHTML = matches.map(p => `
        <div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">
          ${p.type === 'Doctor' ? 'Dr. ' : ''}${p.name}
          <span class="tag ${p.type === 'Doctor' ? 'badge-doctor-consult' : 'badge-nurse-visit'}">${p.type}</span>
        </div>
      `).join('');
    }
    box.classList.add('open');
  };

  box.onclick = (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    hiddenInput.value = item.getAttribute('data-id');
    searchInput.value = item.getAttribute('data-name');
    box.classList.remove('open');
  };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown')) box.classList.remove('open');
  });
}

// 1. Work Orders with Slicers
function renderWorkOrders(orders) {
  const tbody = document.querySelector('#admin-wo-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let filtered = [...orders];
  if (activeSlicer === 'SCHEDULED') filtered = filtered.filter(w => w.status === 'SCHEDULED' || w.status === 'UNSCHEDULED');
  else if (activeSlicer === 'IN_PROGRESS') filtered = filtered.filter(w => w.status === 'IN_PROGRESS');
  else if (activeSlicer === 'COMPLETE') filtered = filtered.filter(w => w.status === 'COMPLETE' || w.status === 'CLOSE');
  else if (activeSlicer === 'CANCELLED') filtered = filtered.filter(w => w.status === 'CANCELLED');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No work orders in this view.</td></tr>';
    return;
  }

  filtered.reverse().forEach(wo => {
    const tr = document.createElement('tr');
    const isClosed = (wo.status === 'COMPLETE' || wo.status === 'CLOSE');
    const badgeColor = isClosed ? 'badge-complete' : (wo.status === 'IN_PROGRESS' ? 'badge-in-progress' : (wo.status === 'CANCELLED' ? 'badge-cancelled' : 'badge-scheduled'));
    const typeBadge = wo.type === 'DoctorConsult' ? 'badge-doctor-consult' : 'badge-nurse-visit';
    const displayTime = wo.created_at ? new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-';

    tr.innerHTML = `
      <td><strong>${wo.work_order_id}</strong></td>
      <td>${getSeniorName(wo.senior_id)}</td>
      <td><span class="badge ${typeBadge}">${wo.type}</span></td>
      <td>${displayTime}</td>
      <td><span class="badge ${badgeColor}">${wo.status}</span></td>
      <td>
        ${!isClosed && wo.status !== 'CANCELLED'
          ? `<button class="override-btn danger" data-id="${wo.work_order_id}">Cancel</button>`
          : `<span style="color:#a0aec0;font-size:12px;">Locked</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.override-btn').forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt('Cancellation reason:');
      if (!reason) return;
      await callApi('adminOverrideWorkOrder', { workOrderId: btn.getAttribute('data-id'), newStatus: 'CANCELLED', reason });
      await loadAdminDashboard();
    };
  });
}

// 2. Subscriptions Table (Fixed Date Mapping)
function renderSubscriptions(subs) {
  const tbody = document.querySelector('#admin-subs-table tbody');
  if (!tbody) return;
  if (!subs || subs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No active subscriptions found.</td></tr>';
    return;
  }
  tbody.innerHTML = subs.map(s => `
    <tr>
      <td><strong>${s.subscription_id}</strong></td>
      <td>${getSeniorName(s.senior_id)}</td>
      <td>${s.plan_name}</td>
      <td>${s.start_date || '-'}</td>
      <td><strong>${s.end_date || '-'}</strong></td>
      <td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td>
    </tr>
  `).join('');
}

// 3. Entitlements Table
function renderEntitlements(ents) {
  const tbody = document.querySelector('#admin-entitlements-table tbody');
  if (!tbody) return;
  if (!ents || ents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No entitlement records found.</td></tr>';
    return;
  }
  tbody.innerHTML = ents.map(e => `
    <tr>
      <td><strong>${getSeniorName(e.senior_id)}</strong></td>
      <td>${e.month}</td>
      <td>${e.nurse_used} / ${e.nurse_allowed}</td>
      <td>${e.doctor_used} / ${e.doctor_allowed}</td>
    </tr>
  `).join('');
}

// 4. Reports Table with 72-Hour Token Sharing
function renderReports(reports) {
  const tbody = document.querySelector('#admin-reports-table tbody');
  if (!tbody) return;
  if (!reports || reports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No diagnostic reports recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = [...reports].reverse().map(r => `
    <tr>
      <td><strong>${r.report_id}</strong></td>
      <td>${getSeniorName(r.senior_id)}</td>
      <td><span class="badge badge-nurse-visit">${r.type}</span></td>
      <td><a href="${r.file_url}" target="_blank" rel="noopener">Open Document ↗</a></td>
      <td>${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '-'}</td>
      <td>
        <button class="share-btn" data-id="${r.report_id}" data-senior="${r.senior_id}" data-type="${r.type}">Share 72h Link</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.share-btn').forEach(btn => {
    btn.onclick = async () => {
      const reportId = btn.getAttribute('data-id');
      const seniorId = btn.getAttribute('data-senior');
      const type = btn.getAttribute('data-type');
      try {
        const res = await callApi('createReportLink', { reportId, expiryHours: 72 });
        const shareUrl = `${window.location.origin}${window.location.pathname.replace('admin.html', '')}report.html?token=${res.token}`;
        const input = prompt(`72-Hour Secure Link Created:\n\n${shareUrl}\n\nType 'copy' to copy to clipboard, or enter an email address to send directly:`);
        if (!input) return;
        if (input.toLowerCase() === 'copy') {
          await navigator.clipboard.writeText(shareUrl);
          alert('Link copied to clipboard!');
        } else if (input.includes('@')) {
          await callApi('shareReportByEmail', {
            recipientEmail: input.trim(),
            seniorName: getSeniorName(seniorId),
            reportType: type,
            secureUrl: shareUrl
          });
          alert('Report link emailed to ' + input.trim());
        }
      } catch (err) {
        alert('Share error: ' + err.message);
      }
    };
  });
}

function renderSeniors(seniors) {
  const tbody = document.querySelector('#admin-seniors-table tbody');
  if (!tbody) return;
  tbody.innerHTML = !seniors || seniors.length === 0 ? '<tr><td colspan="6">No seniors registered.</td></tr>' :
    seniors.map(s => `<tr><td><strong>${s.senior_id}</strong></td><td>${s.full_name}</td><td>${s.phone||'-'}</td><td>${s.email||'-'}</td><td>${s.address||'-'}</td><td><span class="badge badge-complete">${s.status||'ACTIVE'}</span></td></tr>`).join('');
}

function renderFamilies(families, links) {
  const tbody = document.querySelector('#admin-families-table tbody');
  if (!tbody) return;
  tbody.innerHTML = !families || families.length === 0 ? '<tr><td colspan="6">No families recorded.</td></tr>' :
    families.map(f => {
      const link = (links || []).find(l => l.family_id === f.family_id);
      return `<tr><td><strong>${f.family_id}</strong></td><td>${f.full_name}</td><td>${f.relationship||'-'}</td><td>${link ? getSeniorName(link.senior_id) : 'Unlinked'}</td><td>${f.email||'-'}</td><td>${f.phone||'-'}</td></tr>`;
    }).join('');
}

function renderStaff(staff) {
  const tbody = document.querySelector('#admin-staff-table tbody');
  if (!tbody) return;
  tbody.innerHTML = !staff || staff.length === 0 ? '<tr><td colspan="6">No staff recorded.</td></tr>' :
    staff.map(st => `<tr><td><strong>${st.staff_id}</strong></td><td>${st.full_name}</td><td>${st.role}</td><td>${st.email}</td><td>${st.phone||'-'}</td><td><span class="badge badge-complete">${st.status}</span></td></tr>`).join('');
}

function renderDoctors(doctors) {
  const tbody = document.querySelector('#admin-doctors-table tbody');
  if (!tbody) return;
  tbody.innerHTML = !doctors || doctors.length === 0 ? '<tr><td colspan="6">No doctors recorded.</td></tr>' :
    doctors.map(d => `<tr><td><strong>${d.doctor_id}</strong></td><td>${d.full_name}</td><td>${d.specialty||'General'}</td><td>${d.email}</td><td>${d.phone||'-'}</td><td><span class="badge badge-complete">${d.status}</span></td></tr>`).join('');
}

function renderReviews(revs) {
  const tbody = document.querySelector('#admin-reviews-table tbody');
  if (!tbody) return;
  tbody.innerHTML = !revs || revs.length === 0 ? '<tr><td colspan="6">No reviews pending.</td></tr>' :
    revs.map(r => `<tr><td><strong>${r.review_id}</strong></td><td>${getSeniorName(r.senior_id)}</td><td><span class="badge badge-cancelled">${r.priority}</span></td><td>${r.reason}</td><td>${getStaffName(r.assigned_doctor_id)}</td><td><span class="badge badge-scheduled">${r.status}</span></td></tr>`).join('');
}

function renderAudit(logs) {
  const tbody = document.querySelector('#admin-audit-table tbody');
  if (!tbody) return;
  tbody.innerHTML = !logs || logs.length === 0 ? '<tr><td colspan="6">No audit records found.</td></tr>' :
    [...logs].reverse().slice(0, 100).map(l => `<tr><td><small>${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-'}</small></td><td>${l.actor_id}</td><td>${l.actor_role}</td><td><strong>${l.event}</strong></td><td>${l.work_order_id||'-'}</td><td><small>${l.reason||''}</small></td></tr>`).join('');
}

// Search and Sort System
function setupTableSortAndSearch() {
  const tables = [
    { searchId: 'search-wo', ascId: 'sort-wo-asc', descId: 'sort-wo-desc', getData: () => allData.workOrders || [], render: renderWorkOrders, sortKey: 'created_at' },
    { searchId: 'search-seniors', ascId: 'sort-seniors-asc', descId: 'sort-seniors-desc', getData: () => allData.seniors || [], render: renderSeniors, sortKey: 'full_name' },
    { searchId: 'search-families', ascId: 'sort-families-asc', descId: 'sort-families-desc', getData: () => allData.families || [], render: f => renderFamilies(f, allData.familyLinks || []), sortKey: 'full_name' },
    { searchId: 'search-staff', ascId: 'sort-staff-asc', descId: 'sort-staff-desc', getData: () => allData.staff || [], render: renderStaff, sortKey: 'full_name' },
    { searchId: 'search-doctors', ascId: 'sort-doctors-asc', descId: 'sort-doctors-desc', getData: () => allData.doctors || [], render: renderDoctors, sortKey: 'full_name' },
    { searchId: 'search-subs', ascId: 'sort-subs-asc', descId: 'sort-subs-desc', getData: () => allData.subscriptions || [], render: renderSubscriptions, sortKey: 'start_date' },
    { searchId: 'search-ent', ascId: 'sort-ent-asc', descId: 'sort-ent-desc', getData: () => allData.entitlements || [], render: renderEntitlements, sortKey: 'month' },
    { searchId: 'search-reports', ascId: 'sort-reports-asc', descId: 'sort-reports-desc', getData: () => allData.reports || [], render: renderReports, sortKey: 'created_at' }
  ];

  tables.forEach(({ searchId, ascId, descId, getData, render, sortKey }) => {
    const sInput = document.getElementById(searchId);
    if (sInput && !sInput.dataset.bound) {
      sInput.dataset.bound = 'true';
      sInput.oninput = () => {
        const q = sInput.value.trim().toLowerCase();
        render(getData().filter(row => JSON.stringify(row).toLowerCase().includes(q)));
      };
    }
    const aBtn = document.getElementById(ascId);
    if (aBtn && !aBtn.dataset.bound) {
      aBtn.dataset.bound = 'true';
      aBtn.onclick = () => render([...getData()].sort((a, b) => String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''))));
    }
    const dBtn = document.getElementById(descId);
    if (dBtn && !dBtn.dataset.bound) {
      dBtn.dataset.bound = 'true';
      dBtn.onclick = () => render([...getData()].sort((a, b) => String(b[sortKey] || '').localeCompare(String(a[sortKey] || ''))));
    }
  });
}

// Form Handlers
document.getElementById('create-senior-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await callApi('adminCreateSenior', {
      fullName: document.getElementById('snr-name').value.trim(),
      dob: document.getElementById('snr-dob').value,
      phone: document.getElementById('snr-phone').value.trim(),
      email: document.getElementById('snr-email').value.trim(),
      address: document.getElementById('snr-address').value.trim(),
      familyName: document.getElementById('fam-name').value.trim(),
      familyRelation: document.getElementById('fam-rel').value.trim(),
      familyPhone: document.getElementById('fam-phone').value.trim(),
      familyEmail: document.getElementById('fam-email').value.trim()
    });
    alert('Senior & Family Linked Successfully! Senior ID: ' + res.seniorId);
    document.getElementById('create-senior-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Enrollment error: ' + err.message);
  }
});

document.getElementById('create-wo-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const seniorId = document.getElementById('wo-senior-id').value.trim();
  const resDiv = document.getElementById('wo-result');
  resDiv.className = 'message hidden';

  const nowStr = new Date().toISOString().slice(0, 10);
  const hasActiveSub = (allData.subscriptions || []).some(s => s.senior_id === seniorId && s.status === 'ACTIVE' && (!s.end_date || s.end_date >= nowStr));
  if (!hasActiveSub) {
    alert('ALERT: Senior ' + seniorId + ' has NO Active Subscription.');
    return;
  }

  try {
    const res = await callApi('createWorkOrder', {
      seniorId,
      type: document.getElementById('wo-type').value,
      scheduledAt: new Date(document.getElementById('wo-scheduled-at').value).toISOString(),
      staffId: document.getElementById('wo-staff-id').value.trim()
    });
    resDiv.innerHTML = `<strong>Work Order Created!</strong> ID: <code>${res.workOrderId}</code> | Start: <strong>${res.startCode}</strong> | End: <strong>${res.endCode}</strong>`;
    resDiv.className = 'message success';
    resDiv.classList.remove('hidden');
    document.getElementById('wo-staff-search').value = '';
    document.getElementById('wo-staff-id').value = '';
    await loadAdminDashboard();
  } catch (err) {
    resDiv.innerHTML = 'Error: ' + err.message;
    resDiv.className = 'message error';
    resDiv.classList.remove('hidden');
  }
});

document.getElementById('create-sub-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const resDiv = document.getElementById('sub-result');
  try {
    const res = await callApi('adminCreateSubscription', {
      seniorId: document.getElementById('sub-senior-id').value,
      planName: document.getElementById('sub-plan-name').value.trim(),
      startDate: document.getElementById('sub-start-date').value,
      nurseVisits: Number(document.getElementById('sub-nurse-visits').value),
      doctorConsults: Number(document.getElementById('sub-doctor-consults').value)
    });
    resDiv.innerHTML = `<strong>Subscription created!</strong> Valid 30 days until ${res.endDate}`;
    resDiv.className = 'message success';
    resDiv.classList.remove('hidden');
    document.getElementById('create-sub-form').reset();
    document.getElementById('sub-start-date').value = new Date().toISOString().slice(0, 10);
    await loadAdminDashboard();
  } catch (err) {
    resDiv.innerHTML = 'Error: ' + err.message;
    resDiv.className = 'message error';
    resDiv.classList.remove('hidden');
  }
});

document.getElementById('create-report-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await callApi('adminCreateReport', {
      seniorId: document.getElementById('report-senior-id').value,
      type: document.getElementById('report-type').value,
      fileUrl: document.getElementById('report-url').value.trim()
    });
    alert('Diagnostic report registered successfully!');
    document.getElementById('create-report-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Report registration error: ' + err.message);
  }
});

init().catch(err => {
  console.error('INIT FAILED:', err);
  alert('Dashboard initialization failed: ' + err.message);
});
