import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let activeWO = null;

async function init() {
  currentProfile = await requireAuth('nurse');
  if (!currentProfile) return;

  document.getElementById('user-display').textContent = currentProfile.full_name || 'Nurse ' + currentProfile.email;
  document.getElementById('btn-logout').addEventListener('click', signOut);

  setupBmiCalculator();
  await loadNurseWorkOrders();
}

// Helper: Captures device GPS coordinates with timeout resilience
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
          accuracy: Math.round(pos.coords.accuracy)
        });
      },
      (err) => {
        console.warn('GPS location access denied or unavailable:', err.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  });
}

function setupBmiCalculator() {
  const weightInput = document.getElementById('asm-weight');
  const heightInput = document.getElementById('asm-height');
  const bmiOutput = document.getElementById('asm-bmi');

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

  if (weightInput && heightInput && bmiOutput) {
    weightInput.addEventListener('input', recalcBmi);
    heightInput.addEventListener('input', recalcBmi);
  }
}

async function loadNurseWorkOrders() {
  try {
    const data = await callApi('getNurseDashboard', { staffId: currentProfile.staff_id || '' });
    const tbody = document.querySelector('#nurse-wo-table tbody');
    tbody.innerHTML = '';

    const orders = data.workOrders || [];
    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5">No active work orders assigned to you.</td></tr>';
      return;
    }

    orders.forEach(wo => {
      const tr = document.createElement('tr');
      const badgeClass = wo.status === 'COMPLETE' ? 'badge-green' : (wo.status === 'IN_PROGRESS' ? 'badge-yellow' : 'badge-blue');

      let displayTime = wo.created_at || '-';
      try {
        if (wo.created_at) {
          displayTime = new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
        }
      } catch (e) {}

      tr.innerHTML = `
        <td><strong>${wo.work_order_id}</strong></td>
        <td><code>${wo.senior_id}</code></td>
        <td>${displayTime}</td>
        <td><span class="badge ${badgeClass}">${wo.status}</span></td>
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
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const match = orders.find(w => w.work_order_id === id);
        if (match) openVisitWorkspace(match);
      });
    });

    document.querySelectorAll('.view-report-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const seniorId = e.target.getAttribute('data-senior');
        if (!seniorId) return alert('No senior patient ID associated with this visit.');

        const originalText = e.target.textContent;
        e.target.textContent = 'Loading...';
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
      });
    });

  } catch (err) {
    alert('Error loading assigned visits: ' + err.message);
  }
}

function openVisitWorkspace(wo) {
  activeWO = wo;
  const workspace = document.getElementById('visit-workspace');
  workspace.classList.remove('hidden');

  document.getElementById('active-wo-id').textContent = wo.work_order_id;
  document.getElementById('active-senior-name').textContent = wo.senior_id;
  document.getElementById('active-lifecycle-badge').textContent = wo.status;

  const stepStart = document.getElementById('step-start');
  const stepAsm = document.getElementById('step-assessment');
  const stepDoc = document.getElementById('step-doctor');
  const stepEnd = document.getElementById('step-end');

  const inputStart = document.getElementById('input-start-code');
  const inputEnd = document.getElementById('input-end-code');
  if (inputStart) inputStart.value = '';
  if (inputEnd) inputEnd.value = '';

  if (wo.status === 'COMPLETE' || wo.status === 'CLOSE') {
    stepStart.className = 'step-card done';
    document.getElementById('badge-step-start').textContent = 'VERIFIED';
    document.getElementById('badge-step-start').className = 'badge badge-green';

    stepAsm.classList.remove('hidden');
    stepAsm.className = 'step-card done';
    document.getElementById('badge-step-asm').textContent = 'COMPLETED';
    document.getElementById('badge-step-asm').className = 'badge badge-green';

    stepDoc.classList.add('hidden');
    stepEnd.classList.remove('hidden');
    stepEnd.className = 'step-card done';
    document.getElementById('badge-step-end').textContent = 'VISIT COMPLETED';
    document.getElementById('badge-step-end').className = 'badge badge-green';
  } else if (wo.status === 'IN_PROGRESS') {
    stepStart.className = 'step-card done';
    document.getElementById('badge-step-start').textContent = 'VERIFIED';
    document.getElementById('badge-step-start').className = 'badge badge-green';

    stepAsm.classList.remove('hidden');
    stepAsm.className = 'step-card active';

    stepDoc.classList.add('hidden');
    stepEnd.classList.add('hidden');
  } else {
    stepStart.className = 'step-card active';
    document.getElementById('badge-step-start').textContent = 'REQUIRED TO START';
    document.getElementById('badge-step-start').className = 'badge badge-yellow';

    stepAsm.classList.add('hidden');
    stepDoc.classList.add('hidden');
    stepEnd.classList.add('hidden');
  }

  workspace.scrollIntoView({ behavior: 'smooth' });
}

// 1. Verify Start Code (NUMERIC ONLY + GEO LOCATION)
document.getElementById('btn-verify-start').addEventListener('click', async () => {
  if (activeWO && (activeWO.status === 'COMPLETE' || activeWO.status === 'CLOSE')) {
    return alert('This visit has already been completed.');
  }

  const rawInput = document.getElementById('input-start-code').value;
  const code = rawInput.trim().replace(/\D/g, '');

  if (!code || code.length !== 6) {
    return alert('Please enter a valid 6-digit numeric Start Code.');
  }

  const btn = document.getElementById('btn-verify-start');
  btn.disabled = true;
  btn.textContent = 'Verifying & Acquiring GPS...';

  try {
    const geo = await getDeviceLocation();

    const res = await callApi('verifyStartCode', {
      workOrderId: activeWO.work_order_id,
      code: code,
      geo: geo
    });

    if (res.success) {
      alert('Start Code Verified! Work order is now IN_PROGRESS.' + (geo ? `\nLocation logged: (${geo.lat}, ${geo.lng})` : ''));
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

// 2. Submit 20-Point Assessment (+ GEO LOCATION & TIMESTAMP)
document.getElementById('assessment-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting & Logging GPS...';
  }

  try {
    const geo = await getDeviceLocation();
    const bpSys = document.getElementById('asm-bp-sys').value;
    const bpDia = document.getElementById('asm-bp-dia').value;

    const payload = {
      senior_id: activeWO.senior_id,
      visit_id: activeWO.work_order_id,

      // 1. Blood Pressure
      bp_systolic: Number(bpSys),
      bp_diastolic: Number(bpDia),
      bp: bpSys + '/' + bpDia,

      // 2-4
      heart_rate: Number(document.getElementById('asm-hr').value),
      spo2: Number(document.getElementById('asm-spo2').value),
      respiratory_rate: Number(document.getElementById('asm-rr').value),

      // 5. Temperature
      temperature: Number(document.getElementById('asm-temp').value),
      temperature_unit: document.getElementById('asm-temp-unit').value,

      // 6-7. Glucose
      glucose_fasting: document.getElementById('asm-glucose-fasting').value ? Number(document.getElementById('asm-glucose-fasting').value) : '',
      glucose_random: document.getElementById('asm-glucose-random').value ? Number(document.getElementById('asm-glucose-random').value) : '',
      glucose_timing: document.getElementById('asm-glucose-timing').value.trim(),

      // 8-10. Measurements
      weight: document.getElementById('asm-weight').value ? Number(document.getElementById('asm-weight').value) : '',
      height: document.getElementById('asm-height').value ? Number(document.getElementById('asm-height').value) : '',
      bmi: document.getElementById('asm-bmi').value || '',

      // 11-12
      waist_circumference: document.getElementById('asm-waist').value ? Number(document.getElementById('asm-waist').value) : '',
      pain_level: Number(document.getElementById('asm-pain').value || 0),
      pain_location: document.getElementById('asm-pain-location').value.trim(),

      // 13-15
      level_of_consciousness: document.getElementById('asm-loc').value,
      fall_risk: document.getElementById('asm-fall').value,
      mobility_status: document.getElementById('asm-mobility').value,

      // 16-17
      respiratory_symptoms: document.getElementById('asm-resp-symptoms').value,
      respiratory_notes: document.getElementById('asm-resp-notes').value.trim(),
      edema_severity: document.getElementById('asm-edema').value,
      edema_notes: document.getElementById('asm-edema-notes').value.trim(),

      // 18-19
      hydration_status: document.getElementById('asm-hydration').value,
      medication_adherence: document.getElementById('asm-meds').value,
      medication_notes: document.getElementById('asm-meds-notes').value.trim(),

      // 20
      cognitive_observation: document.getElementById('asm-cognitive').value,

      // Additional Notes
      nurse_notes: document.getElementById('asm-notes').value.trim(),

      // Device GPS object
      geo: geo
    };

    const res = await callApi('saveAssessment', payload);

    alert('✓ 20-Point Assessment saved to database!' + (res.flagged ? ' Note: Values flagged for clinical review.' : ''));
    
    document.getElementById('step-assessment').className = 'step-card done';
    document.getElementById('badge-step-asm').textContent = 'SAVED';
    document.getElementById('badge-step-asm').className = 'badge badge-green';

    document.getElementById('step-doctor').classList.remove('hidden');
    document.getElementById('step-doctor').className = 'step-card active';
    document.getElementById('step-end').classList.remove('hidden');
    document.getElementById('step-end').className = 'step-card active';

  } catch (err) {
    alert('Failed to save assessment: ' + err.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save 20-Point Assessment';
    }
  }
});

// 3. Doctor Consult Handlers
document.getElementById('btn-mark-consult').addEventListener('click', async () => {
  const notes = prompt('Enter brief summary of doctor consultation:');
  try {
    await callApi('markDoctorConsultDone', {
      workOrderId:
      workOrderId: activeWO.work_order_id,
      notes: notes || 'Doctor teleconsult concluded'
    });
    document.getElementById('consult-status-indicator').textContent = '✓ Consult logged';
    document.getElementById('consult-status-indicator').style.color = '#38a169';
  } catch (err) {
    alert('Could not update consult status: ' + err.message);
  }
});

document.getElementById('btn-escalate-doctor').addEventListener('click', async () => {
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

document.getElementById('btn-skip-consult').addEventListener('click', () => {
  document.getElementById('step-doctor').className = 'step-card done';
  document.getElementById('step-end').classList.remove('hidden');
  document.getElementById('step-end').className = 'step-card active';
  document.getElementById('input-end-code').focus();
});

// 4. Verify End Code (NUMERIC ONLY)
document.getElementById('btn-verify-end').addEventListener('click', async () => {
  if (activeWO && (activeWO.status === 'COMPLETE' || activeWO.status === 'CLOSE')) {
    return alert('This visit has already been concluded.');
  }

  const rawInput = document.getElementById('input-end-code').value;
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
      document.getElementById('visit-workspace').classList.add('hidden');
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

init();
