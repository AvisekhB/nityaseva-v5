import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let activeReviewId = null;
let activeSeniorId = null;
let activeDocWO = null;

async function init() {
  currentProfile = await requireAuth('doctor');
  if (!currentProfile) return;

  const userDisplay = document.getElementById('user-display');
  if (userDisplay) {
    userDisplay.textContent = currentProfile.full_name || 'Dr. Practitioner';
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', signOut);
  }

  wireWorkspaceActions();
  await loadDoctorQueue();
}

async function loadDoctorQueue() {
  try {
    const data = await callApi('getDoctorDashboard', {
      doctorId: currentProfile.doctor_id || currentProfile.id
    });

    renderReviewQueue(data.queue || []);
    renderWorkOrders(data.workOrders || []);
  } catch (err) {
    alert('Error loading doctor queue: ' + err.message);
  }
}

function renderReviewQueue(queue) {
  const tbody = document.querySelector('#doctor-queue-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (queue.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No pending clinical escalations in queue.</td></tr>';
    return;
  }

  queue.forEach(q => {
    const badgeColor = q.priority === 'EMERGENCY'
      ? 'badge-red'
      : (q.priority === 'URGENT' ? 'badge-yellow' : 'badge-blue');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${q.review_id}</strong></td>
      <td><code>${q.senior_id}</code></td>
      <td><span class="badge ${badgeColor}">${q.priority}</span></td>
      <td>${q.reason || 'Clinical Review'}</td>
      <td><button class="review-btn" data-id="${q.review_id}" data-senior="${q.senior_id}">Open Review</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.review-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      activeReviewId = e.target.getAttribute('data-id');
      const seniorId = e.target.getAttribute('data-senior');
      await openClinicalWorkspace(seniorId, null);
    });
  });
}

