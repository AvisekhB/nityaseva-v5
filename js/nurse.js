import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let activeWO = null;

async function init() {
  try {
    currentProfile = await requireAuth('nurse');
    if (!currentProfile) return;

    const userDisplay = document.getElementById('user-display');
    if (userDisplay) {
      userDisplay.textContent = currentProfile.full_name || currentProfile.email || 'Field Nurse';
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', signOut);
    }

    setupBmiCalculator();
    setupSosHandlers();
    await loadNurseWorkOrders();
  } catch (err) {
    console.error('Nurse Portal Initialization Error:', err);
    const tbody = document.querySelector('#nurse-wo-table tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center;">Failed to load assignments: ${err.message}</td></tr>`;
    }
  }
}

// -------------------------------------------------------------
// BMI CALCULATOR
// -------------------------------------------------------------
function setupBmiCalculator() {
  const weightInput = document.getElementById('asm-weight');
  const heightInput = document.getElementById('asm-height');
  const bmiOutput = document.getElementById('asm-bmi');

  if (!weightInput || !heightInput || !bmiOutput) return;

  function recalcBmi() {
    const weight = parseFloat(weightInput.value);
    const heightCm = parseFloat(heightInput.value);
    if (weight > 0 && heightCm > 0) {
      const heightM = heightCm / 100;
      const bmi = weight / (heightM * heightM);
      bmiOutput.value = bmi.toFixed(1);
    } else {
      bmiOutput.value = '';
    }
  }

  weightInput.addEventListener('input', recalcBmi);
  heightInput.addEventListener('input', recalcBmi);
}

// -------------------------------------------------------------
// DEVICE GPS LOCATION CAPTURE
// -------------------------------------------------------------
function getDeviceLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
          accuracy: Math.round(pos.coords.accuracy),
          timestamp: new Date().toISOString()
        });
      },
      (err) => {
        console.warn('GPS location access denied or timed out:', err.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  });
}

