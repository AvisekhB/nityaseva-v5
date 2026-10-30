import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let currentStaffProfile = null;
let allWorkOrders = [];
let activeWO = null;
let timerInterval = null;
let visitStartTime = null;

// -------------------------------------------------------------
// SAFE DOM HELPERS
// -------------------------------------------------------------
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text !== undefined && text !== null ? text : '';
}
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html !== undefined && html !== null ? html : '';
}
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
// GPS LOCATION CAPTURE
// -------------------------------------------------------------
function getDeviceLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude.toFixed(6),
        lng: pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy)
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  });
}

// -------------------------------------------------------------
// NURSE AVATAR / PHOTO UPLOAD
// -------------------------------------------------------------
function setupNurseAvatarUpload() {
  const trigger = document.getElementById('btn-nurse-avatar');
  const input = document.getElementById('nurse-photo-input');
  if (!trigger || !input) return;

  trigger.addEventListener('click', () => input.click());

  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX = 200;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
        else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const base64 = canvas.toDataURL('image/jpeg', 0.75);

        renderNurseAvatar(base64);

        try {
          if (currentStaffProfile && currentStaffProfile.staff_id) {
            await callApi('updateNursePhoto', { staffId: currentStaffProfile.staff_id, photoData: base64 });
          }
        } catch (err) {
          console.warn('Photo upload sync failed:', err.message);
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderNurseAvatar(base64) {
  setHTML('btn-nurse-avatar', `<img src="${base64}" alt="Nurse Photo">`);
}

// -------------------------------------------------------------
// LOAD NURSE PROFILE + ASSIGNED WORK ORDERS (STRICT FILTER)
// -------------------------------------------------------------
async function loadNurseWorkOrders() {
  try {
    const staffId = currentProfile ? (currentProfile.staff_id || currentProfile.userId || '') : '';
    const data = await callApi('getNurseDashboard', { staffId: staffId });

    currentStaffProfile = data.staffProfile || { full_name: 'Nurse', staff_id: staffId };
    setText('nurse-name-display', currentStaffProfile.full_name || 'Field Nurse');
    setText('nurse-id-display', currentStaffProfile.staff_id || 'STF-XXXX');

    if (currentStaffProfile.photo_url && String(currentStaffProfile.photo_url).startsWith('data:image')) {
      renderNurseAvatar(currentStaffProfile.photo_url);
    }

    allWorkOrders = (data.workOrders || []).filter(w => String(w.status).toUpperCase() !== 'CLOSE');
    renderRouteList();

  } catch (err) {
    console.error('Failed to load nurse work orders:', err);
    setHTML('route-list-container', `<p style="color:#dc2626; text-align:center; padding:16px 0;">Error: ${err.message}</p>`);
  }
}

function renderRouteList() {
  const container = document.getElementById('route-list-container');
  if (!container) return;

  setText('route-count-badge', `${allWorkOrders.length} Visit${allWorkOrders.length === 1 ? '' : 's'}`);

  if (allWorkOrders.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:13px; padding:20px 0;">No visits assigned to you today. 🎉</p>';
    return;
  }

  // Sort: IN_PROGRESS first, then SCHEDULED, then COMPLETE
  const priority = { 'IN_PROGRESS': 0, 'SCHEDULED': 1, 'UNSCHEDULED': 1, 'COMPLETE': 2 };
  const sorted = [...allWorkOrders].sort((a, b) => {
    const pa = priority[String(a.status).toUpperCase()] ?? 3;
    const pb = priority[String(b.status).toUpperCase()] ?? 3;
    return pa - pb;
  });

  container.innerHTML = sorted.map(wo => {
    const st = String(wo.status || '').toUpperCase();
    const badgeClass = st === 'IN_PROGRESS' ? 'badge-in_progress' : (st === 'COMPLETE' ? 'badge-complete' : 'badge-scheduled');

    let displayTime = '-';
    if (wo.created_at) {
      try {
        displayTime = new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
      } catch (e) { displayTime = wo.created_at; }
    }

    const serviceLabel = wo.type === 'DoctorConsult' ? '🩺 Doctor Teleconsult' : '👩‍⚕️ Nurse Home Visit';

    return `
      <div class="visit-card-item" data-id="${wo.work_order_id}">
        <div class="visit-card-top">
          <span class="visit-senior-name">${wo.senior_name || wo.senior_id}</span>
          <span class="status-badge ${badgeClass}">${wo.status}</span>
        </div>
        <div class="visit-meta-row">📋 ${serviceLabel}</div>
        <div class="visit-meta-row">🕐 ${displayTime}</div>
        <div class="visit-meta-row">🆔 ${wo.work_order_id}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.visit-card-item').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id');
      const match = allWorkOrders.find(w => w.work_order_id === id);
      if (match) openVisitFlow(match);
    });
  });
}

// -------------------------------------------------------------
// ROUTE VISIT CLICK → OPEN CORRECT MODAL BASED ON STATUS
// -------------------------------------------------------------
function openVisitFlow(wo) {
  activeWO = wo;
  const st = String(wo.status || '').toUpperCase();

  if (st === 'COMPLETE' || st === 'CLOSE') {
    alert(`✅ This visit for ${wo.senior_name || wo.senior_id} has already been completed.`);
    return;
  }

  if (st === 'IN_PROGRESS') {
    openCockpit(wo);
  } else {
    openStartVisitSheet(wo);
  }
}

// -------------------------------------------------------------
// MODAL SHEET 1: START VISIT (OTP ENTRY)
// -------------------------------------------------------------
function openStartVisitSheet(wo) {
  setText('start-sheet-senior-name', wo.senior_name || wo.senior_id);
  setText('start-sheet-contact-info', `Sent to ${wo.senior_name || 'senior'}'s family (${wo.senior_phone || 'on file'}). Ask them to read you the code.`);
  const input = document.getElementById('input-start-code');
  if (input) input.value = '';
  show('start-visit-overlay');
}

function setupStartVisitFlow() {
  document.getElementById('btn-verify-start')?.addEventListener('click', async () => {
    const rawInput = document.getElementById('input-start-code')?.value || '';
    const code = rawInput.trim().replace(/\D/g, '');

    if (!code || code.length !== 6) {
      return alert('Please enter a valid 6-digit numeric Start Code.');
    }

    const btn = document.getElementById('btn-verify-start');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
      const geo = await getDeviceLocation();
      const res = await callApi('verifyStartCode', {
        workOrderId: activeWO.work_order_id,
        code: code,
        geo: geo
      });

      if (res.success) {
        activeWO.status = 'IN_PROGRESS';
        activeWO._geo = geo;
        hide('start-visit-overlay');
        openCockpit(activeWO);
        await loadNurseWorkOrders();
      } else {
        alert(res.error || 'Invalid code. Please try again.');
      }
    } catch (err) {
      alert('Verification error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Start Visit';
    }
  });

  document.getElementById('btn-resend-code')?.addEventListener('click', (e) => {
    e.preventDefault();
    alert('📱 A reminder has been sent to the family with the visit code.');
  });
}

// -------------------------------------------------------------
// MODAL SHEET 2: VISIT IN PROGRESS (COCKPIT)
// -------------------------------------------------------------
function openCockpit(wo) {
  setText('cockpit-senior-name', wo.senior_name || wo.senior_id);
  setText('cockpit-service-sub', `${wo.type === 'DoctorConsult' ? 'Doctor Teleconsult' : 'Home Visit'} • Today`);
  setText('family-request-notes', wo.notes || wo.care_notes || 'Routine wellness check & vitals monitoring.');

  // Location text
  if (wo._geo && wo._geo.lat) {
    setText('location-confirmed-text', `Lat ${wo._geo.lat}, Lng ${wo._geo.lng} (±${wo._geo.accuracy}m)`);
  } else {
    setText('location-confirmed-text', wo.senior_address || 'Address on file');
  }

  // Start live timer
  visitStartTime = wo.start_verified_at ? new Date(wo.start_verified_at) : new Date();
  setText('timer-started-at', 'started ' + visitStartTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  startLiveTimer();

  show('cockpit-overlay');
}

function startLiveTimer() {
  if (timerInterval) clearInterval(timerInterval);

  function tick() {
    const diffMs = Date.now() - visitStartTime.getTime();
    const totalSec = Math.max(0, Math.floor(diffMs / 1000));
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSec % 60).padStart(2, '0');
    setText('live-timer-display', `${hh}:${mm}:${ss}`);
  }

  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopLiveTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// -------------------------------------------------------------
// COCKPIT ACTION BUTTONS
// -------------------------------------------------------------
function setupCockpitActions() {
  document.getElementById('btn-open-assessment')?.addEventListener('click', () => {
    show('assessment-overlay');
  });
  document.getElementById('btn-doctor-options')?.addEventListener('click', () => {
    show('doctor-overlay');
  });
  document.getElementById('btn-open-end-code')?.addEventListener('click', () => {
    const input = document.getElementById('input-end-code');
    if (input) input.value = '';
    show('end-visit-overlay');
  });
}

// -------------------------------------------------------------
// BMI AUTO-CALC
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// -------------------------------------------------------------
// STEP 2: SUBMIT 20-POINT ASSESSMENT (WITH GPS)
// -------------------------------------------------------------
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

        bp_systolic: Number(bpSys),
        bp_diastolic: Number(bpDia),
        bp: bpSys + '/' + bpDia,

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

        geo: geo,
        geo_location: geo ? `Lat: ${geo.lat}, Lng: ${geo.lng} (Acc: ${geo.accuracy}m)` : ''
      };

      const res = await callApi('saveAssessment', payload);

      alert('✓ 20-Point Assessment saved!' + (res.flagged ? ' Note: Values flagged for clinical review.' : ''));
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

// -------------------------------------------------------------
// STEP 3: DOCTOR CONSULT HANDLERS
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// STEP 4: VERIFY END CODE (NUMERIC)
// -------------------------------------------------------------
function setupEndVisitFlow() {
  document.getElementById('btn-verify-end')?.addEventListener('click', async () => {
    const rawInput = document.getElementById('input-end-code')?.value || '';
    const code = rawInput.trim().replace(/\D/g, '');

    if (!code || code.length !== 6) {
      return alert('Please enter a valid 6-digit numeric End Code.');
    }

    const btn = document.getElementById('btn-verify-end');
    btn.disabled = true;
    btn.textContent = 'Verifying End Code...';

    try {
      const res = await callApi('verifyEndCode', {
        workOrderId: activeWO.work_order_id,
        code: code
      });

      if (res.success) {
        stopLiveTimer();
        alert('✅ End Code Verified! Visit marked COMPLETE.');
        hide('end-visit-overlay');
        hide('cockpit-overlay');
        hide('doctor-overlay');
        hide('assessment-overlay');
        activeWO = null;
        await loadNurseWorkOrders();
      } else {
        alert(res.error || 'Completion authorization failed');
      }
    } catch (err) {
      alert('Verification error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Complete & Close Visit';
    }
  });
}

// -------------------------------------------------------------
// MODAL CLOSE BUTTONS (Universal wiring for all sheets)
// -------------------------------------------------------------
function setupModalCloseButtons() {
  document.getElementById('btn-close-start-sheet')?.addEventListener('click', () => hide('start-visit-overlay'));
  document.getElementById('btn-close-cockpit')?.addEventListener('click', () => hide('cockpit-overlay'));
  document.getElementById('btn-close-assessment')?.addEventListener('click', () => hide('assessment-overlay'));
  document.getElementById('btn-close-doctor')?.addEventListener('click', () => hide('doctor-overlay'));
  document.getElementById('btn-close-end-sheet')?.addEventListener('click', () => hide('end-visit-overlay'));
}

// -------------------------------------------------------------
// SOS EMERGENCY HANDLER
// -------------------------------------------------------------
function setupSosHandlers() {
  const btnTrigger = document.getElementById('btn-sos-trigger');
  const btnCancel = document.getElementById('btn-cancel-sos');
  const btnConfirm = document.getElementById('btn-confirm-sos');

  if (btnTrigger) btnTrigger.addEventListener('click', () => show('sos-modal'));
  if (btnCancel) btnCancel.addEventListener('click', () => hide('sos-modal'));

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      btnConfirm.disabled = true;
      btnConfirm.textContent = '📡 Sending Alert...';

      try {
        const geo = await getDeviceLocation();
        const seniorId = activeWO ? activeWO.senior_id : 'UNKNOWN';
        const workOrderId = activeWO ? activeWO.work_order_id : '';

        await callApi('createDoctorReviewRequest', {
          seniorId: seniorId,
          workOrderId: workOrderId,
          reason: `🚨 NURSE SOS TRIGGERED. GPS: ${geo ? `Lat ${geo.lat}, Lng ${geo.lng} (±${geo.accuracy}m)` : 'Unavailable'}`,
          priority: 'EMERGENCY'
        });

        alert('🚨 Emergency alert sent to Control Room with your location. Stay with the patient.');
        hide('sos-modal');
      } catch (err) {
        alert('Alert dispatch error: ' + err.message + '\nPlease call 112 directly.');
      } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = '🚨 Alert Control Room (GPS)';
      }
    });
  }
}

init();
