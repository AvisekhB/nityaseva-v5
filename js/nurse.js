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
        <td><button class="open-wo-btn" data-id="${wo.work_order_id}">Open Workspace</button></td>
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

  if (wo.status === 'IN_PROGRESS') {
    stepStart.className = 'step-card done';
    document.getElementById('badge-step-start').textContent = 'VERIFIED';
    document.getElementById('badge-step-start').className = 'badge badge-green';

    stepAsm.classList.remove('hidden');
    stepAsm.className = 'step-card active';
    stepDoc.classList.remove('hidden');
    stepEnd.classList.remove('hidden');
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

// 1. Verify Start Code
document.getElementById('btn-verify-start').addEventListener('click', async () => {
  const code = document.getElementById('input-start-code').value.trim();
  if (!code) return alert('Please enter the Start Code provided by the senior/family.');

  try {
    const res = await callApi('verifyStartCode', {
      workOrderId: activeWO.work_order_id,
      code: code
    });

    if (res.success) {
      alert('Start Code Verified! Work order is now IN_PROGRESS.');
      activeWO.status = 'IN_PROGRESS';
      openVisitWorkspace(activeWO);
      await loadNurseWorkOrders();
    } else {
      alert(res.error || 'Verification failed');
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  }
});

// 2. Submit 20-Point Assessment (full spec-compliant payload)
document.getElementById('assessment-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
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

      // 8-10. Weight/Height/BMI
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

      // Additional
      nurse_notes: document.getElementById('asm-notes').value.trim()
    };

    const res = await callApi('saveAssessment', payload);

    alert('20-Point Assessment saved to record!' + (res.flagged ? ' Note: Values flagged for clinical review.' : ''));
    document.getElementById('step-assessment').className = 'step-card done';
    document.getElementById('badge-step-asm').textContent = 'COMPLETED';
    document.getElementById('badge-step-asm').className = 'badge badge-green';

    document.getElementById('step-doctor').className = 'step-card active';
  } catch (err) {
    alert('Failed to save assessment: ' + err.message);
  }
});

// 3. Doctor Consult Handlers
document.getElementById('btn-mark-consult').addEventListener('click', async () => {
  const notes = prompt('Enter brief summary of doctor consultation:');
  try {
    await callApi('markDoctorConsultDone', {
      workOrderId: activeWO.work_order_id,
      notes: notes || 'Doctor teleconsult concluded'
    });
    document.getElementById('consult-status-indicator').textContent = '✓ Consult completed and logged';
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
  document.getElementById('step-end').className = 'step-card active';
  document.getElementById('input-end-code').focus();
});

// 4. Verify End Code
document.getElementById('btn-verify-end').addEventListener('click', async () => {
  const code = document.getElementById('input-end-code').value.trim();
  if (!code) return alert('Please enter the End Code provided by the senior/family to complete this visit.');

  try {
    const res = await callApi('verifyEndCode', {
      workOrderId: activeWO.work_order_id,
      code: code
    });

    if (res.success) {
      alert('End Code Verified! Work order marked COMPLETE. Care report logged.');
      document.getElementById('visit-workspace').classList.add('hidden');
      await loadNurseWorkOrders();
    } else {
      alert(res.error || 'Completion authorization failed');
    }
  } catch (err) {
    alert('Verification error: ' + err.message);
  }
});

init();