// -------------------------------------------------------------
// LOAD ASSIGNED WORK ORDERS
// -------------------------------------------------------------
async function loadNurseWorkOrders() {
  const tbody = document.querySelector('#nurse-wo-table tbody');
  if (!tbody) return;

  try {
    const staffId = currentProfile ? (currentProfile.staff_id || currentProfile.userId || '') : '';
    const data = await callApi('getNurseDashboard', { staffId: staffId });

    tbody.innerHTML = '';
    const orders = (data && data.workOrders) ? data.workOrders : [];

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:16px; color:#718096;">No active work orders assigned to you today.</td></tr>';
      return;
    }

    orders.forEach(wo => {
      const tr = document.createElement('tr');
      const st = String(wo.status || '').toUpperCase();
      const badgeClass = (st === 'COMPLETE' || st === 'CLOSE')
        ? 'badge-green'
        : (st === 'IN_PROGRESS' ? 'badge-yellow' : 'badge-blue');

      let displayTime = '-';
      if (wo.created_at) {
        try {
          displayTime = new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
        } catch (e) {
          displayTime = wo.created_at;
        }
      }

      tr.innerHTML = `
        <td><strong>${wo.work_order_id || '--'}</strong></td>
        <td><code>${wo.senior_id || '--'}</code></td>
        <td>${displayTime}</td>
        <td><span class="badge ${badgeClass}">${wo.status || 'SCHEDULED'}</span></td>
        <td>
          <div style="display:flex; gap:6px; align-items:center;">
            <button class="open-wo-btn" data-id="${wo.work_order_id}">Open Workspace</button>
            <button class="view-report-btn secondary" data-senior="${wo.senior_id}" title="View Clinical Care Summary">👁️ View</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.open-wo-btn').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.target.getAttribute('data-id');
        const match = orders.find(w => w.work_order_id === id);
        if (match) openVisitWorkspace(match);
      };
    });

    document.querySelectorAll('.view-report-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const seniorId = e.target.getAttribute('data-senior');
        if (!seniorId) return alert('No senior patient ID associated with this visit.');

        const originalText = e.target.textContent;
        e.target.textContent = '...';
        e.target.disabled = true;

        try {
          const res = await callApi('generateClinicalCareReport', { seniorId: seniorId });
          window.open(`report.html?token=${res.token}`, '_blank');
        } catch (err) {
          alert('Error opening patient report: ' + err.message);
        } finally {
          e.target.textContent = originalText;
          e.target.disabled = false;
        }
      };
    });

  } catch (err) {
    console.error('Failed to load nurse work orders:', err);
    tbody.innerHTML = `<tr><td colspan="5" style="color:#e53e3e; text-align:center; padding:14px;">Error connecting to service: ${err.message}</td></tr>`;
  }
}

// -------------------------------------------------------------
// WORKSPACE WORKFLOW ORCHESTRATION
// -------------------------------------------------------------
function openVisitWorkspace(wo) {
  activeWO = wo;
  const workspace = document.getElementById('visit-workspace');
  if (!workspace) return;
  workspace.classList.remove('hidden');

  const woIdEl = document.getElementById('active-wo-id');
  const seniorEl = document.getElementById('active-senior-name');
  const badgeEl = document.getElementById('active-lifecycle-badge');

  if (woIdEl) woIdEl.textContent = wo.work_order_id;
  if (seniorEl) seniorEl.textContent = wo.senior_id;
  if (badgeEl) {
    badgeEl.textContent = wo.status;
    badgeEl.className = 'badge ' + (wo.status === 'COMPLETE' ? 'badge-green' : (wo.status === 'IN_PROGRESS' ? 'badge-yellow' : 'badge-blue'));
  }

  const stepStart = document.getElementById('step-start');
  const stepAsm = document.getElementById('step-assessment');
  const stepDoc = document.getElementById('step-doctor');
  const stepEnd = document.getElementById('step-end');

  const inputStart = document.getElementById('input-start-code');
  const inputEnd = document.getElementById('input-end-code');
  if (inputStart) inputStart.value = '';
  if (inputEnd) inputEnd.value = '';

  const st = String(wo.status || '').toUpperCase();

  // STATE 1: COMPLETE OR CLOSED
  if (st === 'COMPLETE' || st === 'CLOSE') {
    if (stepStart) {
      stepStart.className = 'step-card done';
      const b = document.getElementById('badge-step-start');
      if (b) { b.textContent = 'VERIFIED'; b.className = 'badge badge-green'; }
    }
    if (stepAsm) {
      stepAsm.classList.remove('hidden');
      stepAsm.className = 'step-card done';
      const b = document.getElementById('badge-step-asm');
      if (b) { b.textContent = 'COMPLETED'; b.className = 'badge badge-green'; }
    }
    if (stepDoc) stepDoc.classList.add('hidden');
    if (stepEnd) {
      stepEnd.classList.remove('hidden');
      stepEnd.className = 'step-card done';
      const b = document.getElementById('badge-step-end');
      if (b) { b.textContent = 'VISIT CONCLUDED'; b.className = 'badge badge-green'; }
    }
  }
  // STATE 2: IN PROGRESS
  else if (st === 'IN_PROGRESS') {
    if (stepStart) {
      stepStart.className = 'step-card done';
      const b = document.getElementById('badge-step-start');
      if (b) { b.textContent = 'VERIFIED'; b.className = 'badge badge-green'; }
    }
    if (stepAsm) {
      stepAsm.classList.remove('hidden');
      stepAsm.className = 'step-card active';
      const b = document.getElementById('badge-step-asm');
      if (b) { b.textContent = 'IN PROGRESS'; b.className = 'badge badge-blue'; }
    }
    if (stepDoc) stepDoc.classList.add('hidden');
    if (stepEnd) stepEnd.classList.add('hidden');
  }
  // STATE 3: SCHEDULED (START CODE REQUIRED)
  else {
    if (stepStart) {
      stepStart.className = 'step-card active';
      const b = document.getElementById('badge-step-start');
      if (b) { b.textContent = 'REQUIRED TO START'; b.className = 'badge badge-yellow'; }
    }
    if (stepAsm) stepAsm.classList.add('hidden');
    if (stepDoc) stepDoc.classList.add('hidden');
    if (stepEnd) stepEnd.classList.add('hidden');
  }

  workspace.scrollIntoView({ behavior: 'smooth' });
}

// -------------------------------------------------------------
// STEP 1: VERIFY START CODE (NUMERIC + GPS)
// -------------------------------------------------------------
document.getElementById('btn-verify-start')?.addEventListener('click', async () => {
  if (activeWO && (activeWO.status === 'COMPLETE' || activeWO.status === 'CLOSE')) {
    return alert('This visit has already been completed.');
  }

  const rawInput = document.getElementById('input-start-code')?.value || '';
  const code = rawInput.trim().replace(/\D/g, '');

  if (!code || code.length !== 6) {
    return alert('Please enter a valid 6-digit numeric Start Code.');
  }

  const btn = document.getElementById('btn-verify-start');
  btn.disabled = true;
  btn.textContent = 'Verifying & Capturing GPS...';

  try {
    const geo = await getDeviceLocation();

    const res = await callApi('verifyStartCode', {
      workOrderId: activeWO.work_order_id,
      code: code,
      geo: geo
    });

    if (res.success) {
      alert('Start Code Verified! Work order is now IN_PROGRESS.' + (geo ? `\nGPS Location: Lat ${geo.lat}, Lng ${geo.lng}` : ''));
      activeWO.status = 'IN_PROGRESS';
      openVisitWorkspace(activeWO);
      await loadNurseWorkOrders();
    } else {
      alert(res.error || 'Verification failed');
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Authorize & Start Visit';
  }
});

// -------------------------------------------------------------
// STEP 2: SUBMIT 20-POINT ASSESSMENT (WITH GPS)
// -------------------------------------------------------------
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

    alert('✓ 20-Point Assessment saved to database!' + (res.flagged ? ' Note: Values flagged for clinical review.' : ''));

    const stepAsm = document.getElementById('step-assessment');
    if (stepAsm) {
      stepAsm.className = 'step-card done';
      const b = document.getElementById('badge-step-asm');
      if (b) { b.textContent = 'SAVED'; b.className = 'badge badge-green'; }
    }

    const stepDoc = document.getElementById('step-doctor');
    const stepEnd = document.getElementById('step-end');
    if (stepDoc) { stepDoc.classList.remove('hidden'); stepDoc.className = 'step-card active'; }
    if (stepEnd) { stepEnd.classList.remove('hidden'); stepEnd.className = 'step-card active'; }

  } catch (err) {
    alert('Failed to save assessment: ' + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save 20-Point Assessment';
    }
  }
});

// -------------------------------------------------------------
// STEP 3: DOCTOR CONSULT HANDLERS
// -------------------------------------------------------------
document.getElementById('btn-mark-consult')?.addEventListener('click', async () => {
  const notes = prompt('Enter brief summary of doctor consultation:');
  try {
    await callApi('markDoctorConsultDone', {
      workOrderId: activeWO.work_order_id,
      notes: notes || 'Doctor teleconsult concluded'
    });
    const ind = document.getElementById('consult-status-indicator');
    if (ind) {
      ind.textContent = '✓ Consult logged';
      ind.style.color = '#38a169';
    }
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
    alert('Clinical escalation submitted to doctor queue.');
  } catch (err) {
    alert('Escalation error: ' + err.message);
  }
});

document.getElementById('btn-skip-consult')?.addEventListener('click', () => {
  const stepDoc = document.getElementById('step-doctor');
  const stepEnd = document.getElementById('step-end');
  if (stepDoc) stepDoc.className = 'step-card done';
  if (stepEnd) {
    stepEnd.classList.remove('hidden');
    stepEnd.className = 'step-card active';
    document.getElementById('input-end-code')?.focus();
  }
});

// -------------------------------------------------------------
// STEP 4: VERIFY END CODE (NUMERIC)
// -------------------------------------------------------------
document.getElementById('btn-verify-end')?.addEventListener('click', async () => {
  if (activeWO && (activeWO.status === 'COMPLETE' || activeWO.status ===
'CLOSE')) {
    return alert('This visit has already been concluded.');
  }

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
      alert('End Code Verified! Work order marked COMPLETE.');
      const workspace = document.getElementById('visit-workspace');
      if (workspace) workspace.classList.add('hidden');
      await loadNurseWorkOrders();
    } else {
      alert(res.error || 'Completion authorization failed');
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify End Code & Complete Visit';
  }
});

// -------------------------------------------------------------
// SOS EMERGENCY HANDLER (Banner + Floating Button)
// -------------------------------------------------------------
function setupSosHandlers() {
  const modal = document.getElementById('sos-modal');
  const btnBanner = document.getElementById('btn-sos-banner');
  const btnFloating = document.getElementById('btn-floating-sos');
  const btnCancel = document.getElementById('btn-cancel-sos');
  const btnConfirm = document.getElementById('btn-confirm-sos');

  const openModal = () => modal && modal.classList.remove('hidden');
  const closeModal = () => modal && modal.classList.add('hidden');

  if (btnBanner) btnBanner.addEventListener('click', openModal);
  if (btnFloating) btnFloating.addEventListener('click', openModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

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
        closeModal();
      } catch (err) {
        alert('Alert dispatch error: ' + err.message + '\nPlease call 112 directly.');
      } finally {
        btnConfirm.disabled = false;
        btnConfirm.textContent = '🚨 Alert Control Room (With GPS)';
      }
    });
  }
}

init();