function renderWorkOrders(orders) {
  const tbody = document.querySelector('#doctor-wo-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No doctor consultations assigned yet.</td></tr>';
    return;
  }

  orders.forEach(wo => {
    const tr = document.createElement('tr');
    const badgeColor = wo.status === 'COMPLETE'
      ? 'badge-green'
      : (wo.status === 'IN_PROGRESS' ? 'badge-yellow' : 'badge-blue');

    let displayTime = wo.created_at || '-';
    try {
      if (wo.created_at) {
        displayTime = new Date(wo.created_at).toLocaleString('en-IN', {
          dateStyle: 'short',
          timeStyle: 'short'
        });
      }
    } catch (e) {}

    tr.innerHTML = `
      <td><strong>${wo.work_order_id}</strong></td>
      <td><code>${wo.senior_id}</code></td>
      <td>${displayTime}</td>
      <td><span class="badge ${badgeColor}">${wo.status}</span></td>
      <td><button class="open-doc-wo-btn" data-id="${wo.work_order_id}">Open Workspace</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.open-doc-wo-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const woId = e.target.getAttribute('data-id');
      const match = orders.find(w => w.work_order_id === woId);
      if (match) {
        await openClinicalWorkspace(match.senior_id, match);
      }
    });
  });
}

async function openClinicalWorkspace(seniorId, workOrder) {
  activeSeniorId = seniorId;
  activeDocWO = workOrder;

  const workspace = document.getElementById('doctor-wo-workspace');
  if (!workspace) return;
  workspace.classList.remove('hidden');

  const woIdEl = document.getElementById('doc-active-wo-id');
  const seniorEl = document.getElementById('doc-active-senior');
  const statusEl = document.getElementById('doc-active-status');

  if (woIdEl) woIdEl.textContent = workOrder ? workOrder.work_order_id : (activeReviewId || 'Escalation Review');
  if (seniorEl) seniorEl.textContent = seniorId;
  if (statusEl) {
    const st = workOrder ? workOrder.status : 'IN_REVIEW';
    statusEl.textContent = st;
    statusEl.className = 'badge ' + (st === 'COMPLETE' ? 'badge-green' : 'badge-yellow');
  }

  // Work Order verification steps
  const startStep = document.getElementById('doc-start-step');
  const endStep = document.getElementById('doc-end-step');

  if (workOrder) {
    if (workOrder.status === 'IN_PROGRESS') {
      if (startStep) startStep.classList.add('hidden');
      if (endStep) endStep.classList.remove('hidden');
    } else if (workOrder.status === 'COMPLETE' || workOrder.status === 'CLOSE') {
      if (startStep) startStep.classList.add('hidden');
      if (endStep) endStep.classList.add('hidden');
    } else {
      if (startStep) startStep.classList.remove('hidden');
      if (endStep) endStep.classList.add('hidden');
    }
  } else {
    // Pure escalation review
    if (startStep) startStep.classList.add('hidden');
    if (endStep) endStep.classList.add('hidden');
  }

  workspace.scrollIntoView({ behavior: 'smooth' });

  // Load Patient Clinical Summary: Nurse Vitals + Care Journal
  await loadPatientClinicalSummary(seniorId);
}

async function loadPatientClinicalSummary(seniorId) {
  const vitalsContainer = document.getElementById('doc-vitals-container');
  const reportDateEl = document.getElementById('nurse-report-date');
  const nurseNotesEl = document.getElementById('doc-nurse-notes');
  const stream = document.getElementById('doc-timeline-stream');

  if (vitalsContainer) vitalsContainer.innerHTML = '<div>Loading latest nurse report...</div>';
  if (stream) stream.innerHTML = '<div>Loading care history...</div>';

  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId: seniorId });

    // 1. Render Latest Nurse Report
    const v = summary.latestAssessment;
    if (v && vitalsContainer) {
      if (reportDateEl) {
        const d = v.created_at ? new Date(v.created_at).toLocaleString('en-IN') : 'Recent';
        reportDateEl.textContent = `Recorded by Nurse on: ${d} | Visit ID: ${v.visit_id || '--'}`;
      }

      vitalsContainer.innerHTML = `
        <div class="vital-tile">
          <div class="vital-val">${v.bp_systolic || '--'}/${v.bp_diastolic || '--'}</div>
          <div class="vital-lbl">BP (mmHg) ${v.bp_timestamp ? '@ ' + v.bp_timestamp : ''}</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.heart_rate || '--'}</div>
          <div class="vital-lbl">Pulse (bpm)</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.spo2 || '--'}%</div>
          <div class="vital-lbl">SpO2</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.temperature || '--'}°${v.temperature_unit || 'C'}</div>
          <div class="vital-lbl">Temperature</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.glucose_random || v.glucose_fasting || '--'}</div>
          <div class="vital-lbl">Blood Sugar (mg/dL)</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.bmi || '--'}</div>
          <div class="vital-lbl">BMI (${v.weight || '--'} kg)</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.pain_level || 0}/10</div>
          <div class="vital-lbl">Pain Score</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.level_of_consciousness || 'Alert'}</div>
          <div class="vital-lbl">Consciousness</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.fall_risk || 'Low'}</div>
          <div class="vital-lbl">Fall Risk</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.edema_severity || 'None'}</div>
          <div class="vital-lbl">Edema</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.hydration_status || 'Normal'}</div>
          <div class="vital-lbl">Hydration</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${v.medication_adherence || 'Good'}</div>
          <div class="vital-lbl">Med Adherence</div>
        </div>
      `;

      if (nurseNotesEl) {
        nurseNotesEl.textContent = v.nurse_notes || 'No specific nurse notes recorded for this visit.';
      }
    } else if (vitalsContainer) {
      if (reportDateEl) reportDateEl.textContent = '';
      vitalsContainer.innerHTML = '<p style="color:#718096;">No nurse assessments recorded for this senior yet.</p>';
      if (nurseNotesEl) nurseNotesEl.textContent = 'None';
    }

    // 2. Render Care Journal Chat Stream
    if (stream) {
      stream.innerHTML = '';
      const timeline = (summary.careJournal && summary.careJournal.timeline) || [];

      if (timeline.length === 0) {
        stream.innerHTML = '<p style="color:#718096;font-size:13px;">No history recorded in care journal.</p>';
        return;
      }

      timeline.forEach(evt => {
        const div = document.createElement('div');
        let roleClass = 'chat-nurse';
        let icon = '👩‍⚕️';
        if (evt.senderRole === 'doctor') { roleClass = 'chat-doctor'; icon = '🩺'; }
        if (evt.senderRole === 'family') { roleClass = 'chat-family'; icon = '👨‍👩‍👦'; }

        div.className = `chat-bubble ${roleClass}`;
        div.innerHTML = `
          <div class="chat-icon">${icon}</div>
          <div style="flex:1;">
            <div class="chat-meta">
              <span><strong>${evt.sender} Says:</strong></span>
              <span>${evt.date}</span>
            </div>
            <div class="chat-title">${evt.title}</div>
            <div class="chat-text">${evt.message}</div>
            ${evt.flagged ? `<div class="alert-tag">⚠ Flagged for Review: ${evt.flagReasons || 'Abnormal vitals'}</div>` : ''}
          </div>
        `;
        stream.appendChild(div);
      });

      stream.scrollTop = stream.scrollHeight;
    }

  } catch (err) {
    if (vitalsContainer) vitalsContainer.innerHTML = `<div style="color:red;">Error loading clinical summary: ${err.message}</div>`;
    if (stream) stream.innerHTML = `<div style="color:red;">Error loading care journal: ${err.message}</div>`;
  }
}

function wireWorkspaceActions() {
  // 1. Verify Start Code (Teleconsult start)
  const btnStart = document.getElementById('doc-btn-verify-start');
  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      const codeInput = document.getElementById('doc-input-start-code');
      const code = codeInput ? codeInput.value.trim() : '';
      if (!code) return alert('Please enter the Start Code provided by the patient.');

      try {
        const res = await callApi('verifyStartCode', {
          workOrderId: activeDocWO.work_order_id,
          code: code
        });

        if (res.success) {
          alert('Start Code Verified! Consultation is now IN_PROGRESS.');
          activeDocWO.status = 'IN_PROGRESS';

          const startStep = document.getElementById('doc-start-step');
          const endStep = document.getElementById('doc-end-step');
          const statusEl = document.getElementById('doc-active-status');

          if (startStep) startStep.classList.add('hidden');
          if (endStep) endStep.classList.remove('hidden');
          if (statusEl) {
            statusEl.textContent = 'IN_PROGRESS';
            statusEl.className = 'badge badge-yellow';
          }

          await loadDoctorQueue();
        } else {
          alert(res.error || 'Invalid Start Code');
        }
      } catch (err) {
        alert('Verification error: ' + err.message);
      }
    });
  }

  // 2. Submit Doctor Feedback / Advice
  const formFeedback = document.getElementById('doc-consult-feedback-form');
  if (formFeedback) {
    formFeedback.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await callApi('saveDoctorFeedback', {
          reviewId: activeReviewId || '',
          workOrderId: activeDocWO ? activeDocWO.work_order_id : '',
          seniorId: activeSeniorId,
          clinicalSummary: document.getElementById('doc-consult-summary').value.trim(),
          observations: document.getElementById('doc-consult-obs').value.trim(),
          advice: document.getElementById('doc-consult-advice').value.trim(),
          investigationRecommendation: document.getElementById('doc-consult-inv').value.trim(),
          followUpRequired: !!document.getElementById('doc-consult-followup').value,
          followUpDate: document.getElementById('doc-consult-followup').value,
          priority: 'ROUTINE'
        });

        alert('Clinical advice saved successfully to the patient Care Journal!');
        formFeedback.reset();

        // Refresh care journal timeline in place so the doctor sees their new entry
        await loadPatientClinicalSummary(activeSeniorId);

        // If in Work Order mode, ensure the End Code section is visible
        const endStep = document.getElementById('doc-end-step');
        if (activeDocWO && endStep) {
          endStep.classList.remove('hidden');
        }

        await loadDoctorQueue();
      } catch (err) {
        alert('Failed to save advice: ' + err.message);
      }
    });
  }

  // 3. Verify End Code (Consultation completion)
  const btnEnd = document.getElementById('doc-btn-verify-end');
  if (btnEnd) {
    btnEnd.addEventListener('click', async () => {
      const codeInput = document.getElementById('doc-input-end-code');
      const code = codeInput ? codeInput.value.trim() : '';
      if (!code) return alert('Please enter the End Code provided by the patient to complete the consultation.');

      try {
        const res = await callApi('verifyEndCode', {
          workOrderId: activeDocWO.work_order_id,
          code: code
        });

        if (res.success) {
          alert('End Code Verified! Doctor Consultation marked COMPLETE. Journey concluded.');
          const workspace = document.getElementById('doctor-wo-workspace');
          if (workspace) workspace.classList.add('hidden');
          await loadDoctorQueue();
        } else {
          alert(res.error || 'Invalid End Code');
        }
      } catch (err) {
        alert('Completion error: ' + err.message);
      }
    });
  }
}

init();
