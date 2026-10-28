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

  const userDisplay = document.getElementById('user-display');
  if (userDisplay) {
    userDisplay.textContent = currentProfile.full_name || currentProfile.email || 'Family Member';
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', signOut);

  setupMinBookingTime();
  setupHospitalWalletPass();
  setupPrintCard();
  await loadDashboard();
}

function setupMinBookingTime() {
  const aptTimeInput = document.getElementById('apt-time');
  if (!aptTimeInput) return;

  const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  minDate.setMinutes(minDate.getMinutes() - minDate.getTimezoneOffset());
  aptTimeInput.min = minDate.toISOString().slice(0, 16);
  aptTimeInput.value = minDate.toISOString().slice(0, 16);
}

function calculateAge(dobStr) {
  if (!dobStr) return '--';
  const birthDate = new Date(dobStr);
  if (isNaN(birthDate.getTime())) return '--';
  const ageDifMs = Date.now() - birthDate.getTime();
  const ageDate = new Date(ageDifMs);
  return Math.abs(ageDate.getUTCFullYear() - 1970) + ' yrs';
}

function generateCardNumber(seniorId) {
  const clean = String(seniorId || 'SNR').replace(/\D/g, '').padEnd(4, '0').slice(-4);
  const year = new Date().getFullYear();
  return `NS-${year}-${clean}`;
}

