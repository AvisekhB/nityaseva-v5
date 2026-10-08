import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';
import * as UI from './admin_render.js';

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

  document.getElementById('user-display').textContent = currentProfile.full_name || 'Admin';
  document.getElementById('btn-logout').addEventListener('click', signOut);

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
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.admin-nav .nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const target = document.getElementById(e.currentTarget.getAttribute('data-tab'));
      if (target) target.classList.add('active');
    });
  });
}

function setupSlicers() {
  document.querySelectorAll('.sub-nav .sub-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.sub-nav .sub-tab').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      activeSlicer = e.currentTarget.getAttribute('data-slicer');
      UI.renderWorkOrders(allData.workOrders || [], allData, practitionerList, activeSlicer, handleOverride);
    });
  });
}

async function loadAdminDashboard() {
  try {
    allData = await callApi('getAdminDashboard');

    practitionerList = [
      ...(allData.staff || []).map(s => ({ id: s.staff_id, name: s.full_name, type: 'Nurse' })),
      ...(allData.doctors || []).map(d => ({ id: d.doctor_id, name: d.full_name, type: 'Doctor' }))
    ];

    populateSeniorDropdowns(allData.seniors || []);

    UI.renderWorkOrders(allData.workOrders || [], allData, practitionerList, activeSlicer, handleOverride);
    UI.renderSeniors(allData.seniors || []);
    UI.renderFamilies(allData.families || [], allData.familyLinks || [], allData);
    UI.renderStaff(allData.staff || []);
    UI.renderDoctors(allData.doctors || []);
    UI.renderSubscriptions(allData.subscriptions || [], allData);
    UI.renderEntitlements(allData.entitlements || [], allData);
    UI.renderReports(allData.reports || [], allData, handleShareReport);
    UI.renderReviews(allData.reviews || [], allData, practitionerList);
    UI.renderAudit(allData.logs || []);

    setupSorting();
    wireSearchBoxes();
  } catch (err) {
    console.error('Dashboard load error:', err);
    alert('Dashboard load error: ' + err.message);
  }
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
  const suggestionsBox = document.getElementById('wo-staff-suggestions');
  if (!searchInput || !hiddenInput || !suggestionsBox) return;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase();
    hiddenInput.value = '';
    const matches = practitionerList.filter(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    if (matches.length === 0) {
      suggestionsBox.innerHTML = '<div class="suggestion-empty">No staff found</div>';
    } else {
      suggestionsBox.innerHTML = matches.map(p => `
        <div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">
          ${p.type === 'Doctor' ? 'Dr. ' : ''}${p.name}
          <span class="tag ${p.type === 'Doctor' ? 'badge-doctor-consult' : 'badge-nurse-visit'}">${p.type}</span>
        </div>
      `).join('');
    }
    suggestionsBox.classList.add('open');
  });

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    hiddenInput.value = item.getAttribute('data-id');
    searchInput.value = item.getAttribute('data-name');
    suggestionsBox.classList.remove('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.searchable-dropdown')) suggestionsBox.classList.remove('open');
  });
}

async function handleOverride(woId) {
  const reason = prompt('Cancellation reason:');
  if (!reason) return;
  try {
    await callApi('adminOverrideWorkOrder', { workOrderId: woId, newStatus: 'CANCELLED', reason });
    await loadAdminDashboard();
  } catch (err) {
    alert('Override failed: ' + err.message);
  }
}

// 72-Hour Token Share Generator
async function handleShareReport(reportId, seniorId, reportType) {
  try {
    const res = await callApi('createReportLink', { reportId, expiryHours: 72 });
    const fullUrl = `${window.location.origin}${window.location.pathname.replace('admin.html', '')}report.html?token=${res.token}`;
    
    const choice = prompt(
      `72-Hour Secure Link Created:\n\n${fullUrl}\n\nType 'copy' to copy link.\nType an email address to send directly to Family or Doctor:`
    );

    if (!choice) return;

    if (choice.toLowerCase() === 'copy') {
      await navigator.clipboard.writeText(fullUrl);
      alert('Link copied to clipboard!');
    } else if (choice.includes('@')) {
      await callApi('shareReportByEmail', {
        recipientEmail: choice.trim(),
        seniorName: UI.getSeniorName(seniorId, allData),
        reportType: reportType,
        secureUrl: fullUrl
      });
      alert(`Report access link sent to ${choice.trim()}!`);
    }
  } catch (err) {
    alert('Sharing failed: ' + err.message);
  }
}

