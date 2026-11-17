import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allData = { seniors: [], workOrders: [], staff: [], doctors: [], coordinators: [], families: [], familyLinks: [], subscriptions: [], entitlements: [], reports: [], reviews: [], logs: [], hospitalServices: [], companionServices: [] };
let practitionerList = [];
let activeSlicer = 'ALL';

// 5 ENTRIES PER SCREEN FOR ALL TABLES
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

  setupSearchableStaffDropdown();
  await loadAdminDashboard();
}

// -------------------------------------------------------------
// NAVIGATION TABS & STATUS SLICERS
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

// -------------------------------------------------------------
// WORK ORDER DYNAMIC FORM TOGGLES
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

// -------------------------------------------------------------
// EMPLOYEE DIRECTORY SUB-TABS & CREATION FORM
// -------------------------------------------------------------
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

  // Dynamic field label switch based on employee category
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
      detailInput.placeholder = 'e.g. Cardiology, Geriatrics, General Physician';
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
      const res = await callApi('adminCreateEmployee', {
        category,
        fullName,
        phone,
        email,
        detail
      });

      resultDiv.className = 'message success';
      resultDiv.innerHTML = `✅ <strong>Employee Created!</strong> Generated ID: <code>${res.id}</code> (Saved to tab: <strong>${res.targetTab}</strong>)`;
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
// UNIVERSAL PAGINATION COMPONENT (5 ENTRIES PER SCREEN)
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// DATA LOADING & RENDERING
// -------------------------------------------------------------
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

    // Counts for employee directory sub-tabs
    const countStaff = document.getElementById('count-staff');
    if (countStaff) countStaff.textContent = (allData.staff || []).length;
    const countDocs = document.getElementById('count-doctors');
    if (countDocs) countDocs.textContent = (allData.doctors || []).length;
    const countCrds = document.getElementById('count-coordinators');
    if (countCrds) countCrds.textContent = (allData.coordinators || []).length;

    populateSeniorDropdowns(allData.seniors || []);

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

    setupTableSearches();
  } catch (err) {
    console.error('Dashboard load error:', err);
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

// -------------------------------------------------------------
// PAGINATED TABLE RENDERERS (5 ENTRIES PER PAGE)
// -------------------------------------------------------------
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
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

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

  renderPaginationBar('wo-pagination', total, page, (newPage) => {
    pageState.wo = newPage;
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

// Separate unmerged tables for Employee Directory
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

function renderCompanionServices(services) {
  const tbody = document.querySelector('#admin-companion-services-table tbody');
  if (!tbody) return;

  const total = services.length;
  const page = pageState.companion;
  const sorted = [...services].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const slice = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px; color:#94a3b8;">No companion bookings yet.</td></tr>';
    renderPaginationBar('companion-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(s => `
    <tr>
      <td><strong>${s.service_id}</strong></td>
      <td>${getSeniorName(s.senior_id)}</td>
      <td><span class="badge badge-doctor-consult">${s.companion_type}</span></td>
      <td>${s.destination || '-'}</td>
      <td><span class="badge ${s.status === 'COMPLETED' ? 'badge-complete' : 'badge-scheduled'}">${s.status}</span></td>
      <td>${s.assigned_staff_id ? getStaffName(s.assigned_staff_id) : '-'}</td>
    </tr>
  `).join('');

  renderPaginationBar('companion-pagination', total, page, (p) => {
    pageState.companion = p;
    renderCompanionServices(services);
  });
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

  tbody.innerHTML = slice.map(s => `
    <tr>
      <td><strong>${s.subscription_id}</strong></td>
      <td>${getSeniorName(s.senior_id)}</td>
      <td>${s.plan_name}</td>
      <td>${s.start_date ? s.start_date.slice(0, 10) : '-'}</td>
      <td><strong>${s.end_date ? s.end_date.slice(0, 10) : '-'}</strong></td>
      <td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td>
    </tr>
  `).join('');

  renderPaginationBar('subs-pagination', total, page, (p) => {
    pageState.subs = p;
    renderSubscriptions(subs);
  });
}

function renderEntitlements(ents) {
  const tbody = document.querySelector('#admin-entitlements-table tbody');
  if (!tbody) return;

  const total = ents.length;
  const page = pageState.ent;
  const slice = ents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No entitlement records found.</td></tr>';
    renderPaginationBar('ent-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(e => `
    <tr>
      <td><strong>${getSeniorName(e.senior_id)}</strong></td>
      <td>${e.month}</td>
      <td>${e.nurse_used} / ${e.nurse_allowed}</td>
      <td>${e.doctor_used} / ${e.doctor_allowed}</td>
    </tr>
  `).join('');

  renderPaginationBar('ent-pagination', total, page, (p) => {
    pageState.ent = p;
    renderEntitlements(ents);
  });
}

function renderReports(reports) {
  const tbody = document.querySelector('#admin-reports-table tbody');
  if (!tbody) return;

  const total = reports.length;
  const page = pageState.reports;
  const slice = reports.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (slice.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No diagnostic reports uploaded yet.</td></tr>';
    renderPaginationBar('reports-pagination', 0, 1, () => {});
    return;
  }

  tbody.innerHTML = slice.map(r => {
    const isCareJournal = (r.file_url === 'INTERNAL_CARE_JOURNAL');
    const docLink = isCareJournal
      ? `<span class="badge badge-doctor-consult">Care Journal</span>`
      : `<a href="${r.file_url}" target="_blank" rel="noopener">Open Doc ↗</a>`;

    return `
      <tr>
        <td><strong>${r.report_id}</strong></td>
        <td><strong>${getSeniorName(r.senior_id)}</strong></td>
        <td><span class="badge ${isCareJournal ? 'badge-complete' : 'badge-nurse-visit'}">${r.type}</span></td>
        <td>${docLink}</td>
        <td>${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '-'}</td>
        <td><button class="share-btn" data-id="${r.report_id}" data-senior="${r.senior_id}">Share 72h</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.share-btn').forEach(btn => {
    btn.onclick = async () => {
      const reportId = btn.getAttribute('data-id');
      try {
        const res = await callApi('createReportLink', { reportId, expiryHours: 72 });
        const shareUrl = `${window.location.origin}${window.location.pathname.replace('admin.html', '')}report.html?token=${res.token}`;
        prompt('72-Hour Link Created. Copy below:', shareUrl);
      } catch (err) {
        alert('Share error: ' + err.message);
      }
    };
  });

  renderPaginationBar('reports-pagination', total, page, (p) => {
    pageState.reports = p;
    renderReports(reports);
  });
}

function renderReviews(revs) {
  const tbody = document.querySelector('#admin-reviews-table tbody');
  if (!tbody) return;

  const total