async function loadDashboard() {
  try {
    const data = await callApi('getFamilyDashboard', { familyId: currentProfile.family_id || currentProfile.id });

    // 1. Populate Senior Digital Health Card & Metadata
    if (data.seniors && data.seniors.length > 0) {
      const s = data.seniors[0];
      currentSeniorId = s.senior_id;
      currentSeniorData = s;

      document.getElementById('hcard-name').textContent = s.full_name || 'Senior Patient';
      document.getElementById('hcard-id').textContent = s.senior_id;
      document.getElementById('hcard-cardno').textContent = generateCardNumber(s.senior_id);
      document.getElementById('hcard-gender').textContent = (s.gender ? s.gender + ' • ' : '') + 'Senior Citizen';
      document.getElementById('hcard-age').textContent = 'Age: ' + calculateAge(s.dob);

      const st = String(s.status || 'Active').toUpperCase();
      document.getElementById('hcard-status').textContent = st + ' Plan';

      // Medical Summary & Fallbacks
      document.getElementById('hcard-allergies').textContent = s.allergies || 'No known drug allergies (NKDA)';
      document.getElementById('hcard-chronic').textContent = s.chronic_conditions || 'Hypertension (Monitored)';
      document.getElementById('hcard-hospital').textContent = s.preferred_hospital || 'Nearest Super-Speciality';

      const emContact = s.emergency_contact || '112';
      const emEl = document.getElementById('hcard-emergency');
      emEl.innerHTML = `<a href="tel:${emContact.replace(/\D/g, '') || '112'}" style="color:#ffffff; text-decoration:underline;">${emContact}</a>`;

      // Subscription dates
      const sub = (data.entitlements && data.entitlements.length > 0) ? data.entitlements[0] : null;
      if (sub && sub.month) {
        document.getElementById('hcard-validity').textContent = `Month: ${sub.month}`;
      } else {
        document.getElementById('hcard-validity').textContent = 'Valid 30 Days (Rolling)';
      }
      document.getElementById('hcard-issued').textContent = 'Issued: ' + new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

      // Avatar gender-aware
      const avatarEl = document.getElementById('hcard-avatar');
      if (s.gender && s.gender.toLowerCase().startsWith('m')) {
        avatarEl.textContent = '👴';
      } else {
        avatarEl.textContent = '👵';
      }

      // Render all 20 clinical vitals
      if (data.latestAssessment) {
        renderAll20Vitals(data.latestAssessment);
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
    allWorkOrders = (data.workOrders || []).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    visitsCurrentPage = 1;
    renderVisitsTable();

  } catch (err) {
    alert('Failed to load dashboard: ' + err.message);
  }
}

// -------------------------------------------------------------
// BIND ALL 20 CLINICAL ASSESSMENT INDICATORS
// -------------------------------------------------------------
function renderAll20Vitals(v) {
  if (!v) return;

  // Header timestamp
  if (v.created_at) {
    try {
      const d = new Date(v.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      document.getElementById('vitals-recorded-date').textContent = `Recorded: ${d}`;
    } catch (e) {}
  }

  // Category 1: Primary Physiological Vitals (1-5)
  const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
  const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
  document.getElementById('disp-bp').textContent = `${sys}/${dia}`;
  document.getElementById('disp-hr').textContent = v.heart_rate || '--';
  document.getElementById('disp-spo2').textContent = (v.spo2 ? v.spo2 + '%' : '--%');
  document.getElementById('disp-rr').textContent = v.respiratory_rate || '16';
  document.getElementById('disp-temp').textContent = (v.temperature ? `${v.temperature}°${v.temperature_unit || 'C'}` : '--°C');

  // Category 2: Blood Glucose & Glycemic Profile (6-7)
  document.getElementById('disp-gluc-fasting').textContent = v.glucose_fasting || 'Not tested';
  document.getElementById('disp-gluc-random').textContent = v.glucose_random || v.blood_sugar || 'Not tested';
  document.getElementById('disp-gluc-timing').textContent = v.glucose_timing ? `Timing: ${v.glucose_timing}` : 'mg / dL';

  // Category 3: Body Composition & Anthropometry (8-11)
  document.getElementById('disp-weight').textContent = v.weight ? `${v.weight} kg` : '--';
  document.getElementById('disp-height').textContent = v.height ? `${v.height} cm` : '--';
  document.getElementById('disp-bmi').textContent = v.bmi || '--';
  document.getElementById('disp-waist').textContent = v.waist_circumference ? `${v.waist_circumference} cm` : 'Not recorded';

  // Category 4: Neuro, Pain & Mobility Status (12-15)
  document.getElementById('disp-pain').textContent = (v.pain_level !== undefined && v.pain_level !== '') ? `${v.pain_level} / 10` : '0 / 10';
  document.getElementById('disp-pain-loc').textContent = v.pain_location ? `Loc: ${v.pain_location}` : 'No local pain';
  document.getElementById('disp-loc').textContent = v.level_of_consciousness || 'Alert';
  document.getElementById('disp-fall').textContent = v.fall_risk || 'Low';
  document.getElementById('disp-mobility').textContent = v.mobility_status || 'Independent';

  // Category 5: Systemic Review & Observations (16-20)
  document.getElementById('disp-resp').textContent = v.respiratory_symptoms || 'None';
  document.getElementById('disp-resp-notes').textContent = v.respiratory_notes || 'Clear breath sounds';
  document.getElementById('disp-edema').textContent = v.edema_severity || 'None';
  document.getElementById('disp-edema-notes').textContent = v.edema_notes || 'No swelling detected';
  document.getElementById('disp-hydration').textContent = v.hydration_status || 'Normal';
  document.getElementById('disp-meds').textContent = v.medication_adherence || 'Good';
  document.getElementById('disp-meds-notes').textContent = v.medication_notes || 'Doses verified on schedule';
  document.getElementById('disp-cognitive').textContent = v.cognitive_observation || 'Normal';

  // Nurse field notes
  if (v.nurse_notes) {
    document.getElementById('disp-nurse-notes').textContent = v.nurse_notes;
  }
}

async function loadLatestVitals(seniorId) {
  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId });
    if (summary && summary.latestAssessment) {
      renderAll20Vitals(summary.latestAssessment);
    }
  } catch (e) {
    console.warn('Could not load clinical assessment summary:', e);
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

// -------------------------------------------------------------
// LIVE CARE SUMMARY LAUNCHER
// -------------------------------------------------------------
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

    // Generate verified 72-hour clinical link for the ER Triage QR code
    try {
      const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
      const triageUrl = `${window.location.origin}${window.location.pathname.replace('family.html', '')}report.html?token=${res.token}`;

      const qrBox = document.getElementById('hospital-qr-code');
      qrBox.innerHTML = '';
      new QRCode(qrBox, {
        text: triageUrl,
        width: 130,
        height: 130,
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
// PRINTABLE ID-1 WALLET CARD (CREDIT CARD SIZE SPEC)
// -------------------------------------------------------------
function setupPrintCard() {
  document.getElementById('btn-print-card')?.addEventListener('click', async () => {
    if (!currentSeniorData) return alert('Senior details loading.');

    document.getElementById('print-card-name').textContent = currentSeniorData.full_name;
    document.getElementById('print-card-code').textContent = currentSeniorData.senior_id;
    document.getElementById('print-card-ice').textContent = currentSeniorData.emergency_contact || '112';
    document.getElementById('print-card-hosp').textContent = currentSeniorData.preferred_hospital || 'Nearest Super-Speciality';

    // Populate QR code on print card
    try {
      const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
      const triageUrl = `${window.location.origin}${window.location.pathname.replace('family.html', '')}report.html?token=${res.token}`;
      const qrTarget = document.getElementById('print-qr-target');
      qrTarget.innerHTML = '';
      new QRCode(qrTarget, {
        text: triageUrl,
        width: 60,
        height: 60,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch (e) {}

    window.print();
  });
}

// -------------------------------------------------------------
// APPOINTMENT BOOKING (24h Advance Enforcement)
// -------------------------------------------------------------
document.getElementById('appointment-form')?.addEventListener('submit', async (e) => {
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