function setupSorting() {
  const tableConfig = [
    { id: 'admin-wo-table', get: () => allData.workOrders, render: d => UI.renderWorkOrders(d, allData, practitionerList, activeSlicer, handleOverride) },
    { id: 'admin-seniors-table', get: () => allData.seniors, render: UI.renderSeniors },
    { id: 'admin-subs-table', get: () => allData.subscriptions, render: d => UI.renderSubscriptions(d, allData) },
    { id: 'admin-entitlements-table', get: () => allData.entitlements, render: d => UI.renderEntitlements(d, allData) },
    { id: 'admin-reports-table', get: () => allData.reports, render: d => UI.renderReports(d, allData, handleShareReport) }
  ];

  tableConfig.forEach(({ id, get, render }) => {
    const table = document.getElementById(id);
    if (!table) return;
    table.querySelectorAll('thead th[data-key]').forEach(th => {
      th.style.cursor = 'pointer';
      th.onclick = () => {
        const key = th.getAttribute('data-key');
        sortState[id] = { col: key, dir: sortState[id]?.col === key && sortState[id]?.dir === 'asc' ? 'desc' : 'asc' };
        const sorted = [...get()].sort((a, b) => {
          const va = a[key] ?? '', vb = b[key] ?? '';
          return sortState[id].dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
        render(sorted);
      };
    });
  });
}

function wireSearchBoxes() {
  const mappings = [
    ['search-wo', () => allData.workOrders, d => UI.renderWorkOrders(d, allData, practitionerList, activeSlicer, handleOverride)],
    ['search-seniors', () => allData.seniors, UI.renderSeniors],
    ['search-subs', () => allData.subscriptions, d => UI.renderSubscriptions(d, allData)],
    ['search-ent', () => allData.entitlements, d => UI.renderEntitlements(d, allData)],
    ['search-reports', () => allData.reports, d => UI.renderReports(d, allData, handleShareReport)]
  ];

  mappings.forEach(([inputId, get, render]) => {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.bound) return;
    input.dataset.bound = 'true';
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      render(get().filter(row => JSON.stringify(row).toLowerCase().includes(q)));
    });
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
    alert('Senior & Family Linked Successfully! ID: ' + res.seniorId);
    document.getElementById('create-senior-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Enrollment error: ' + err.message);
  }
});

document.getElementById('create-wo-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const seniorId = document.getElementById('wo-senior-id').value.trim();
  const nowStr = new Date().toISOString().slice(0, 10);
  const hasActiveSub = (allData.subscriptions || []).some(s => s.senior_id === seniorId && s.status === 'ACTIVE' && (!s.end_date || s.end_date >= nowStr));

  if (!hasActiveSub) {
    alert('ALERT: Senior ' + seniorId + ' has NO Active Subscription.');
    return;
  }

  try {
    const scheduledVal = document.getElementById('wo-scheduled-at').value;
    const res = await callApi('createWorkOrder', {
      seniorId,
      type: document.getElementById('wo-type').value,
      scheduledAt: scheduledVal ? new Date(scheduledVal).toISOString() : new Date().toISOString(),
      staffId: document.getElementById('wo-staff-id').value.trim()
    });
    alert('Work Order Created! ID: ' + res.workOrderId);
    document.getElementById('create-wo-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Work Order Error: ' + err.message);
  }
});

document.getElementById('create-sub-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await callApi('adminCreateSubscription', {
      seniorId: document.getElementById('sub-senior-id').value,
      planName: document.getElementById('sub-plan-name').value.trim(),
      startDate: document.getElementById('sub-start-date').value,
      nurseVisits: Number(document.getElementById('sub-nurse-visits').value),
      doctorConsults: Number(document.getElementById('sub-doctor-consults').value)
    });
    alert('Subscription created! End date auto-set to: ' + res.endDate);
    document.getElementById('create-sub-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Subscription error: ' + err.message);
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
    alert('Diagnostic Report saved!');
    document.getElementById('create-report-form').reset();
    await loadAdminDashboard();
  } catch (err) {
    alert('Report upload error: ' + err.message);
  }
});

init();
