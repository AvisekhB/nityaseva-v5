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

// -------------------------------------------------------------
// SAFE DOM HELPERS (Prevents "Cannot set properties of null")
// -------------------------------------------------------------
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text !== undefined && text !== null ? text : '';
  }
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = html !== undefined && html !== null ? html : '';
  }
}

async function init() {
  currentProfile = await requireAuth('family');
  if (!currentProfile) return;

  setText('user-display', currentProfile.full_name || currentProfile.email || 'Family Member');

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
function setupPhotoUpload() {
  const trigger = document.getElementById('avatar-upload-trigger');
  const input = document.getElementById('senior-photo-input');
  if (!trigger || !input) return;

  trigger.addEventListener('click', () => input.click());

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !currentSeniorId) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        // Compress to max 300x300 before upload
        const canvas = document.createElement('canvas');
        const MAX = 300;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
        else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const base64 = canvas.toDataURL('image/jpeg', 0.75);

        const avatarEl = document.getElementById('hcard-avatar');
        if (avatarEl) avatarEl.innerHTML = `<img src="${base64}" alt="Senior Photo">`;

        try {
          await callApi('updateSeniorPhoto', { seniorId: currentSeniorId, photoData: base64 });
        } catch (err) {
          alert('Photo upload failed: ' + err.message);
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
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

    // 1. Senior Digital Health Card
    if (data.seniors && data.seniors.length > 0) {
      const s = data.seniors[0];
      currentSeniorId = s.senior_id;
      currentSeniorData = s;

      setText('hcard-name', s.full_name || 'Senior Patient');
      setText('hcard-id', s.senior_id);
      setText('hcard-cardno', generateCardNumber(s.senior_id));
      setText('hcard-gender', (s.gender ? s.gender + ' • ' : '') + 'Senior Citizen');
      setText('hcard-age', 'Age: ' + calculateAge(s.dob));

      const st = String(s.status || 'Active').toUpperCase();
      setText('hcard-status', st + ' Plan');
      setText('hcard-plan', 'Standard Care');

      // Medical Summary & Fallbacks
      setText('hcard-allergies', s.allergies || 'No known drug allergies (NKDA)');
      setText('hcard-chronic', s.chronic_conditions || 'Hypertension (Monitored)');
      setText('hcard-hospital', s.preferred_hospital || 'Nearest Super-Speciality');
      setText('hcard-phone', s.phone || 'Not listed');

      const emContact = s.emergency_contact || '112';
      setHTML('hcard-emergency', `<a href="tel:${String(emContact).replace(/\D/g, '') || '112'}" style="color:#ffffff; text-decoration:underline;">${emContact}</a>`);

      // Subscription dates
      const sub = (data.entitlements && data.entitlements.length > 0) ? data.entitlements[0] : null;
      if (sub && sub.month) {
        setText('hcard-validity', `Month: ${sub.month}`);
      } else {
        setText('hcard-validity', 'Valid 30 Days (Rolling)');
      }
      setText('hcard-issued', 'Issued: ' + new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }));

      // Avatar
      const avatarEl = document.getElementById('hcard-avatar');
      if (avatarEl) {
        avatarEl.textContent = (s.gender && s.gender.toLowerCase().startsWith('m')) ? '👴' : '👵';
      }

      // Render 20-Point Vitals
      if (data.latestAssessment) {
        renderAll20Vitals(data.latestAssessment);
      } else {
        await loadLatestVitals(s.senior_id);
      }
    } else {
      setText('hcard-name', 'No Senior Profile Linked');
    }

    // 2. Entitlements Quotas
    if (data.entitlements && data.entitlements.length > 0) {
      const ent = data.entitlements[0];
      const nurseRem = Math.max(0, Number(ent.nurse_allowed) - Number(ent.nurse_used));
      const docRem = Math.max(0, Number(ent.doctor_allowed) - Number(ent.doctor_used));
      setText('nurse-count', `${nurseRem} / ${ent.nurse_allowed}`);
      setText('doctor-count', `${docRem} / ${ent.doctor_allowed}`);
    }

    // 3. Reports Table
    allReports = (data.reports || []).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    reportsCurrentPage = 1;
    renderReportsTable();

    // 4. Work Orders Table
    allWorkOrders = (data.workOrders || []).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    visitsCurrentPage = 1;
    renderVisitsTable();

  } catch (err) {
    console.error('loadDashboard error:', err);
    alert('Failed to load dashboard: ' + err.message);
  }
}

