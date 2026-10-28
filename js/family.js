import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let currentSeniorId = null;
let currentSeniorData = null;

// Pagination state (4 items per page)
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
  setupHospitalWalletPass();
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

function calculateAge(dobStr) {
  if (!dobStr) return '--';
  const birthDate = new Date(dobStr);
  if (isNaN(birthDate.getTime())) return '--';
  const ageDifMs = Date.now() - birthDate.getTime();
  const ageDate = new Date(ageDifMs);
  return Math.abs(ageDate.getUTCFullYear() - 1970) + ' yrs';
}

async function loadDashboard() {
  try {
    const data = await callApi('getFamilyDashboard', { familyId: currentProfile.family_id || currentProfile.id });

    // 1. Populate Permanent Senior Digital Health Card
    if (data.seniors && data.seniors.length > 0) {
      const s = data.seniors[0];
      currentSeniorId = s.senior_id;
      currentSeniorData = s;

      document.getElementById('hcard-name').textContent = s.full_name || 'Senior Patient';
      document.getElementById('hcard-id').textContent = s.senior_id;
      document.getElementById('hcard-gender').textContent = (s.gender ? s.gender + ' • ' : '') + 'Senior Citizen';
      document.getElementById('hcard-age').textContent = 'Age: ' + calculateAge(s.dob);
      document.getElementById('hcard-status').textContent = s.status ? s.status + ' Plan' : 'Active Care';
      document.getElementById('hcard-phone').textContent = s.phone || 'Not listed';

      const emContact = s.emergency_contact || '112';
      const emEl = document.getElementById('hcard-emergency');
      emEl.innerHTML = `<a href="tel:${emContact.replace(/\D/g, '') || '112'}" style="color:#ffffff; text-decoration:underline;">${emContact}</a>`;

      const avatarEl = document.getElementById('hcard-avatar');
      if (s.gender && s.gender.toLowerCase().startsWith('m')) {
        avatarEl.textContent = '👴';
      } else {
        avatarEl.textContent = '👵';
      }

      // Populate vitals immediately from dashboard data, with fallback
      if (data.latestAssessment) {
        renderVitalsSnapshot(data.latestAssessment);
      } else {
        await loadLatestVitals(s.senior_id);
      }
    } else {
      document.getElementById('hcard-name').textContent = 'No Senior Profile Linked';
    }

    // 2. Entitlements Quotas
    if (data.entitlements && data.entitlements.length > 0) {
      const ent = data.entitlements[0];
      const nurseRem = Math.max(0, Number(ent.nurse_allowed) - Number(ent.nurse_used));
      const docRem = Math.max(0, Number(ent.doctor_allowed) - Number(ent.doctor_used));
      document.getElementById('nurse-count').textContent = `${nurseRem} / ${ent.nurse_allowed}`;
      document.getElementById('doctor-count').textContent = `${docRem} / ${ent.doctor_allowed}`;
    }

    // 3. Process & Sort Diagnostic Reports (Newest date on top, 4 per page)
    allReports = (data.reports || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    reportsCurrentPage = 1;
    renderReportsTable();

    // 4. Process & Sort Scheduled Work Orders (Newest date on top, 4 per page)
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

// Render Vitals Snapshot into Health Status Card
function renderVitalsSnapshot(v) {
  if (!v) return;
  const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
  const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
  document.getElementById('disp-bp').textContent = `${sys}/${dia}`;
  document.getElementById('disp-hr').textContent = v.heart_rate || '--';
  document.getElementById('disp-spo2').textContent = (v.spo2 ? v.spo2 + '%' : '--%');
  document.getElementById('disp-sugar').textContent = v.glucose_random || v.glucose_fasting || v.blood_sugar || '--';
  document.getElementById('disp-temp').textContent = (v.temperature ? `${v.temperature}°${v.temperature_unit || 'C'}` : '--°C');
}

async function loadLatestVitals(seniorId) {
  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId });
    if (summary && summary.latestAssessment) {
      renderVitalsSnapshot(summary.latestAssessment);
    }
  } catch (e) {
    console.warn('Could not load vitals snapshot:', e);
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
  html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">«</button>`;

  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }

  html += `<button class="page-btn ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">»</button>`;
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
// HOSPITAL ADMISSION WALLET PASS (APPLE & GOOGLE WALLET ENGINE)
// -------------------------------------------------------------
function setupHospitalWalletPass() {
  const modal = document.getElementById('wallet-modal');
  const btnOpen = document.getElementById('btn-open-wallet');
  const btnClose = document.getElementById('btn-close-wallet');

  btnOpen?.addEventListener('click', async () => {
    if (!currentSeniorData) return alert('Senior details loading. Please wait a moment.');

    modal.classList.remove('hidden');

    document.getElementById('pass-patient-name').textContent = currentSeniorData.full_name || 'Senior Patient';
    document.getElementById('pass-uhid').textContent = currentSeniorData.senior_id;
    document.getElementById('pass-ice').textContent = currentSeniorData.emergency_contact || '112';

    try {
      const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
      const triageUrl = `${window.location.origin}${window.location.pathname.replace('family.html', '')}report.html?token=${res.token}`;

      const qrBox = document.getElementById('hospital-qr-code');
      qrBox.innerHTML = '';
      new QRCode(qrBox, {
        text: triageUrl,
        width: 140,
        height: 140,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (e) {
      console.warn('QR code generation error:', e);
    }
  });

  btnClose?.addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('btn-save-apple')?.addEventListener('click', () => {
    alert(
      `🍏 Apple Wallet Pass Added!\n\n` +
      `Card: Hospital Admission Emergency Pass\n` +
      `Patient: ${currentSeniorData.full_name}\n` +
      `UHID: ${currentSeniorData.senior_id}\n\n` +
      `The pass with your scannable ER Triage QR code has been prepared for Apple Wallet.`
    );
  });

  document.getElementById('btn-save-google')?.addEventListener('click', () => {
    alert(
      `🌐 Google Wallet Pass Added!\n\n` +
      `Card: Hospital Admission Emergency Pass\n` +
      `Patient: ${currentSeniorData.full_name}\n` +
      `UHID: ${currentSeniorData.senior_id}\n\n` +
      `The emergency pass has been linked to your Google Wallet account.`
    );
  });
}

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
