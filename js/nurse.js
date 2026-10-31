import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let currentStaffProfile = null;
let allWorkOrders = [];
let activeWO = null;
let timerInterval = null;
let visitStartTime = null;
let isVitalsSavedForActiveWO = false;

// -------------------------------------------------------------
// SAFE DOM HELPERS
// -------------------------------------------------------------
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

async function init() {
  try {
    currentProfile = await requireAuth('nurse');
    if (!currentProfile) return;

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', signOut);

    setupNurseAvatarUpload();
    setupSosHandlers();
    setupModalCloseButtons();
    setupAssessmentBmi();
    setupStartVisitFlow();
    setupCockpitActions();
    setupAssessmentForm();
    setupDoctorOptions();
    setupEndVisitFlow();

    await loadNurseWorkOrders();
  } catch (err) {
    console.error('Nurse Portal Init Error:', err);
    setHTML('route-list-container', `<p style="color:#dc2626; text-align:center; padding:20px 0;">Failed to load: ${err.message}</p>`);
  }
}

// -------------------------------------------------------------
// GPS & PHOTO UPLOAD
// -------------------------------------------------------------
async function getDeviceLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6), accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 6000 }
    );
  });
}

function setupNurseAvatarUpload() {
  const trigger = document.getElementById('btn-nurse-avatar');
  const input = document.getElementById('nurse-photo-input');
  if (!trigger || !input) return;
  trigger.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      renderNurseAvatar(ev.target.result);
      try {
        await callApi('updateNursePhoto', { staffId: currentStaffProfile.staff_id, photoData: ev.target.result });
      } catch (err) { console.warn('Photo sync failed:', err.message); }
    };
    reader.readAsDataURL(file);
  });
}

function renderNurseAvatar(base64) {
  setHTML('btn-nurse-avatar', `<img src="${base64}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`);
}

// -------------------------------------------------------------
// LOAD DASHBOARD
// -------------------------------------------------------------
async function loadNurseWorkOrders() {
  try {
    const staffId = currentProfile ? (currentProfile.staff_id || currentProfile.userId || '') : '';
    const data = await callApi('getNurseDashboard', { staffId: staffId });

    // 1. Populate Nurse Profile Card
    currentStaffProfile = data.staffProfile || {};
    setText('nurse-name-display', currentStaffProfile.full_name || 'Nurse');
    setText('nurse-id-display', currentStaffProfile.staff_id || 'STF-XXXX');
    setText('nurse-name-profile', currentStaffProfile.full_name || 'Nurse');
    setText('nurse-role-profile', `Role: ${currentStaffProfile.role || 'Nurse'}`);
    setText('n-age', currentStaffProfile.age || '--');
    setText('n-exp', currentStaffProfile.experience || '--');
    setText('n-part', currentStaffProfile.partner_science || '--');
    setText('n-phone', currentStaffProfile.phone || '--');

    if (currentStaffProfile.photo_url) renderNurseAvatar(currentStaffProfile.photo_url);

    // 2. Render Route
    allWorkOrders = (data.workOrders || []).filter(w => String(w.status).toUpperCase() !== 'CLOSE');
    renderRouteList();
  } catch (err) {
    setHTML('route-list-container', `<p style="color:#dc2626; text-align:center;">Error: ${err.message}</p>`);
  }
}

