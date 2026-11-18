import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allData = { 
  seniors: [], 
  workOrders: [], 
  staff: [], 
  doctors: [], 
  coordinators: [], 
  families: [], 
  familyLinks: [], 
  subscriptions: [], 
  entitlements: [], 
  reports: [], 
  reviews: [], 
  logs: [], 
  hospitalServices: [], 
  companionServices: [] 
};
let practitionerList = [];
let activeSlicer = 'ALL';

const PAGE_SIZE = 5;
const pageState = {
  wo: 1,
  seniors: 1,
  families: 1,
  staff: 1,
  doctors: 1,
  coordinators: 1,
  subs: 1,
  ent: 1,
  reports: 1,
  reviews: 1,
  audit: 1,
  hospital: 1,
  companion: 1
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

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', signOut);

  const dateInput = document.getElementById('wo-scheduled-at');
  if (dateInput) {
    const d = new Date(Date.now() + 3600000);
    dateInput.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  const subDate = document.getElementById('sub-start-date');
  if (subDate) subDate.value = new Date().toISOString().slice(0, 10);

  const refreshBtn = document.getElementById('btn-refresh-dashboard');
  if (refreshBtn) refreshBtn.addEventListener('click', loadAdminDashboard);

  setupSearchableStaffDropdown();
  setupTableSearches();
  setupActionForms();
  await loadAdminDashboard();
}

function setupTabs() {
  document.querySelectorAll('.admin-nav .nav-tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.admin-nav .nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const target = document.getElementById(targetId);
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
  document.querySelectorAll('.sub-nav .sub-tab').forEach(btn => {
    btn.onclick = () => {
      if (btn.closest('.card')?.querySelector('#admin-wo-table')) {
        document.querySelectorAll('.sub-nav .sub-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeSlicer = btn.getAttribute('data-slicer');
        pageState.wo = 1;
        renderWorkOrders(allData.workOrders || []);
      }
    };
  });
}

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
  const btnStaff = document.getElementById('btn-show-staff');
  const btnDoctors = document.getElementById('btn-show-doctors');
  const btnCoordinators = document.getElementById('btn-show-coordinators');

  const viewStaff = document.getElementById('view-emp-staff');
  const viewDoctors = document.getElementById('view-emp-doctors');
  const viewCoordinators = document.getElementById('view-emp-coordinators');

  btnStaff?.addEventListener('click', () => {
    btnStaff.classList.add('active');
    btnDoctors?.classList.remove('active');
    btnCoordinators?.classList.remove('active');
    viewStaff?.classList.remove('hidden');
    viewDoctors?.classList.add('hidden');
    viewCoordinators?.classList.add('hidden');
  });

  btnDoctors?.addEventListener('click', () => {
    btnDoctors.classList.add('active');
    btnStaff?.classList.remove('active');
    btnCoordinators?.classList.remove('active');
    viewDoctors?.classList.remove('hidden');
    viewStaff?.classList.add('hidden');
    viewCoordinators?.classList.add('hidden');
  });

  btnCoordinators?.addEventListener('click', () => {
    btnCoordinators.classList.add('active');
    btnStaff?.classList.remove('active');
    btnDoctors?.classList.remove('active');
    viewCoordinators?.classList.remove('hidden');
    viewStaff?.classList.add('hidden');
    viewDoctors?.classList.add('hidden');
  });

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
    }
  });
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
    const fullName = document.getElementById('emp-name').value.trim();
    const phone = document.getElementById('emp-phone').value.trim();
    const email = document.getElementById('emp-email').value.trim().toLowerCase();
    const detail = document.getElementById('emp-detail').value.trim();

    try {
      const res = await callApi('adminCreateEmployee', { category, fullName, phone, email, detail });
      resultDiv.className = 'message success';
      resultDiv.innerHTML = `✅ <strong>Employee Created!</strong> ID: <code>${res.id}</code> (Saved to: <strong>${res.targetTab}</strong>)`;
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

function renderPaginationBar(containerId, totalItems, currentPage, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, totalItems);

  let buttonsHtml = '';
  buttonsHtml += `<button class="page-num-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">« Prev</button>`;

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
      if (p >= 1 && p <= totalPages && p !== currentPage) {
        onPageChange(p);
      }
    };
  });
}

