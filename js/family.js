import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let currentSeniorId = null;

// Pagination state (4 lines per page)
const PAGE_SIZE = 4;
let allReports = [];
let reportsCurrentPage = 1;

let allWorkOrders = [];
let visitsCurrentPage = 1;

async function init() {
  currentProfile = await requireAuth('family');
  if (!currentProfile) return;

  document.getElementById('user-display').textContent = currentProfile.full_name || currentProfile.email || 'Family Member';
  document.getElementById('btn-logout').addEventListener('click', signOut);

  setupMinBookingTime();
  await loadDashboard();
}

function setupMinBookingTime() {
  const aptTimeInput = document.getElementById('apt-time');
  if (!aptTimeInput) return;

  const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  minDate.setMinutes(minDate.getMinutes() - minDate.getTimezoneOffset());
  const isoMin = minDate.toISOString().slice(0, 16);

  aptTimeInput.min = isoMin;
  aptTimeInput.value = isoMin;
}

async function loadDashboard() {
  try {
    const data = await callApi('getFamilyDashboard', { familyId: currentProfile.family_id || currentProfile.id });

    // 1. Senior Demographic Details
    const seniorInfo = document.getElementById('senior-info');
    if (data.seniors && data.seniors.length > 0) {
      const s = data.seniors[0];
      currentSeniorId = s.senior_id;
      seniorInfo.innerHTML = `
        <strong>${s.full_name}</strong> (ID: <code>${s.senior_id}</code>)<br>
        <strong>DOB:</strong> ${s.dob || 'N/A'} | <strong>Phone:</strong> ${s.phone || 'N/A'}<br>
        <strong>Residential Address:</strong> ${s.address || 'N/A'}<br>
        <strong>Emergency Contact:</strong> ${s.emergency_contact || '112 (National Emergency)'}
      `;

      await loadLatestVitals(s.senior_id);
    } else {
      seniorInfo.innerHTML = '<em>No senior profile linked to this family account yet. Please contact support.</em>';
    }

    // 2. Entitlements Quotas
    if (data.entitlements && data.entitlements.length > 0) {
      const ent = data.entitlements[0];
      const nurseRem = Math.max(0, Number(ent.nurse_allowed) - Number(ent.nurse_used));
      const docRem = Math.max(0, Number(ent.doctor_allowed) - Number(ent.doctor_used));
      document.getElementById('nurse-count').textContent = `${nurseRem} / ${ent.nurse_allowed}`;
      document.getElementById('doctor-count').textContent = `${docRem} / ${ent.doctor_allowed}`;
    }

    // 3. Process & Sort Diagnostic Reports (Latest date on top)
    allReports = (data.reports || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    reportsCurrentPage = 1;
    renderReportsTable();

    // 4. Process & Sort Scheduled Work Orders (Latest date on top)
    allWorkOrders = (data.workOrders || []).sort((a, b) => {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      return timeB - timeA;
    });
    visitsCurrentPage = 1;
    renderVisitsTable();

  } catch (err) {
    alert('Failed to load dashboard: ' + err.message);
  }
}

// -------------------------------------------------------------
// PAGINATED REPORTS TABLE (4 rows per page)
// -------------------------------------------------------------
function renderReportsTable() {
  const tbody = document.querySelector('#family-reports-table tbody');
  const paginationContainer = document.getElementById('reports-pagination');
  if (!tbody) return;

  if (allReports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No diagnostic reports uploaded yet.</td></tr>';
    if (paginationContainer) paginationContainer.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(allReports.length / PAGE_SIZE);
  if (reportsCurrentPage > totalPages) reportsCurrentPage = totalPages;

  const startIdx = (reportsCurrentPage - 1) * PAGE_SIZE;
  const pageItems = allReports.slice(startIdx, startIdx + PAGE_SIZE);

  tbody.innerHTML = pageItems.map(r => {
    const isCareJournal = (r.file_url === 'INTERNAL_CARE_JOURNAL');
    const docLink = isCareJournal
      ? `<button class="view-care-btn secondary" data-id="${r.report_id}" style="padding:4px 8px; font-size:11px;">Open Care Summary</button>`
      : `<a href="${r.file_url}" target="_blank" rel="noopener">Download File ↗</a>`;

    const d = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '-';

    return `
      <tr>
        <td><strong>${r.report_id}</strong></td>
        <td>${r.type}</td>
        <td>${d}</td>
        <td>${docLink}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.view-care-btn').forEach(btn => {
    btn.onclick = () => openInteractiveCareSummary();
  });

  renderPaginationControls(paginationContainer, totalPages, reportsCurrentPage, (newPage) => {
    reportsCurrentPage = newPage;
    renderReportsTable();
  });
}

// -------------------------------------------------------------
// PAGINATED WORK ORDERS TABLE (4 rows per page, newest first)
// -------------------------------------------------------------
function renderVisitsTable() {
  const tbody = document.querySelector('#work-orders-table tbody');
  const paginationContainer = document.getElementById('visits-pagination');
  if (!tbody) return;

  if (allWorkOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">No scheduled visits.</td></tr>';
    if (paginationContainer) paginationContainer.innerHTML = '';
    return;
  }

  const totalPages = Math.ceil(allWorkOrders.length / PAGE_SIZE);
  if (visitsCurrentPage > totalPages) visitsCurrentPage = totalPages;

  const startIdx = (visitsCurrentPage - 1) * PAGE_SIZE;
  const pageItems = allWorkOrders.slice(startIdx, startIdx + PAGE_SIZE);

  tbody.innerHTML = pageItems.map(wo => {
    const st = String(wo.status).toUpperCase();
    const badgeColor = (st === 'COMPLETE' || st === 'COMPLETED')
      ? 'badge-green'
      : (st === 'IN_PROGRESS' ? 'badge-yellow' : (st === 'CANCELLED' ? 'badge-red' : 'badge-blue'));

    const displayTime = wo.created_at
      ? new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
      : '-';

    return `
      <tr>
        <td><strong>${wo.work_order_id}</strong></td>
        <td>${wo.type === 'DoctorConsult' ? '🩺 Doctor Teleconsult' : '👩‍⚕️ Nurse Home Visit'}</td>
        <td><span class="badge ${badgeColor}">${wo.status}</span></td>
        <td>${displayTime}</td>
      </tr>
    `;
  }).join('');

  renderPaginationControls(paginationContainer, totalPages, visitsCurrentPage, (newPage) => {
    visitsCurrentPage = newPage;
    renderVisitsTable();
  });
}

// Universal Numbered Pagination Component (1 2 3 ...)
function renderPaginationControls(container, totalPages, currentPage, onPageChange) {
  if (!container) return;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // Previous button
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">«</button>`;

  // Page Numbers: 1 2 3 ...
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  // Next button
  html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">»</button>`;

  container.innerHTML = html;

  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.onclick = () => {
      const targetPage = Number(btn.getAttribute('data-page'));
      if (targetPage && targetPage !== currentPage && targetPage >= 1 && targetPage <= totalPages) {
        onPageChange(targetPage);
      }
    };
  });
}

// -------------------------------------------------------------
// VITALS SNAPSHOT & CARE SUMMARY DISPATCH
// -------------------------------------------------------------
async function loadLatestVitals(seniorId) {
  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId });
    const v = summary.latestAssessment;
    if (v) {
      document.getElementById('vitals-summary-container').classList.remove('hidden');
      const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
      const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
      document.getElementById('disp-bp').textContent = `${sys}/${dia}`;
      document.getElementById('disp-hr').textContent = v.heart_rate || '--';
      document.getElementById('disp-spo2').textContent = (v.spo2 ? v.spo2 + '%' : '--%');
      document.getElementById('disp-sugar').textContent = v.glucose_random || v.glucose_fasting || v.blood_sugar || '--';
      document.getElementById('disp-temp').textContent = (v.temperature ? `${v.temperature}°${v.temperature_unit || 'C'}` : '--°C');
    }
  } catch (e) {
    console.warn('Could not load vitals snapshot:', e);
  }
}

async function openInteractiveCareSummary() {
  if (!currentSeniorId) return alert('No senior linked to this account.');
  try {
    const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
    const reportUrl = `report.html?token=${res.token}`;
    window.open(reportUrl, '_blank');
  } catch (err) {
    alert('Error loading Care Summary: ' + err.message);
  }
}

document.getElementById('btn-view-summary')?.addEventListener('click', openInteractiveCareSummary);

// -------------------------------------------------------------
// APPOINTMENT BOOKING (24h Advance Enforcement)
// -------------------------------------------------------------
document.getElementById('appointment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('apt-type').value;
  const time = document.getElementById('apt-time').value;

  const chosenDate = new Date(time).getTime();
  const minRequired = Date.now() + (23.5 * 60 * 60 * 1000);

  if (chosenDate < minRequired) {
    return alert('Please select a date and time at least 24 hours in advance.');
  }

  try {
    await callApi('createAppointment', {
      seniorId: currentSeniorId || (currentProfile.senior_id || ''),
      type: type,
      scheduledAt: new Date(time).toISOString()
    });
    alert('Appointment requested successfully! Our team will assign staff within 24 hours.');
    await loadDashboard();
  } catch (err) {
    alert('Error booking appointment: ' + err.message);
  }
});

init();
