import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allData = { 
  seniors: [], workOrders: [], staff: [], doctors: [], coordinators: [], companions: [], // Add companions here
  families: [], familyLinks: [], subscriptions: [], entitlements: [], 
  reports: [], reviews: [], logs: [], hospitalServices: [], companionServices: [] 
};

let practitionerList = [];
let activeSlicer = 'ALL';

// 5 ENTRIES PER SCREEN FOR ALL TABLES
const PAGE_SIZE = 5;
const pageState = {
  wo: 1, seniors: 1, families: 1, staff: 1, doctors: 1, coordinators: 1,
  subs: 1, ent: 1, reports: 1, reviews: 1, audit: 1, hospital: 1, companion: 1
};

async function init() {
  setupTabs();
  setupDashboardJumps();
  setupSlicers();
  setupUnifiedWorkOrderFormToggles();
  setupEmployeeDirectoryViews();
  setupEmployeeCreationForm();

  currentProfile = await requireAuth('admin');
  if (!currentProfile) return;

  const userDisplay = document.getElementById('user-display');
  if (userDisplay) userDisplay.textContent = currentProfile.full_name || 'Admin';

  document.getElementById('btn-logout')?.addEventListener('click', signOut);

  const dateInput = document.getElementById('wo-scheduled-at');
  if (dateInput) {
    const d = new Date(Date.now() + 3600000);
    dateInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  const subDate = document.getElementById('sub-start-date');
  if (subDate) subDate.value = new Date().toISOString().slice(0, 10);

  document.getElementById('btn-refresh-dashboard')?.addEventListener('click', loadAdminDashboard);

  setupSearchableStaffDropdown();
  setupTableSearches();
  setupActionForms();
  await loadAdminDashboard();
}

// -------------------------------------------------------------
// NAVIGATION TABS & DASHBOARD JUMPS
// -------------------------------------------------------------
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

function setupDashboardJumps() {
  document.querySelectorAll('.jump-card').forEach(card => {
    card.onclick = () => {
      const targetTabId = card.getAttribute('data-jump');
      const navBtn = document.querySelector(`.admin-nav .nav-tab[data-tab="${targetTabId}"]`);
      if (navBtn) {
        navBtn.click();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
  });
}

function setupSlicers() {
  document.querySelectorAll('.wo-slicer-bar .sub-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.wo-slicer-bar .sub-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSlicer = btn.getAttribute('data-slicer') || 'ALL';
      pageState.wo = 1;
      renderWorkOrders(allData.workOrders || []);
    };
  });
}


// -------------------------------------------------------------
// FORM FIELD TOGGLES
// -------------------------------------------------------------
function setupUnifiedWorkOrderFormToggles() {
  const typeSelect = document.getElementById('wo-type');
  const hospBox = document.getElementById('wo-hospital-fields');
  const compBox = document.getElementById('wo-companion-fields');
  const staffInput = document.getElementById('wo-staff-search');
  if (!typeSelect) return;

  typeSelect.addEventListener('change', () => {
    const val = typeSelect.value;
    const isHospital = (val === 'HospitalCoordination' || val === 'HospitalEscort');
    const isCompanion = (val === 'CompanionService');

    if (hospBox) hospBox.style.display = isHospital ? 'block' : 'none';
    if (compBox) compBox.style.display = isCompanion ? 'block' : 'none';

    if (staffInput) {
      if (val === 'DoctorConsult') staffInput.placeholder = 'Search doctor directory...';
      else if (val === 'NurseVisit') staffInput.placeholder = 'Search nurse/staff directory...';
      else if (isHospital) staffInput.placeholder = 'Search escort nurse or coordinator...';
      else staffInput.placeholder = 'Search companion staff...';
    }
  });
}
function setupEmployeeDirectoryViews() {
  const switchSubTab = (btnId, viewId) => {
    ['staff', 'doctors', 'coordinators', 'companions'].forEach(k => {
      document.getElementById(`btn-show-${k}`)?.classList.remove('active');
      document.getElementById(`view-emp-${k}`)?.classList.add('hidden');
    });
    document.getElementById(btnId)?.classList.add('active');
    document.getElementById(viewId)?.classList.remove('hidden');
  };

  document.getElementById('btn-show-staff')?.addEventListener('click', () => switchSubTab('btn-show-staff', 'view-emp-staff'));
  document.getElementById('btn-show-doctors')?.addEventListener('click', () => switchSubTab('btn-show-doctors', 'view-emp-doctors'));
  document.getElementById('btn-show-coordinators')?.addEventListener('click', () => switchSubTab('btn-show-coordinators', 'view-emp-coordinators'));
  document.getElementById('btn-show-companions')?.addEventListener('click', () => switchSubTab('btn-show-companions', 'view-emp-companions'));

  const categorySelect = document.getElementById('emp-category');
  const detailLabel = document.getElementById('emp-detail-label');
  const detailInput = document.getElementById('emp-detail');

  categorySelect?.addEventListener('change', () => {
    const cat = categorySelect.value;
    if (cat === 'STAFF') {
      detailLabel.textContent = 'Designation / Staff Role';
      detailInput.value = 'Field Nurse';
      detailInput.placeholder = 'e.g. Field Nurse, General Nurse';
    } else if (cat === 'DOCTOR') {
      detailLabel.textContent = 'Medical Specialty';
      detailInput.value = 'General Medicine';
      detailInput.placeholder = 'e.g. Cardiology, Geriatrics';
    } else if (cat === 'COORDINATOR') {
      detailLabel.textContent = 'Coordinator Job Title';
      detailInput.value = 'Care Coordinator';
      detailInput.placeholder = 'e.g. Care Coordinator, Operations Lead';
    } else if (cat === 'COMPANION') {
      detailLabel.textContent = 'Companion Role / Note';
      detailInput.value = 'Companion Escort';
      detailInput.placeholder = 'e.g. Companion Escort, Outings Assistant';
    }
  });

  categorySelect?.addEventListener('change', () => {
    const subGroup = document.getElementById('emp-sub-category-group');
    const ageGroup = document.getElementById('emp-age-group');
    const expGroup = document.getElementById('emp-exp-group');
    const isStaff = categorySelect.value === 'STAFF';
    if (subGroup) subGroup.style.display = isStaff ? 'block' : 'none';
    if (ageGroup) ageGroup.style.display = isStaff ? 'block' : 'none';
    if (expGroup) expGroup.style.display = isStaff ? 'block' : 'none';
  });

  categorySelect?.dispatchEvent(new Event('change'));
}

function setupEmployeeCreationForm() {
  const form = document.getElementById('create-employee-form');
  const resultDiv = document.getElementById('emp-result');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Registering Employee...';

    const category = document.getElementById('emp-category').value;
    const subCategory = document.getElementById('emp-sub-category')?.value || 'NURSE';
    const age = document.getElementById('emp-age')?.value.trim() || '';
    const experience = document.getElementById('emp-experience')?.value.trim() || '';

    try {
      const res = await callApi('adminCreateEmployee', {
        category,
        subCategory,
        age,
        experience,
        fullName: document.getElementById('emp-name').value.trim(),
        phone: document.getElementById('emp-phone').value.trim(),
        email: document.getElementById('emp-email').value.trim().toLowerCase(),
        detail: document.getElementById('emp-detail').value.trim()
      });

      resultDiv.className = 'message success';
      resultDiv.innerHTML = `✅ <strong>Employee Created!</strong> ID: <code>${res.id}</code> (Saved to tab: <strong>${res.targetTab}</strong>)`;
      resultDiv.classList.remove('hidden');
      form.reset();
      document.getElementById('emp-category').value = category;
      document.getElementById('emp-category').dispatchEvent(new Event('change'));
      await loadAdminDashboard();
    } catch (err) {
      resultDiv.className = 'message error';
      resultDiv.textContent = 'Registration error: ' + err.message;
      resultDiv.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Employee ID';
    }
  });
}