async function loadAdminDashboard() {
  try {
    const data = await callApi('getAdminDashboard');
    allData = data || {};

    let coordinators = [];
    try { coordinators = await callApi('adminGetCoordinators') || []; } catch (e) {}
    allData.coordinators = coordinators;

    let hospitalSvcs = [];
    try { hospitalSvcs = await callApi('getHospitalServices', {}) || []; } catch (e) {}
    allData.hospitalServices = hospitalSvcs;

    let companionSvcs = [];
    try { companionSvcs = await callApi('getCompanionServices', {}) || []; } catch (e) {}
    allData.companionServices = companionSvcs;

    practitionerList = [
      ...(allData.staff || []).map(s => ({ id: String(s.staff_id || '').trim(), name: String(s.full_name || '').trim(), type: 'Nurse' })),
      ...(allData.doctors || []).map(d => ({ id: String(d.doctor_id || '').trim(), name: String(d.full_name || '').trim(), type: 'Doctor' })),
      ...(allData.coordinators || []).map(c => ({ id: String(c.coordinator_id || '').trim(), name: String(c.full_name || '').trim(), type: 'Coordinator' }))
    ];

    const setEl = (id, count) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    };
    setEl('count-staff', (allData.staff || []).length);
    setEl('count-doctors', (allData.doctors || []).length);
    setEl('count-coordinators', (allData.coordinators || []).length);

    populateSeniorDropdowns(allData.seniors || []);
    renderHomeDashboardTelemetry();

    renderWorkOrders(allData.workOrders || []);
    renderSeniors(allData.seniors || []);
    renderFamilies(allData.families || [], allData.familyLinks || []);
    renderStaff(allData.staff || []);
    renderDoctors(allData.doctors || []);
    renderCoordinators(allData.coordinators || []);
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

  const countActiveSeniors = seniors.filter(s => String(s.status || '').toUpperCase() === 'ACTIVE').length;
  const countScheduled = wos.filter(w => String(w.status || '').toUpperCase() === 'SCHEDULED' || String(w.status || '').toUpperCase() === 'UNSCHEDULED').length;
  const countInProgress = wos.filter(w => String(w.status || '').toUpperCase() === 'IN_PROGRESS').length;
  const countCompleted = wos.filter(w => String(w.status || '').toUpperCase() === 'COMPLETE' || String(w.status || '').toUpperCase() === 'CLOSE').length;
  const countAlerts = reviews.filter(r => (r.priority === 'EMERGENCY' || r.priority === 'URGENT') && String(r.status || '').toUpperCase() === 'OPEN').length;
  const countSubs = subs.filter(s => String(s.status || '').toUpperCase() === 'ACTIVE').length;

  const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setT('dash-stat-seniors', countActiveSeniors);
  setT('dash-stat-scheduled', countScheduled);
  setT('dash-stat-inprogress', countInProgress);
  setT('dash-stat-complete', countCompleted);
  setT('dash-stat-alerts', countAlerts);
  setT('dash-stat-subs', countSubs);

  const radarTbody = document.querySelector('#dash-live-ops-table tbody');
  if (radarTbody) {
    const liveVisits = wos.filter(w => String(w.status || '').toUpperCase() === 'IN_PROGRESS' || String(w.status || '').toUpperCase() === 'SCHEDULED').slice(0, 5);
    if (liveVisits.length === 0) {
      radarTbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:12px; color:#94a3b8;">No active visits in progress right now.</td></tr>';
    } else {
      radarTbody.innerHTML = liveVisits.map(w => {
        const isInProgress = String(w.status || '').toUpperCase() === 'IN_PROGRESS';
        const badgeCls = isInProgress ? 'badge-in-progress' : 'badge-scheduled';
        const assignedName = w.assigned_doctor_id ? getStaffName(w.assigned_doctor_id) : (w.assigned_staff_id ? getStaffName(w.assigned_staff_id) : 'Unassigned');
        return `
          <tr>
            <td><strong>${w.work_order_id}</strong></td>
            <td>${getSeniorName(w.senior_id)}</td>
            <td>${getServiceTypeBadge(w.type)}</td>
            <td>${assignedName}</td>
            <td><span class="badge ${badgeCls}">${w.status}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  const auditTbody = document.querySelector('#dash-recent-audit-table tbody');
  if (auditTbody) {
    const recentLogs = [...logs].reverse().slice(0, 5);
    if (recentLogs.length === 0) {
      auditTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:12px; color:#94a3b8;">No recent audit activity.</td></tr>';
    } else {
      auditTbody.innerHTML = recentLogs.map(l => `
        <tr>
          <td><small>${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-'}</small></td>
          <td><strong>${l.actor_id || 'System'}</strong> <small style="color:#64748b;">(${l.actor_role || ''})</small></td>
          <td><span class="badge badge-nurse-visit">${l.event || 'ACTION'}</span></td>
        </tr>
      `).join('');
    }
  }
}

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
    if (matches.length === 0) {
      box.innerHTML = '<div class="suggestion-empty">No employee found</div>';
    } else {
      box.innerHTML = matches.map(p => `
        <div class="suggestion-item" data-id="${p.id}" data-name="${p.name}">
          <span>${p.type === 'Doctor' ? 'Dr. ' : ''}${p.name} (${p.id})</span>
          <span class="tag ${p.type === 'Doctor' ? 'badge-doctor-consult' : (p.type === 'Coordinator' ? 'badge-in-progress' : 'badge-nurse-visit')}">${p.type}</span>
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

function getServiceTypeBadge(type) {
  const t = String(type || '').trim();
  switch (t) {
    case 'NurseVisit':
      return '<span class="badge badge-nurse-visit">👩‍⚕️ Nurse Visit</span>';
    case 'DoctorConsult':
      return '<span class="badge badge-doctor-consult">🩺 Doctor Consult</span>';
    case 'HospitalCoordination':
      return '<span class="badge badge-nurse-visit" style="background:#e0f2fe; color:#0369a1;">📞 Hospital Coord</span>';
    case 'HospitalEscort':
      return '<span class="badge badge-doctor-consult" style="background:#f3e8ff; color:#7e22ce;">🏥 Hospital Escort</span>';
    case 'CompanionService':
      return '<span class="badge badge-scheduled" style="background:#fef3c7; color:#92400e;">🚗 Companion Errand</span>';
    default:
      return `<span class="badge badge-nurse-visit">${t}</span>`;
  }
}

function renderWorkOrders(orders) {
  const tbody = document.querySelector('#admin-wo-table tbody');
  if (!tbody) return;

  let filtered = [...orders];
  if (activeSlicer === 'SCHEDULED') {
    filtered = filtered.filter(w => String(w.status).toUpperCase() === 'SCHEDULED' || String(w.status).toUpperCase() === 'UNSCHEDULED');
  } else if (activeSlicer === 'IN_PROGRESS') {
    filtered = filtered.filter(w => String(w.status).toUpperCase() === 'IN_PROGRESS');
  } else if (activeSlicer === 'COMPLETE') {
    filtered = filtered.filter(w => String(w.status).toUpperCase() === 'COMPLETE' || String(w.status).toUpperCase() === 'CLOSE');
  } else if (activeSlicer === 'CANCELLED') {
    filtered = filtered.filter(w => String(w.status).toUpperCase() === 'CANCELLED');
  }

  filtered.reverse();
  const total = filtered.length;
  const page = pageState.wo;
  const slice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:18px; color:#94a3b8;">No work orders found in this view.</td></tr>';
    renderPaginationBar('wo-pagination', total, page, () => {});
    return;
  }

  tbody.innerHTML = slice.map(wo => {
    const stUpper = String(wo.status || '').toUpperCase();
    const isClosed = (stUpper === 'COMPLETE' || stUpper === 'CLOSE');
    const badgeColor = isClosed ? 'badge-complete' : (stUpper === 'IN_PROGRESS' ? 'badge-in-progress' : (stUpper === 'CANCELLED' ? 'badge-cancelled' : 'badge-scheduled'));
    const displayTime = wo.scheduled_at 
      ? new Date(wo.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) 
      : (wo.created_at ? new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-');

    const assignedDisplay = wo.assigned_doctor_id 
      ? getStaffName(wo.assigned_doctor_id) 
      : (wo.assigned_staff_id ? getStaffName(wo.assigned_staff_id) : '<span style="color:#a0aec0;">Unassigned</span>');

    return `
      <tr>
        <td><strong>${wo.work_order_id}</strong></td>
        <td>${getSeniorName(wo.senior_id)}</td>
        <td>${getServiceTypeBadge(wo.type)}</td>
        <td>${assignedDisplay}</td>
        <td>${displayTime}</td>
        <td><span class="badge ${badgeColor}">${wo.status}</span></td>
        <td>
          ${!isClosed && stUpper !== 'CANCELLED'
            ? `<button class="override-btn danger" data-id="${wo.work_order_id}">Cancel</button>`
            : `<span style="color:#a0aec0;font-size:12px;">Locked</span>`}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.override-btn').forEach(btn => {
    btn.onclick = async () => {
      const reason = prompt('Cancellation reason:');
      if (!reason) return;
      try {
        await callApi('adminOverrideWorkOrder', { workOrderId: btn.getAttribute('data-id'), newStatus: 'CANCELLED', reason });
        await loadAdminDashboard();
      } catch (err) {
        alert('Override failed: ' + err.message);
      }
    };
  });

  renderPaginationBar('wo-pagination', total, page, (p) => {
    pageState.wo = p;
    renderWorkOrders(orders);
  });
}

function renderSeniors(seniors) {
  const tbody = document.querySelector('#admin-seniors-table tbody');
  if (!tbody) return;

  const total = seniors.length;
  const page = pageState.seniors;
  const slice = seniors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No seniors registered.</td></tr>';
    renderPaginationBar('seniors-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(s => `
    <tr>
      <td><strong>${s.senior_id}</strong></td>
      <td>${s.full_name}</td>
      <td>${s.phone || '-'}</td>
      <td>${s.email || '-'}</td>
      <td>${s.address || '-'}</td>
      <td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td>
    </tr>
  `).join('');

  renderPaginationBar('seniors-pagination', total, page, (p) => {
    pageState.seniors = p;
    renderSeniors(seniors);
  });
}

function renderFamilies(families, links) {
  const tbody = document.querySelector('#admin-families-table tbody');
  if (!tbody) return;

  const total = families.length;
  const page = pageState.families;
  const slice = families.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No families recorded.</td></tr>';
    renderPaginationBar('families-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(f => {
    const link = (links || []).find(l => l.family_id === f.family_id);
    return `
      <tr>
        <td><strong>${f.family_id}</strong></td>
        <td>${f.full_name}</td>
        <td>${f.relationship || '-'}</td>
        <td>${link ? getSeniorName(link.senior_id) : 'Unlinked'}</td>
        <td>${f.email || '-'}</td>
        <td>${f.phone || '-'}</td>
      </tr>
    `;
  }).join('');

  renderPaginationBar('families-pagination', total, page, (p) => {
    pageState.families = p;
    renderFamilies(families, links);
  });
}

function renderStaff(staff) {
  const tbody = document.querySelector('#admin-staff-table tbody');
  if (!tbody) return;

  const total = staff.length;
  const page = pageState.staff;
  const slice = staff.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No staff recorded.</td></tr>';
    renderPaginationBar('staff-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(st => `
    <tr>
      <td><strong>${st.staff_id}</strong></td>
      <td>${st.full_name}</td>
      <td>${st.role || 'Staff'}</td>
      <td>${st.email}</td>
      <td>${st.phone || '-'}</td>
      <td><span class="badge badge-complete">${st.status || 'ACTIVE'}</span></td>
    </tr>
  `).join('');

  renderPaginationBar('staff-pagination', total, page, (p) => {
    pageState.staff = p;
    renderStaff(staff);
  });
}

function renderDoctors(doctors) {
  const tbody = document.querySelector('#admin-doctors-table tbody');
  if (!tbody) return;

  const total = doctors.length;
  const page = pageState.doctors;
  const slice = doctors.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No doctors recorded.</td></tr>';
    renderPaginationBar('doctors-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(d => `
    <tr>
      <td><strong>${d.doctor_id}</strong></td>
      <td>${d.full_name}</td>
      <td>${d.specialty || 'General'}</td>
      <td>${d.email}</td>
      <td>${d.phone || '-'}</td>
      <td><span class="badge badge-complete">${d.status || 'ACTIVE'}</span></td>
    </tr>
  `).join('');

  renderPaginationBar('doctors-pagination', total, page, (p) => {
    pageState.doctors = p;
    renderDoctors(doctors);
  });
}

function renderCoordinators(coordinators) {
  const tbody = document.querySelector('#admin-coordinators-table tbody');
  if (!tbody) return;

  const total = coordinators.length;
  const page = pageState.coordinators;
  const slice = coordinators.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No coordinators recorded.</td></tr>';
    renderPaginationBar('coordinators-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(c => `
    <tr>
      <td><strong>${c.coordinator_id}</strong></td>
      <td>${c.full_name}</td>
      <td>${c.phone || '-'}</td>
      <td>${c.email}</td>
      <td>${c.role || 'Care Coordinator'}</td>
      <td>
        <span class="badge ${String(c.status).toUpperCase() === 'ACTIVE' ? 'badge-complete' : 'badge-cancelled'}">${c.status || 'ACTIVE'}</span>
        <button class="sort-btn toggle-crd-status" data-id="${c.coordinator_id}" data-current="${c.status}" style="margin-left:6px;">
          ${String(c.status).toUpperCase() === 'ACTIVE' ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.toggle-crd-status').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      const current = btn.getAttribute('data-current');
      try {
        await callApi('adminUpdateCoordinatorStatus', { coordinatorId: id, status: current === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
        await loadAdminDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });

  renderPaginationBar('coordinators-pagination', total, page, (p) => {
    pageState.coordinators = p;
    renderCoordinators(coordinators);
  });
}

function renderHospitalServices(services) {
  const tbody = document.querySelector('#admin-hospital-services-table tbody');
  if (!tbody) return;

  const total = services.length;
  const page = pageState.hospital;
  const sorted = [...services].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px; color:#94a3b8;">No hospital bookings yet.</td></tr>';
    renderPaginationBar('hospital-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(s => `
    <tr>
      <td><strong>${s.service_id}</strong></td>
      <td>${getSeniorName(s.senior_id)}</td>
      <td><span class="badge ${s.service_type === 'HOSPITAL_ESCORT' ? 'badge-doctor-consult' : 'badge-nurse-visit'}">${s.service_type === 'HOSPITAL_ESCORT' ? '🏥 Escort' : '📞 Coordination'}</span></td>
      <td>${s.preferred_hospital || '-'}</td>
      <td><span class="badge ${s.status === 'COMPLETED' ? 'badge-complete' : 'badge-scheduled'}">${s.status}</span></td>
      <td>${s.assigned_staff_id ? getStaffName(s.assigned_staff_id) : (s.assigned_coordinator_id ? 'Coord: ' + s.assigned_coordinator_id : '-')}</td>
    </tr>
  `).join('');

  renderPaginationBar('hospital-pagination', total, page, (p) => {
    pageState.hospital = p;
    renderHospitalServices(services);
  });
}