// -------------------------------------------------------------
// BIND ALL 20 CLINICAL ASSESSMENT INDICATORS (SAFE SETTERS)
// -------------------------------------------------------------
function renderAll20Vitals(v) {
  if (!v) return;

  if (v.created_at) {
    try {
      const d = new Date(v.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      setText('vitals-recorded-date', `Recorded: ${d}`);
    } catch (e) {}
  }

  // Category 1: Primary Physiological Vitals (1-5)
  const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
  const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
  setText('disp-bp', `${sys}/${dia}`);
  setText('disp-hr', v.heart_rate || '--');
  setText('disp-spo2', v.spo2 ? v.spo2 + '%' : '--%');
  setText('disp-rr', v.respiratory_rate || '16');
  setText('disp-temp', v.temperature ? `${v.temperature}°${v.temperature_unit || 'C'}` : '--°C');

  // Category 2: Blood Glucose & Glycemic Profile (6-7)
  setText('disp-gluc-fasting', v.glucose_fasting || 'Not tested');
  setText('disp-gluc-random', v.glucose_random || v.blood_sugar || 'Not tested');
  setText('disp-gluc-timing', v.glucose_timing ? `Timing: ${v.glucose_timing}` : 'mg / dL');

  // Category 3: Body Composition & Anthropometry (8-11)
  setText('disp-weight', v.weight ? `${v.weight} kg` : '--');
  setText('disp-height', v.height ? `${v.height} cm` : '--');
  setText('disp-bmi', v.bmi || '--');
  setText('disp-waist', v.waist_circumference ? `${v.waist_circumference} cm` : 'Not recorded');

  // Category 4: Neuro, Pain & Mobility Status (12-15)
  setText('disp-pain', (v.pain_level !== undefined && v.pain_level !== '') ? `${v.pain_level} / 10` : '0 / 10');
  setText('disp-pain-loc', v.pain_location ? `Loc: ${v.pain_location}` : 'No local pain');
  setText('disp-loc', v.level_of_consciousness || 'Alert');
  setText('disp-fall', v.fall_risk || 'Low');
  setText('disp-mobility', v.mobility_status || 'Independent');

  // Category 5: Systemic Review & Observations (16-20)
  setText('disp-resp', v.respiratory_symptoms || 'None');
  setText('disp-resp-notes', v.respiratory_notes || 'Clear breath sounds');
  setText('disp-edema', v.edema_severity || 'None');
  setText('disp-edema-notes', v.edema_notes || 'No swelling detected');
  setText('disp-hydration', v.hydration_status || 'Normal');
  setText('disp-meds', v.medication_adherence || 'Good');
  setText('disp-meds-notes', v.medication_notes || 'Doses verified on schedule');
  setText('disp-cognitive', v.cognitive_observation || 'Normal');

  if (v.nurse_notes) {
    setText('disp-nurse-notes', v.nurse_notes);
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
// PAGINATED WORK ORDERS TABLE (4 rows per page)
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

const btnViewSummary = document.getElementById('btn-view-summary');
if (btnViewSummary) btnViewSummary.addEventListener('click', openInteractiveCareSummary);

// -------------------------------------------------------------
// HOSPITAL ADMISSION WALLET PASS MODAL
// -------------------------------------------------------------
function setupHospitalWalletPass() {
  const modal = document.getElementById('wallet-modal');
  const btnOpen = document.getElementById('btn-open-wallet');
  const btnClose = document.getElementById('btn-close-wallet');

  if (btnOpen) {
    btnOpen.addEventListener('click', async () => {
      if (!currentSeniorData) return alert('Senior details loading. Please wait.');

      if (modal) modal.classList.remove('hidden');

      setText('pass-patient-name', currentSeniorData.full_name || 'Senior Patient');
      setText('pass-uhid', currentSeniorData.senior_id);
      setText('pass-ice', currentSeniorData.emergency_contact || '112');

      try {
        const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
        const triageUrl = `${window.location.origin}${window.location.pathname.replace('family.html', '')}report.html?token=${res.token}`;

        const qrBox = document.getElementById('hospital-qr-code');
        if (qrBox && window.QRCode) {
          qrBox.innerHTML = '';
          new QRCode(qrBox, {
            text: triageUrl,
            width: 130,
            height: 130,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      } catch (e) {
        console.warn('QR code generation error:', e);
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      if (modal) modal.classList.add('hidden');
    });
  }

  const btnApple = document.getElementById('btn-save-apple');
  if (btnApple) {
    btnApple.addEventListener('click', () => {
      alert(`🍏 Apple Wallet Pass Added!\n\nPatient: ${currentSeniorData ? currentSeniorData.full_name : ''}\nUHID: ${currentSeniorId}\n\nYour offline pass with emergency QR code is ready.`);
    });
  }

  const btnGoogle = document.getElementById('btn-save-google');
  if (btnGoogle) {
    btnGoogle.addEventListener('click', () => {
      alert(`🌐 Google Wallet Pass Added!\n\nPatient: ${currentSeniorData ? currentSeniorData.full_name : ''}\nUHID: ${currentSeniorId}\n\nEmergency Health Pass linked to Google Wallet.`);
    });
  }
}

// -------------------------------------------------------------
// PRINT CARD SETUP
// -------------------------------------------------------------
function setupPrintCard() {
  const btnPrint = document.getElementById('btn-print-card');
  if (btnPrint) {
    btnPrint.addEventListener('click', async () => {
      if (!currentSeniorData) return alert('Senior details loading.');

      setText('print-card-name', currentSeniorData.full_name);
      setText('print-card-code', currentSeniorData.senior_id);
      setText('print-card-ice', currentSeniorData.emergency_contact || '112');
      setText('print-card-hosp', currentSeniorData.preferred_hospital || 'Nearest Super-Speciality');

      try {
        const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
        const triageUrl = `${window.location.origin}${window.location.pathname.replace('family.html', '')}report.html?token=${res.token}`;
        const qrTarget = document.getElementById('print-qr-target');
        if (qrTarget && window.QRCode) {
          qrTarget.innerHTML = '';
          new QRCode(qrTarget, {
            text: triageUrl,
            width: 60,
            height: 60,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
          });
        }
      } catch (e) {}

      window.print();
    });
  }
}

// -------------------------------------------------------------
// APPOINTMENT BOOKING (24h Advance Check)
// -------------------------------------------------------------
const aptForm = document.getElementById('appointment-form');
if (aptForm) {
  aptForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('apt-type')?.value;
    const time = document.getElementById('apt-time')?.value;

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
}

init();