// -------------------------------------------------------------
// UNIVERSAL PAGINATION HELPER (5 ITEMS PER SCREEN)
// -------------------------------------------------------------
function renderPaginationBar(containerId, totalItems, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, totalItems);

  let buttonsHtml = `<button class="page-num-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">« Prev</button>`;
  for (let i = 1; i <= totalPages; i++) {
    buttonsHtml += `<button class="page-num-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  buttonsHtml += `<button class="page-num-btn ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next »</button>`;

  container.innerHTML = `
    <div class="pagination-info">Showing ${startItem}–${endItem} of ${totalItems} entries (5 per screen)</div>
    <div class="pagination-buttons">${buttonsHtml}</div>
  `;

  container.querySelectorAll('.page-num-btn').forEach(btn => {
    btn.onclick = () => {
      const p = Number(btn.getAttribute('data-page'));
      if (p >= 1 && p <= totalPages && p !== currentPage) onPageChange(p);
    };
  });
}

// -------------------------------------------------------------
// DATA LOADING & DASHBOARD TELEMETRY
// -------------------------------------------------------------
async function loadAdminDashboard() {
  try {
    const data = await callApi('getAdminDashboard');
    console.log("DEBUG: Data received from server:", data);
    allData = data || {};

    try { allData.coordinators = await callApi('adminGetCoordinators') || []; } catch (e) { allData.coordinators = []; }
    try { allData.companions = await callApi('adminGetCompanions') || []; } catch (e) { allData.companions = []; }
    try { allData.hospitalServices = await callApi('getHospitalServices', {}) || []; } catch (e) { allData.hospitalServices = []; }
    try { allData.companionServices = await callApi('getCompanionServices', {}) || []; } catch (e) { allData.companionServices = []; }

    practitionerList = [
      ...(allData.staff || []).map(s => ({ id: String(s.staff_id || '').trim(), name: String(s.full_name || '').trim(), type: 'Nurse' })),
      ...(allData.doctors || []).map(d => ({ id: String(d.doctor_id || '').trim(), name: String(d.full_name || '').trim(), type: 'Doctor' })),
      ...(allData.coordinators || []).map(c => ({ id: String(c.coordinator_id || '').trim(), name: String(c.full_name || '').trim(), type: 'Coordinator' })),
      ...(allData.companions || []).map(c => ({ id: String(c.companion_id || '').trim(), name: String(c.full_name || '').trim(), type: 'Companion' }))
    ];

    const setT = (id, count) => { const el = document.getElementById(id); if (el) el.textContent = count; };
    setT('count-staff', (allData.staff || []).length);
    setT('count-doctors', (allData.doctors || []).length);
    setT('count-coordinators', (allData.coordinators || []).length);
    setT('count-companions', (allData.companions || []).length);

    // THIS LINE fills the "Senior Patient" dropdown on the Work Order form
    populateSeniorDropdowns(allData.seniors || []);

    // THIS LINE fills the "Executive Operations Overview" stat tiles
    renderHomeDashboardTelemetry();

    renderWorkOrders(allData.workOrders || []);
    renderSeniors(allData.seniors || []);
    renderFamilies(allData.families || [], allData.familyLinks || []);
    renderStaff(allData.staff || []);
    renderDoctors(allData.doctors || []);
    renderCoordinators(allData.coordinators || []);
    renderCompanions(allData.companions || []);
    renderSubscriptions(allData.subscriptions || []);
    renderEntitlements(allData.entitlements || []);
    renderReports(allData.reports || []);
    renderReviews(allData.reviews || []);
    renderAudit(allData.logs || []);
    renderHospitalServices(allData.hospitalServices || []);
    renderCompanionServices(allData.companionServices || []);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

function renderHomeDashboardTelemetry() {
  const wos = allData.workOrders || [];
  const seniors = allData.seniors || [];
  const subs = allData.subscriptions || [];
  const reviews = allData.reviews || [];
  const logs = allData.logs || [];

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT('dash-stat-seniors', seniors.filter(s => String(s.status || '').toUpperCase() === 'ACTIVE').length);
  setT('dash-stat-scheduled', wos.filter(w => ['SCHEDULED', 'UNSCHEDULED'].includes(String(w.status || '').toUpperCase())).length);
  setT('dash-stat-inprogress', wos.filter(w => String(w.status || '').toUpperCase() === 'IN_PROGRESS').length);
  setT('dash-stat-complete', wos.filter(w => ['COMPLETE', 'CLOSE'].includes(String(w.status || '').toUpperCase())).length);
  setT('dash-stat-alerts', reviews.filter(r => ['EMERGENCY', 'URGENT'].includes(r.priority) && String(r.status || '').toUpperCase() === 'OPEN').length);
  setT('dash-stat-subs', subs.filter(s => String(s.status || '').toUpperCase() === 'ACTIVE').length);

  const radarTbody = document.querySelector('#dash-live-ops-table tbody');
  if (radarTbody) {
    const liveVisits = wos.filter(w => ['IN_PROGRESS', 'SCHEDULED'].includes(String(w.status || '').toUpperCase())).slice(0, 5);
    radarTbody.innerHTML = liveVisits.length === 0 
      ? '<tr><td colspan="5" style="text-align:center; padding:12px; color:#94a3b8;">No active visits in progress.</td></tr>'
      : liveVisits.map(w => `
        <tr>
          <td><strong>${w.work_order_id}</strong></td>
          <td>${getSeniorName(w.senior_id)}</td>
          <td>${getServiceTypeBadge(w.type)}</td>
          <td>${w.assigned_doctor_id ? getStaffName(w.assigned_doctor_id) : (w.assigned_staff_id ? getStaffName(w.assigned_staff_id) : 'Unassigned')}</td>
          <td><span class="badge ${String(w.status).toUpperCase() === 'IN_PROGRESS' ? 'badge-in-progress' : 'badge-scheduled'}">${w.status}</span></td>
        </tr>`).join('');
  }

  const auditTbody = document.querySelector('#dash-recent-audit-table tbody');
  if (auditTbody) {
    const recentLogs = [...logs].reverse().slice(0, 5);
    auditTbody.innerHTML = recentLogs.length === 0
      ? '<tr><td colspan="3" style="text-align:center; padding:12px; color:#94a3b8;">No recent audit activity.</td></tr>'
      : recentLogs.map(l => `
        <tr>
          <td><small>${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-'}</small></td>
          <td><strong>${l.actor_id || 'System'}</strong> <small style="color:#64748b;">(${l.actor_role || ''})</small></td>
          <td><span class="badge badge-nurse-visit">${l.event || 'ACTION'}</span></td>
        </tr>`).join('');
  }
}

// -------------------------------------------------------------
// HELPER GETTERS
// -------------------------------------------------------------
function getSeniorName(id) {
  const cleanId = String(id || '').trim();
  const s = (allData.seniors || []).find(x => String(x.senior_id || '').trim() === cleanId);
  return s ? s.full_name : cleanId;
}

function getStaffName(id) {
  const cleanId = String(id || '').trim();
  if (!cleanId) return '<span style="color:#a0aec0;">Unassigned</span>';
  const p = practitionerList.find(x => x.id === cleanId);
  if (!p) return cleanId;
  if (p.type === 'Doctor') return `🩺 Dr. ${p.name}`;
  if (p.type === 'Coordinator') return `🧑‍💼 ${p.name}`;
  if (p.type === 'Companion') return `🚗 ${p.name}`;
  return `👩‍⚕️ ${p.name}`;
}


function populateSeniorDropdowns(seniors) {
  const options = '<option value="">-- Choose Senior --</option>' +
    seniors.map(s => `<option value="${String(s.senior_id || '').trim()}">${s.full_name} (${String(s.senior_id || '').trim()})</option>`).join('');

  ['wo-senior-id', 'sub-senior-id', 'report-senior-id', 'gen-report-senior'].forEach(id => {
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
    box.innerHTML = matches.length === 0 ? '<div class="suggestion-empty">No employee found</div>' : matches.map(p => `
      <div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">
        <span>${p.type === 'Doctor' ? 'Dr. ' : ''}${p.name} (${p.id})</span>
        <span class="tag ${p.type === 'Doctor' ? 'badge-doctor-consult' : (p.type === 'Coordinator' ? 'badge-in-progress' : 'badge-nurse-visit')}">${p.type}</span>
      </div>`).join('');
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

function getServiceTypeBadge(type) {
  const t = String(type || '').trim();
  switch (t) {
    case 'NurseVisit': return '<span class="badge badge-nurse-visit">👩‍⚕️ Nurse Visit</span>';
    case 'DoctorConsult': return '<span class="badge badge-doctor-consult">🩺 Doctor Consult</span>';
    case 'HospitalCoordination': return '<span class="badge badge-nurse-visit" style="background:#e0f2fe; color:#0369a1;">📞 Hospital Coord</span>';
    case 'HospitalEscort': return '<span class="badge badge-doctor-consult" style="background:#f3e8ff; color:#7e22ce;">🏥 Hospital Escort</span>';
    case 'CompanionService': return '<span class="badge badge-scheduled" style="background:#fef3c7; color:#92400e;">🚗 Companion Errand</span>';
    default: return `<span class="badge badge-nurse-visit">${t}</span>`;
  }
}


// -------------------------------------------------------------
// TABLE PAGINATION DISPATCHERS (5 ENTRIES PER SCREEN)
// -------------------------------------------------------------
function paginateArray(arr, page) {
  const start = (page - 1) * PAGE_SIZE;
  return arr.slice(start, start + PAGE_SIZE);
}
function updateWorkOrderSlicerCounts(orders) {
  const statusOf = w => String(w.status || '').toUpperCase();
  const escalatedIds = (allData.reviews || [])
    .filter(r => ['URGENT', 'EMERGENCY'].includes(String(r.priority).toUpperCase()) && String(r.status).toUpperCase() === 'OPEN')
    .map(r => r.work_order_id);

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setT('wo-count-all', orders.length);
  setT('wo-count-unscheduled', orders.filter(w => statusOf(w) === 'UNSCHEDULED').length);
  setT('wo-count-scheduled', orders.filter(w => statusOf(w) === 'SCHEDULED').length);
  setT('wo-count-escalated', orders.filter(w => statusOf(w) === 'ESCALATED' || escalatedIds.includes(w.work_order_id)).length);
  setT('wo-count-inprogress', orders.filter(w => statusOf(w) === 'IN_PROGRESS').length);
  setT('wo-count-complete', orders.filter(w => ['COMPLETE', 'CLOSE'].includes(statusOf(w))).length);
  setT('wo-count-cancelled', orders.filter(w => statusOf(w) === 'CANCELLED').length);
}

function renderWorkOrders(orders) {
  const tbody = document.querySelector('#admin-wo-table tbody');
  if (!tbody) return;

  // NEW: update the 7 status badge counts every render
  updateWorkOrderSlicerCounts(orders);

  const statusOf = w => String(w.status || '').toUpperCase();
  let filtered = [...orders];

  if (activeSlicer === 'UNSCHEDULED') {
    filtered = filtered.filter(w => statusOf(w) === 'UNSCHEDULED');
  } else if (activeSlicer === 'SCHEDULED') {
    filtered = filtered.filter(w => statusOf(w) === 'SCHEDULED');
  } else if (activeSlicer === 'ESCALATED') {
    const escalatedIds = (allData.reviews || [])
      .filter(r => ['URGENT', 'EMERGENCY'].includes(String(r.priority).toUpperCase()) && String(r.status).toUpperCase() === 'OPEN')
      .map(r => r.work_order_id);
    filtered = filtered.filter(w => statusOf(w) === 'ESCALATED' || escalatedIds.includes(w.work_order_id));
  } else if (activeSlicer === 'IN_PROGRESS') {
    filtered = filtered.filter(w => statusOf(w) === 'IN_PROGRESS');
  } else if (activeSlicer === 'COMPLETE') {
    filtered = filtered.filter(w => ['COMPLETE', 'CLOSE'].includes(statusOf(w)));
  } else if (activeSlicer === 'CANCELLED') {
    filtered = filtered.filter(w => statusOf(w) === 'CANCELLED');
  }
  // activeSlicer === 'ALL' → no filtering applied

  filtered.reverse();
  const slice = paginateArray(filtered, pageState.wo);

  tbody.innerHTML = slice.length === 0
    ? '<tr><td colspan="7" style="text-align:center; padding:18px; color:#94a3b8;">No work orders found.</td></tr>'
    : slice.map(wo => {
      const st = String(wo.status || '').toUpperCase();
      const isClosed = ['COMPLETE', 'CLOSE'].includes(st);
      const badgeColor = isClosed ? 'badge-complete' : (st === 'IN_PROGRESS' ? 'badge-in-progress' : (st === 'CANCELLED' ? 'badge-cancelled' : 'badge-scheduled'));
      const displayTime = wo.scheduled_at ? new Date(wo.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : (wo.created_at ? new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-');
      const assigned = wo.assigned_doctor_id ? getStaffName(wo.assigned_doctor_id) : (wo.assigned_staff_id ? getStaffName(wo.assigned_staff_id) : '<span style="color:#a0aec0;">Unassigned</span>');

      return `
        <tr>
          <td><strong>${wo.work_order_id}</strong></td>
          <td>${getSeniorName(wo.senior_id)}</td>
          <td>${getServiceTypeBadge(wo.type)}</td>
          <td>${assigned}</td>
          <td>${displayTime}</td>
          <td><span class="badge ${badgeColor}">${wo.status}</span></td>
          <td>${!isClosed && st !== 'CANCELLED' ? `<button class="override-btn danger" data-id="${wo.work_order_id}">Cancel</button>` : `<span style="color:#a0aec0;font-size:12px;">Locked</span>`}</td>
        </tr>`;
    }).join('');

  tbody.querySelectorAll('.override-btn').forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt('Cancellation reason:');
      if (!reason) return;
      try {
        await callApi('adminOverrideWorkOrder', { workOrderId: btn.getAttribute('data-id'), newStatus: 'CANCELLED', reason });
        await loadAdminDashboard();
      } catch (err) { alert('Override failed: ' + err.message); }
    };
  });

  renderPaginationBar('wo-pagination', filtered.length, pageState.wo, (p) => { pageState.wo = p; renderWorkOrders(orders); });
}

function renderSeniors(seniors) {
  const tbody = document.querySelector('#admin-seniors-table tbody');
  if (!tbody) return;
  const slice = paginateArray(seniors, pageState.seniors);
  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No seniors registered.</td></tr>' : slice.map(s => `
    <tr>
      <td><strong>${s.senior_id}</strong></td>
      <td>${s.full_name}</td>
      <td>${s.phone || '-'}</td>
      <td>${s.email || '-'}</td>
      <td>${s.address || '-'}</td>
      <td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td>
    </tr>`).join('');
  renderPaginationBar('seniors-pagination', seniors.length, pageState.seniors, (p) => { pageState.seniors = p; renderSeniors(seniors); });
}

function renderFamilies(families, links) {
  const tbody = document.querySelector('#admin-families-table tbody');
  if (!tbody) return;
  const slice = paginateArray(families, pageState.families);
  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No families recorded.</td></tr>' : slice.map(f => {
    const link = (links || []).find(l => l.family_id === f.family_id);
    return `
      <tr>
        <td><strong>${f.family_id}</strong></td>
        <td>${f.full_name}</td>
        <td>${f.relationship || '-'}</td>
        <td>${link ? getSeniorName(link.senior_id) : 'Unlinked'}</td>
        <td>${f.email || '-'}</td>
        <td>${f.phone || '-'}</td>
      </tr>`;
  }).join('');
  renderPaginationBar('families-pagination', families.length, pageState.families, (p) => { pageState.families = p; renderFamilies(families, links); });
}

function renderStaff(staff) {
  const tbody = document.querySelector('#admin-staff-table tbody');
  if (!tbody) return;

  const slice = staff.slice((pageState.staff - 1) * PAGE_SIZE, pageState.staff * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10">No staff recorded.</td></tr>';
    renderPaginationBar('staff-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(st => {
    const cat = String(st.category || 'NURSE').toUpperCase();
    const specialtyBadge = cat === 'COMPANION_ESCORT'
      ? '<span class="badge badge-scheduled" style="background:#fef3c7; color:#92400e;">🚗 Companion Escort</span>'
      : '<span class="badge badge-nurse-visit">👩‍⚕️ Field Nurse</span>';
    const isActive = String(st.status).toUpperCase() === 'ACTIVE';

    return `
      <tr>
        <td><strong>${st.staff_id}</strong></td>
        <td>${st.full_name}</td>
        <td>${st.email || '-'}</td>
        <td>${st.phone || '-'}</td>
        <td>${specialtyBadge}</td>
        <td>${st.age || '-'}</td>
        <td>${st.experience || '-'}</td>
        <td>${st.role || 'Staff'}</td>
        <td><span class="badge ${isActive ? 'badge-complete' : 'badge-cancelled'}">${st.status || 'ACTIVE'}</span></td>
        <td>
          <button class="sort-btn toggle-staff-status" data-id="${st.staff_id}" data-current="${st.status}">
            ${isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.toggle-staff-status').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const current = btn.getAttribute('data-current');
      try {
        await callApi('adminUpdateStaffStatus', { staffId: id, status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
        await loadAdminDashboard();
      } catch (err) { alert('Error: ' + err.message); }
    };
  });

  renderPaginationBar('staff-pagination', staff.length, pageState.staff, (p) => { pageState.staff = p; renderStaff(staff); });
}

function renderDoctors(doctors) {
  const tbody = document.querySelector('#admin-doctors-table tbody');
  if (!tbody) return;
  const slice = paginateArray(doctors, pageState.doctors);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10">No doctors recorded.</td></tr>';
    renderPaginationBar('doctors-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(d => {
    const isActive = String(d.status).toUpperCase() === 'ACTIVE';
    return `
      <tr>
        <td><strong>${d.doctor_id}</strong></td>
        <td>${d.full_name}</td>
        <td>${d.email || '-'}</td>
        <td>${d.phone || '-'}</td>
        <td><span class="badge badge-doctor-consult">${d.specialty || 'General'}</span></td>
        <td>${d.age || '-'}</td>
        <td>${d.experience || '-'}</td>
        <td>Doctor</td>
        <td><span class="badge ${isActive ? 'badge-complete' : 'badge-cancelled'}">${d.status || 'ACTIVE'}</span></td>
        <td>
          <button class="sort-btn toggle-doctor-status" data-id="${d.doctor_id}" data-current="${d.status}">
            ${isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.toggle-doctor-status').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const current = btn.getAttribute('data-current');
      try {
        await callApi('adminUpdateDoctorStatus', { doctorId: id, status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
        await loadAdminDashboard();
      } catch (err) { alert('Error: ' + err.message); }
    };
  });

  renderPaginationBar('doctors-pagination', doctors.length, pageState.doctors, (p) => { pageState.doctors = p; renderDoctors(doctors); });
}

function renderCoordinators(coordinators) {
  const tbody = document.querySelector('#admin-coordinators-table tbody');
  if (!tbody) return;
  const slice = paginateArray(coordinators, pageState.coordinators);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10">No coordinators recorded.</td></tr>';
    renderPaginationBar('coordinators-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(c => {
    const isActive = String(c.status).toUpperCase() === 'ACTIVE';
    return `
      <tr>
        <td><strong>${c.coordinator_id}</strong></td>
        <td>${c.full_name}</td>
        <td>${c.email || '-'}</td>
        <td>${c.phone || '-'}</td>
        <td>-</td>
        <td>${c.age || '-'}</td>
        <td>${c.experience || '-'}</td>
        <td>${c.role || 'Care Coordinator'}</td>
        <td><span class="badge ${isActive ? 'badge-complete' : 'badge-cancelled'}">${c.status || 'ACTIVE'}</span></td>
        <td>
          <button class="sort-btn toggle-crd-status" data-id="${c.coordinator_id}" data-current="${c.status}">
            ${isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.toggle-crd-status').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const current = btn.getAttribute('data-current');
      try {
        await callApi('adminUpdateCoordinatorStatus', { coordinatorId: id, status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
        await loadAdminDashboard();
      } catch (err) { alert('Error: ' + err.message); }
    };
  });

  renderPaginationBar('coordinators-pagination', coordinators.length, pageState.coordinators, (p) => { pageState.coordinators = p; renderCoordinators(coordinators); });
}

function renderCompanions(companions) {
  const tbody = document.querySelector('#admin-companions-table tbody');
  if (!tbody) return;

  if (companions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">No companions registered.</td></tr>';
    return;
  }

  tbody.innerHTML = companions.map(c => {
    const isActive = String(c.status).toUpperCase() === 'ACTIVE';
    const cat = String(c.category || 'COMPANION_ESCORT').toUpperCase();
    const specialtyBadge = cat === 'COMPANION_ESCORT'
      ? '<span class="badge badge-scheduled" style="background:#fef3c7; color:#92400e;">🚗 Companion Escort</span>'
      : `<span class="badge badge-nurse-visit">${c.category || '-'}</span>`;

    return `
      <tr>
        <td><strong>${c.companion_id}</strong></td>
        <td>${c.full_name}</td>
        <td>${c.email || '-'}</td>
        <td>${c.phone || '-'}</td>
        <td>${specialtyBadge}</td>
        <td>${c.age || '-'}</td>
        <td>${c.experience || '-'}</td>
        <td>${c.role || 'Companion'}</td>
        <td><span class="badge ${isActive ? 'badge-complete' : 'badge-cancelled'}">${c.status || 'ACTIVE'}</span></td>
        <td>
          <button class="sort-btn toggle-comp-status" data-id="${c.companion_id}" data-current="${c.status}">
            ${isActive ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.toggle-comp-status').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const current = btn.getAttribute('data-current');
      try {
        await callApi('adminUpdateCompanionStatus', { companionId: id, status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
        await loadAdminDashboard();
      } catch (err) { alert('Error: ' + err.message); }
    };
  });
}

function renderHospitalServices(services) {
  const tbody = document.querySelector('#admin-hospital-services-table tbody');
  if (!tbody) return;
  const sorted = [...services].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const slice = paginateArray(sorted, pageState.hospital);

  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No hospital bookings yet.</td></tr>' : slice.map(s => `
    <tr>
      <td><strong>${s.service_id}</strong></td>
      <td>${getSeniorName(s.senior_id)}</td>
      <td><span class="badge ${s.service_type === 'HOSPITAL_ESCORT' ? 'badge-doctor-consult' : 'badge-nurse-visit'}">${s.service_type === 'HOSPITAL_ESCORT' ? '🏥 Escort' : '📞 Coordination'}</span></td>
      <td>${s.preferred_hospital || '-'}</td>
      <td><span class="badge ${s.status === 'COMPLETED' ? 'badge-complete' : 'badge-scheduled'}">${s.status}</span></td>
      <td>${s.assigned_staff_id ? getStaffName(s.assigned_staff_id) : (s.assigned_coordinator_id ? 'Coord: ' + s.assigned_coordinator_id : '-')}</td>
    </tr>`).join('');
  renderPaginationBar('hospital-pagination', sorted.length, pageState.hospital, (p) => { pageState.hospital = p; renderHospitalServices(services); });
}

function renderCompanionServices(services) {
  const tbody = document.querySelector('#admin-companion-services-table tbody');
  if (!tbody) return;
  const sorted = [...services].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const slice = paginateArray(sorted, pageState.companion);

  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No companion bookings yet.</td></tr>' : slice.map(s => `
    <tr>
      <td><strong>${s.service_id}</strong></td>
      <td>${getSeniorName(s.senior_id)}</td>
      <td><span class="badge badge-doctor-consult">${s.companion_type}</span></td>
      <td>${s.destination || '-'}</td>
      <td><span class="badge ${s.status === 'COMPLETED' ? 'badge-complete' : 'badge-scheduled'}">${s.status}</span></td>
      <td>${s.assigned_staff_id ? getStaffName(s.assigned_staff_id) : '-'}</td>
    </tr>`).join('');
  renderPaginationBar('companion-pagination', sorted.length, pageState.companion, (p) => { pageState.companion = p; renderCompanionServices(services); });
}

function renderSubscriptions(subs) {
  const tbody = document.querySelector('#admin-subs-table tbody');
  if (!tbody) return;

  const total = subs.length;
  const page = pageState.subs;
  const slice = subs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No active subscriptions found.</td></tr>';
    renderPaginationBar('subs-pagination', 0, 1, () => {});
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  tbody.innerHTML = slice.map(s => {
    let computedStatus = String(s.status || 'ACTIVE').toUpperCase();
    let badgeCls = 'badge-complete';

    if (computedStatus !== 'CANCELLED') {
      if (s.end_date) {
        let exp = (s.end_date instanceof Date) ? new Date(s.end_date.getTime()) : new Date(String(s.end_date).trim());
        exp.setHours(23, 59, 59, 999);
        if (exp < today) {
          computedStatus = 'EXPIRED';
          badgeCls = 'badge-cancelled';
        }
      }
    } else {
      badgeCls = 'badge-cancelled';
    }

    return `
      <tr>
        <td><strong>${s.subscription_id}</strong></td>
        <td>${getSeniorName(s.senior_id)}</td>
        <td>${s.plan_name}</td>
        <td>${s.start_date ? String(s.start_date).slice(0, 10) : '-'}</td>
        <td><strong>${s.end_date ? String(s.end_date).slice(0, 10) : '-'}</strong></td>
        <td><span class="badge ${badgeCls}">${computedStatus}</span></td>
      </tr>
    `;
  }).join('');

  renderPaginationBar('subs-pagination', total, page, (p) => {
    pageState.subs = p;
    renderSubscriptions(subs);
  });
}

function renderEntitlements(ents) {
  const tbody = document.querySelector('#admin-entitlements-table tbody');
  if (!tbody) return;
  const slice = paginateArray(ents, pageState.ent);
  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="4">No entitlement records found.</td></tr>' : slice.map(e => `
    <tr>
      <td><strong>${getSeniorName(e.senior_id)}</strong></td>
      <td>${e.month}</td>
      <td>${e.nurse_used} / ${e.nurse_allowed}</td>
      <td>${e.doctor_used} / ${e.doctor_allowed}</td>
    </tr>`).join('');
  renderPaginationBar('ent-pagination', ents.length, pageState.ent, (p) => { pageState.ent = p; renderEntitlements(ents); });
}

function renderReports(reports) {
  const tbody = document.querySelector('#admin-reports-table tbody');
  if (!tbody) return;
  const slice = paginateArray(reports, pageState.reports);

  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No diagnostic reports uploaded yet.</td></tr>' : slice.map(r => {
    const isCare = (r.file_url === 'INTERNAL_CARE_JOURNAL');
    return `
      <tr>
        <td><strong>${r.report_id}</strong></td>
        <td><strong>${getSeniorName(r.senior_id)}</strong></td>
        <td><span class="badge ${isCare ? 'badge-complete' : 'badge-nurse-visit'}">${r.type}</span></td>
        <td>${isCare ? '<span class="badge badge-doctor-consult">Care Journal</span>' : `<a href="${r.file_url}" target="_blank" rel="noopener">Open Doc ↗</a>`}</td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '-'}</td>
        <td><button class="share-btn" data-id="${r.report_id}" data-senior="${r.senior_id}">Share 72h</button></td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.share-btn').forEach(btn => {
    btn.onclick = async () => {
      const reportId = btn.getAttribute('data-id');
      try {
        const res = await callApi('createReportLink', { reportId, expiryHours: 72 });
        const shareUrl = `${window.location.origin}${window.location.pathname.replace('admin.html', '')}report.html?token=${res.token}`;
        prompt('72-Hour Link Created. Copy below:', shareUrl);
      } catch (err) { alert('Share error: ' + err.message); }
    };
  });

  renderPaginationBar('reports-pagination', reports.length, pageState.reports, (p) => { 
    pageState.reports = p; 
    renderReports(reports); 
  });
}

function renderReviews(revs) {
  const tbody = document.querySelector('#admin-reviews-table tbody');
  if (!tbody) return;
  const slice = paginateArray(revs, pageState.reviews);

  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No clinical reviews pending.</td></tr>' : slice.map(r => {
    const color = r.priority === 'EMERGENCY' ? 'badge-cancelled' : (r.priority === 'URGENT' ? 'badge-scheduled' : 'badge-doctor-consult');
    return `
      <tr>
        <td><strong>${r.review_id}</strong></td>
        <td>${getSeniorName(r.senior_id)}</td>
        <td><span class="badge ${color}">${r.priority}</span></td>
        <td>${r.reason}</td>
        <td>${getStaffName(r.assigned_doctor_id)}</td>
        <td><span class="badge badge-scheduled">${r.status}</span></td>
      </tr>`;
  }).join('');

  renderPaginationBar('reviews-pagination', revs.length, pageState.reviews, (p) => { 
    pageState.reviews = p; 
    renderReviews(revs); 
  });
}

function renderAudit(logs) {
  const tbody = document.querySelector('#admin-audit-table tbody');
  if (!tbody) return;
  const logsRev = [...logs].reverse();
  const slice = paginateArray(logsRev, pageState.audit);

  tbody.innerHTML = slice.length === 0 ? '<tr><td colspan="6">No audit records found.</td></tr>' : slice.map(l => `
    <tr>
      <td><small>${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-'}</small></td>
      <td>${l.actor_id}</td>
      <td>${l.actor_role}</td>
      <td><strong>${l.event}</strong></td>
      <td>${l.work_order_id || '-'}</td>
      <td><small>${l.reason || ''}</small></td>
    </tr>`).join('');

  renderPaginationBar('audit-pagination', logsRev.length, pageState.audit, (p) => { 
    pageState.audit = p; 
    renderAudit(logs); 
  });
}

// -------------------------------------------------------------
// SEARCH INPUTS BINDING
// -------------------------------------------------------------
function setupTableSearches() {
  const binds = [
    { id: 'search-wo', filter: (q) => allData.workOrders.filter(w => JSON.stringify(w).toLowerCase().includes(q)), render: (d) => { pageState.wo = 1; renderWorkOrders(d); } },
    { id: 'search-seniors', filter: (q) => allData.seniors.filter(s => JSON.stringify(s).toLowerCase().includes(q)), render: (d) => { pageState.seniors = 1; renderSeniors(d); } },
    { id: 'search-families', filter: (q) => allData.families.filter(f => JSON.stringify(f).toLowerCase().includes(q)), render: (d) => { pageState.families = 1; renderFamilies(d, allData.familyLinks); } },
    { id: 'search-staff', filter: (q) => allData.staff.filter(st => JSON.stringify(st).toLowerCase().includes(q)), render: (d) => { pageState.staff = 1; renderStaff(d); } },
    { id: 'search-doctors', filter: (q) => allData.doctors.filter(dc => JSON.stringify(dc).toLowerCase().includes(q)), render: (d) => { pageState.doctors = 1; renderDoctors(d); } },
    { id: 'search-companions', filter: (q) => (allData.companions || []).filter(c => JSON.stringify(c).toLowerCase().includes(q)), render: (d) => { renderCompanions(d); } },
    { id: 'search-coordinators', filter: (q) => (allData.coordinators || []).filter(c => JSON.stringify(c).toLowerCase().includes(q)), render: (d) => { pageState.coordinators = 1; renderCoordinators(d); } }
  ];



  binds.forEach(({ id, filter, render }) => {
    const input = document.getElementById(id);
    if (input && !input.dataset.bound) {
      input.dataset.bound = 'true';
      input.oninput = () => {
        const q = input.value.trim().toLowerCase();
        render(filter(q));
      };
    }
  });
}

// -------------------------------------------------------------
// ACTION FORMS SETUP
// -------------------------------------------------------------
function setupActionForms() {
  // 1. Unified Work Order Booking Form
  document.getElementById('create-wo-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const seniorId = String(document.getElementById('wo-senior-id')?.value || '').trim();
    const serviceType = document.getElementById('wo-type')?.value;
    const resultDiv = document.getElementById('wo-result');
    resultDiv.className = 'message hidden';

    if (!seniorId) return alert('Please choose a Senior Patient.');

    const isClinical = (serviceType === 'NurseVisit' || serviceType === 'DoctorConsult');
    if (isClinical) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const hasActiveSub = (allData.subscriptions || []).some(s => {
        const sId = String(s.senior_id || '').trim();
        const st = String(s.status || '').trim().toUpperCase();
        if (sId !== seniorId || st !== 'ACTIVE') return false;
        if (!s.end_date) return true;

        let exp = (s.end_date instanceof Date) ? new Date(s.end_date.getTime()) : new Date(String(s.end_date).trim());
        exp.setHours(23, 59, 59, 999);
        return exp >= today;
      });

      if (!hasActiveSub) {
        alert('ALERT: Senior ' + seniorId + ' has NO Active Subscription for clinical care. Please check Subscriptions tab.');
        return;
      }
    }

    let staffId = String(document.getElementById('wo-staff-id')?.value || '').trim();
    const staffSearchText = String(document.getElementById('wo-staff-search')?.value || '').trim().toLowerCase();
    if (!staffId && staffSearchText) {
      const match = practitionerList.find(p =>
        p.name.toLowerCase() === staffSearchText ||
        p.id.toLowerCase() === staffSearchText ||
        `dr. ${p.name.toLowerCase()}` === staffSearchText
      );
      if (match) staffId = match.id;
    }

    const scheduledVal = document.getElementById('wo-scheduled-at').value;
    const scheduledIso = scheduledVal ? new Date(scheduledVal).toISOString() : new Date().toISOString();

    const payload = {
      seniorId: seniorId,
      type: serviceType,
      scheduledAt: scheduledIso,
      staffId: staffId,
      notes: document.getElementById('wo-notes')?.value.trim() || '',
      preferredHospital: document.getElementById('wo-hsv-hospital')?.value.trim() || '',
      specialty: document.getElementById('wo-hsv-specialty')?.value.trim() || '',
      hospitalTravelPayer: document.getElementById('wo-hsv-travel-payer')?.value || 'FAMILY',
      companionType: document.getElementById('wo-cmp-subtype')?.value || 'OUTINGS',
      destination: document.getElementById('wo-cmp-destination')?.value.trim() || '',
      itemsList: document.getElementById('wo-cmp-items')?.value.trim() || '',
      companionTravelPayer: 'FAMILY'
    };

    try {
      const res = await callApi('createWorkOrder', payload);
      resultDiv.innerHTML = `<strong>Work Order Created!</strong> ID: <code>${res.workOrderId}</code> | Start PIN: <strong>${res.startCode}</strong> | End PIN: <strong>${res.endCode}</strong>`;
      resultDiv.className = 'message success';
      resultDiv.classList.remove('hidden');

      document.getElementById('create-wo-form').reset();
      document.getElementById('wo-staff-search').value = '';
      document.getElementById('wo-staff-id').value = '';
      document.getElementById('wo-hospital-fields').style.display = 'none';
      document.getElementById('wo-companion-fields').style.display = 'none';

      await loadAdminDashboard();
    } catch (err) {
      resultDiv.innerHTML = 'Error: ' + err.message;
      resultDiv.className = 'message error';
      resultDiv.classList.remove('hidden');
    }
  });

  // 2. Senior + Primary Family Creation Form
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

  // 3. Subscription Creation Form
  document.getElementById('create-sub-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const seniorId = document.getElementById('sub-senior-id')?.value;
    const planName = document.getElementById('sub-plan-name')?.value.trim();
    const startDate = document.getElementById('sub-start-date')?.value;
    const nurseVisits = Number(document.getElementById('sub-nurse-visits')?.value || 2);
    const doctorConsults = Number(document.getElementById('sub-doctor-consults')?.value || 1);

    if (!seniorId) return alert('Please choose a Senior Patient first.');

    try {
      const res = await callApi('adminCreateSubscription', {
        seniorId: seniorId,
        planName: planName,
        startDate: startDate,
        nurseVisits: nurseVisits,
        doctorConsults: doctorConsults
      });
      alert(`✅ Subscription Created! Sub ID: ${res.subscriptionId} (Valid 30 days until ${res.endDate})`);
      document.getElementById('create-sub-form').reset();
      document.getElementById('sub-start-date').value = new Date().toISOString().slice(0, 10);
      await loadAdminDashboard();
    } catch (err) {
      alert('Subscription error: ' + err.message);
    }
  });

  // 4. Diagnostic Report Registration Form
  document.getElementById('create-report-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const seniorId = document.getElementById('report-senior-id')?.value;
    const type = document.getElementById('report-type')?.value;
    const fileUrl = document.getElementById('report-url')?.value.trim();

    if (!seniorId) return alert('Please choose a Senior Patient first.');

    try {
      await callApi('adminCreateReport', {
        seniorId: seniorId,
        type: type,
        fileUrl: fileUrl
      });
      alert('✅ Diagnostic report registered successfully!');
      document.getElementById('create-report-form').reset();
      await loadAdminDashboard();
    } catch (err) {
      alert('Report registration error: ' + err.message);
    }
  });

  // 5. Generate 72-Hour Clinical Care Summary Button
  document.getElementById('btn-gen-care-report')?.addEventListener('click', async () => {
    const seniorSelect = document.getElementById('gen-report-senior');
    const seniorId = seniorSelect ? seniorSelect.value.trim() : '';
    if (!seniorId) return alert('Please choose a Senior Patient first.');

    const btn = document.getElementById('btn-gen-care-report');
    btn.disabled = true;
    btn.textContent = 'Generating Care Summary...';

    try {
      const res = await callApi('generateClinicalCareReport', { seniorId: seniorId });
      const shareUrl = `${window.location.origin}${window.location.pathname.replace('admin.html', '')}report.html?token=${res.token}`;
      await loadAdminDashboard();

      const input = prompt(`72-Hour Care Summary Generated for ${res.seniorName}!\n\nSecure Link:\n${shareUrl}\n\nType 'copy' to copy, or enter an email address to send directly:`);
      if (input) {
        if (input.toLowerCase() === 'copy') {
          await navigator.clipboard.writeText(shareUrl);
          alert('Link copied to clipboard!');
        } else if (input.includes('@')) {
          await callApi('shareReportByEmail', {
            recipientEmail: input.trim(),
            seniorName: res.seniorName,
            reportType: 'Clinical Assessment & Care Journal',
            secureUrl: shareUrl
          });
          alert('Care report link emailed to ' + input.trim());
        }
      }
    } catch (err) {
      alert('Error generating care summary: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate 72-Hour Shareable Care Summary';
    }
  });
}



// -------------------------------------------------------------
// STARTUP BOOTSTRAPPER
// -------------------------------------------------------------
init().catch(err => {
  console.error('Admin Init Failure:', err);
});