function renderRouteList() {
  const container = document.getElementById('route-list-container');
  if (!container) return;
  setText('route-count-badge', `${allWorkOrders.length} Visits`);

  if (allWorkOrders.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No visits assigned.</p>';
    return;
  }

  container.innerHTML = allWorkOrders.map(wo => {
    const st = String(wo.status || '').toUpperCase();
    const badgeClass = st === 'IN_PROGRESS' ? 'badge-in_progress' : (st === 'COMPLETE' ? 'badge-complete' : 'badge-scheduled');
    
    return `
      <div class="visit-card-item" data-id="${wo.work_order_id}">
        <div class="visit-card-top">
          <span class="visit-senior-name">${wo.senior_name || wo.senior_id}</span>
          <span class="status-badge ${badgeClass}">${wo.status}</span>
        </div>
        <div class="visit-meta-row">📍 ${wo.senior_address || 'No Address'}</div>
        <div class="visit-meta-row">📞 <a href="tel:${wo.senior_phone}">${wo.senior_phone}</a> | 🚨 ICE: ${wo.senior_emergency}</div>
        <div class="visit-meta-row" style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <span>🆔 ${wo.work_order_id}</span>
          <button class="btn-view-care-summary" data-senior="${wo.senior_id}" style="background:#2d6a4f; color:#ffffff; border:none; padding:5px 12px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">
            👁️ View Care Report
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Click on visit card opens visit workflow
  container.querySelectorAll('.visit-card-item').forEach(card => {
    card.onclick = (e) => {
      // Prevent opening workflow if user clicked the View button
      if (e.target.closest('.btn-view-care-summary')) return;
      const match = allWorkOrders.find(w => w.work_order_id === card.getAttribute('data-id'));
      if (match) openVisitFlow(match);
    };
  });

  // Dedicated "View Care Report" action
  container.querySelectorAll('.btn-view-care-summary').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const seniorId = btn.getAttribute('data-senior');
      const origText = btn.textContent;
      btn.textContent = '⏳ Loading...';
      btn.disabled = true;

      try {
        const res = await callApi('generateClinicalCareReport', { seniorId: seniorId });
        window.open(`report.html?token=${res.token}`, '_blank');
      } catch (err) {
        alert('Could not open clinical care report: ' + err.message);
      } finally {
        btn.textContent = origText;
        btn.disabled = false;
      }
    };
  });
}

// -------------------------------------------------------------
// WORKFLOWS: OTP, COCKPIT, ASSESSMENT, SOS
// -------------------------------------------------------------
function openVisitFlow(wo) {
  activeWO = wo;
  const st = String(wo.status || '').toUpperCase();
  if (st === 'COMPLETE') return alert(`✅ Visit for ${wo.senior_name || wo.senior_id} has already been completed. Use "View Care Report" to review data.`);
  st === 'IN_PROGRESS' ? openCockpit(wo) : openStartVisitSheet(wo);
}

function openStartVisitSheet(wo) {
  setText('start-sheet-senior-name', wo.senior_name || wo.senior_id);
  show('start-visit-overlay');
}

function openCockpit(wo) {
  isVitalsSavedForActiveWO = false;
  activeWO = wo;
  setText('cockpit-senior-name', wo.senior_name || wo.senior_id);
  visitStartTime = wo.start_verified_at ? new Date(wo.start_verified_at) : new Date();
  startLiveTimer();
  show('cockpit-overlay');
}

function startLiveTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - visitStartTime.getTime()) / 1000);
    setText('live-timer-display', new Date(diff * 1000).toISOString().substr(11, 8));
  }, 1000);
}

function setupCockpitActions() {
  document.getElementById('btn-open-assessment')?.addEventListener('click', () => show('assessment-overlay'));
  document.getElementById('btn-doctor-options')?.addEventListener('click', () => show('doctor-overlay'));
  document.getElementById('btn-open-end-code')?.addEventListener('click', () => {
    if (!isVitalsSavedForActiveWO) {
      alert('⚠️ Mandatory: Submit 20-Point Vitals Assessment first.');
      show('assessment-overlay');
      return;
    }
    show('end-visit-overlay');
  });
}

function setupAssessmentForm() {
  document.getElementById('assessment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving Vitals & GPS...';
    }

    try {
      const geo = await getDeviceLocation();
      const bpSys = document.getElementById('asm-bp-sys')?.value || '';
      const bpDia = document.getElementById('asm-bp-dia')?.value || '';

      const payload = {
        senior_id: activeWO.senior_id,
        visit_id: activeWO.work_order_id,
        bp: `${bpSys}/${bpDia}`,
        bp_systolic: Number(bpSys),
        bp_diastolic: Number(bpDia),
        heart_rate: Number(document.getElementById('asm-hr')?.value || 0),
        spo2: Number(document.getElementById('asm-spo2')?.value || 0),
        respiratory_rate: Number(document.getElementById('asm-rr')?.value || 16),
        temperature: Number(document.getElementById('asm-temp')?.value || 0),
        temperature_unit: document.getElementById('asm-temp-unit')?.value || 'C',
        glucose_fasting: document.getElementById('asm-glucose-fasting')?.value ? Number(document.getElementById('asm-glucose-fasting').value) : '',
        glucose_random: document.getElementById('asm-glucose-random')?.value ? Number(document.getElementById('asm-glucose-random').value) : '',
        glucose_timing: (document.getElementById('asm-glucose-timing')?.value || '').trim(),
        weight: document.getElementById('asm-weight')?.value ? Number(document.getElementById('asm-weight').value) : '',
        height: document.getElementById('asm-height')?.value ? Number(document.getElementById('asm-height').value) : '',
        bmi: document.getElementById('asm-bmi')?.value || '',
        waist_circumference: document.getElementById('asm-waist')?.value ? Number(document.getElementById('asm-waist').value) : '',
        pain_level: Number(document.getElementById('asm-pain')?.value || 0),
        pain_location: (document.getElementById('asm-pain-location')?.value || '').trim(),
        level_of_consciousness: document.getElementById('asm-loc')?.value || 'Alert',
        fall_risk: document.getElementById('asm-fall')?.value || 'Low',
        mobility_status: document.getElementById('asm-mobility')?.value || 'Independent',
        respiratory_symptoms: document.getElementById('asm-resp-symptoms')?.value || 'None',
        respiratory_notes: (document.getElementById('asm-resp-notes')?.value || '').trim(),
        edema_severity: document.getElementById('asm-edema')?.value || 'None',
        edema_notes: (document.getElementById('asm-edema-notes')?.value || '').trim(),
        hydration_status: document.getElementById('asm-hydration')?.value || 'Normal',
        medication_adherence: document.getElementById('asm-meds')?.value || 'Good',
        medication_notes: (document.getElementById('asm-meds-notes')?.value || '').trim(),
        cognitive_observation: document.getElementById('asm-cognitive')?.value || 'Normal',
        nurse_notes: (document.getElementById('asm-notes')?.value || '').trim(),
        geo_location: geo ? `${geo.lat},${geo.lng}` : '',
        geo: geo
      };

      const res = await callApi('saveAssessment', payload);
      isVitalsSavedForActiveWO = true;
      alert('✓ 20-Point Assessment Saved!' + (res.flagged ? ' Note: Values flagged for clinical review.' : ''));
      hide('assessment-overlay');
      e.target.reset();
      const bmiOutput = document.getElementById('asm-bmi');
      if (bmiOutput) bmiOutput.value = '';
    } catch (err) { 
      alert('Failed to save assessment: ' + err.message); 
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save 20-Point Assessment';
      }
    }
  });
}

function setupStartVisitFlow() {
  document.getElementById('btn-verify-start')?.addEventListener('click', async () => {
    const code = document.getElementById('input-start-code')?.value.trim().replace(/\D/g, '');
    if (!code || code.length !== 6) return alert('Please enter a valid 6-digit numeric Start Code.');
    
    try {
      const geo = await getDeviceLocation();
      const res = await callApi('verifyStartCode', { workOrderId: activeWO.work_order_id, code, geo });
      if (res.success) {
        activeWO.status = 'IN_PROGRESS';
        hide('start-visit-overlay');
        openCockpit(activeWO);
        await loadNurseWorkOrders();
      } else { alert(res.error || 'Invalid code.'); }
    } catch (err) { alert('Verification error: ' + err.message); }
  });
}

function setupEndVisitFlow() {
  document.getElementById('btn-verify-end')?.addEventListener('click', async () => {
    if (!isVitalsSavedForActiveWO) {
      alert('⚠️ Mandatory: Submit 20-Point Vitals Assessment first.');
      hide('end-visit-overlay');
      show('assessment-overlay');
      return;
    }
    const code = document.getElementById('input-end-code')?.value.replace(/\D/g, '');
    if (code.length !== 6) return alert('Enter valid 6-digit numeric End Code.');
    
    try {
      const res = await callApi('verifyEndCode', { workOrderId: activeWO.work_order_id, code });
      if (res.success) {
        clearInterval(timerInterval);
        alert('✅ Visit Completed & Logged Successfully');
        hide('end-visit-overlay'); 
        hide('cockpit-overlay');
        await loadNurseWorkOrders();
      } else {
        alert(res.error || 'End Code Verification failed');
      }
    } catch (err) { alert('Completion error: ' + err.message); }
  });
}

function setupModalCloseButtons() {
  ['start', 'cockpit', 'assessment', 'doctor', 'end', 'sos'].forEach(id => {
    const btn = document.getElementById(`btn-close-${id === 'start' ? 'start-sheet' : id === 'end' ? 'end-sheet' : id}`);
    btn?.addEventListener('click', () => hide(id + (id === 'sos' ? '-modal' : '-overlay')));
  });
}

function setupSosHandlers() {
  document.getElementById('btn-sos-trigger')?.addEventListener('click', () => show('sos-modal'));
  document.getElementById('btn-floating-sos')?.addEventListener('click', () => show('sos-modal'));
  document.getElementById('btn-cancel-sos')?.addEventListener('click', () => hide('sos-modal'));
  document.getElementById('btn-confirm-sos')?.addEventListener('click', async () => {
    const geo = await getDeviceLocation();
    await callApi('createDoctorReviewRequest', {
      seniorId: activeWO?.senior_id || 'UNKNOWN',
      workOrderId: activeWO?.work_order_id || '',
      reason: `🚨 NURSE SOS. GPS: ${geo ? geo.lat + ',' + geo.lng : 'Unknown'}`,
      priority: 'EMERGENCY'
    });
    alert('🚨 Emergency Alert Sent to Control Room!');
    hide('sos-modal');
  });
}

function setupAssessmentBmi() {
  const weightInput = document.getElementById('asm-weight');
  const heightInput = document.getElementById('asm-height');
  const bmiOutput = document.getElementById('asm-bmi');
  if (!weightInput || !heightInput || !bmiOutput) return;

  function recalc() {
    const w = parseFloat(weightInput.value);
    const hCm = parseFloat(heightInput.value);
    if (w > 0 && hCm > 0) {
      const hM = hCm / 100;
      bmiOutput.value = (w / (hM * hM)).toFixed(1);
    } else {
      bmiOutput.value = '';
    }
  }
  weightInput.addEventListener('input', recalc);
  heightInput.addEventListener('input', recalc);
}

function setupDoctorOptions() {
  document.getElementById('btn-mark-consult')?.addEventListener('click', async () => {
    const notes = prompt('Enter brief summary of doctor consultation:');
    try {
      await callApi('markDoctorConsultDone', {
        workOrderId: activeWO.work_order_id,
        notes: notes || 'Doctor teleconsult concluded'
      });
      setText('consult-status-indicator', '✓ Consult logged successfully');
      const ind = document.getElementById('consult-status-indicator');
      if (ind) ind.style.color = '#15803d';
    } catch (err) {
      alert('Could not update consult status: ' + err.message);
    }
  });

  document.getElementById('btn-escalate-doctor')?.addEventListener('click', async () => {
    const reason = prompt('State clinical reason for urgent doctor review:');
    if (!reason) return;

    try {
      await callApi('createDoctorReviewRequest', {
        seniorId: activeWO.senior_id,
        workOrderId: activeWO.work_order_id,
        reason: reason,
        priority: 'URGENT'
      });
      alert('🚨 Clinical escalation submitted to doctor queue.');
      hide('doctor-overlay');
    } catch (err) {
      alert('Escalation error: ' + err.message);
    }
  });

  document.getElementById('btn-skip-consult-mobile')?.addEventListener('click', () => {
    hide('doctor-overlay');
  });
}

init();
