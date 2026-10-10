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
    if (startStep) startStep.classList.add('hidden');
    if (endStep) endStep.classList.add('hidden');
  }

  workspace.scrollIntoView({ behavior: 'smooth' });

  // Load Patient Clinical Summary: All 22 Nurse Vitals + Care Journal Timeline
  await loadPatientClinicalSummary(seniorId);
}

async function loadPatientClinicalSummary(seniorId) {
  const vitalsContainer = document.getElementById('doc-vitals-container');
  const reportDateEl = document.getElementById('nurse-report-date');
  const nurseNotesEl = document.getElementById('doc-nurse-notes');
  const stream = document.getElementById('doc-timeline-stream');

  if (vitalsContainer) vitalsContainer.innerHTML = '<div>Loading complete nurse assessment...</div>';
  if (stream) stream.innerHTML = '<div>Loading care history...</div>';

  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId: seniorId });
    const v = summary.latestAssessment;

    if (v && vitalsContainer) {
      if (reportDateEl) {
        const d = v.created_at ? new Date(v.created_at).toLocaleString('en-IN') : 'Recent';
        reportDateEl.textContent = `Recorded by Nurse on: ${d} | Visit ID: ${v.visit_id || '--'}`;
      }

      // Safe field extractors
      const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
      const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
      const bpTime = v.bp_timestamp ? ` @ ${v.bp_timestamp}` : '';
      const hr = v.heart_rate || '--';
      const spo2 = v.spo2 || '--';
      const rr = v.respiratory_rate || '--';
      const tempUnit = v.temperature_unit || 'C';
      const temp = v.temperature ? `${v.temperature}°${tempUnit}` : '--';

      const fastingGluc = v.glucose_fasting ? `${v.glucose_fasting} mg/dL` : 'Not Done';
      const randomGluc = v.glucose_random || v.blood_sugar || '--';
      const glucTiming = v.glucose_timing ? ` (${v.glucose_timing})` : '';

      const wt = v.weight ? `${v.weight} kg` : '--';
      const ht = v.height ? `${v.height} cm` : '--';
      const bmiVal = v.bmi || '--';
      const waist = v.waist_circumference ? `${v.waist_circumference} cm` : 'Not Done';

      const pain = (v.pain_level !== undefined && v.pain_level !== '') ? `${v.pain_level}/10` : '0/10';
      const painLoc = v.pain_location ? ` (${v.pain_location})` : '';

      const loc = v.level_of_consciousness || 'Alert';
      const fall = v.fall_risk || 'Low';
      const mobility = v.mobility_status || v.mobility || 'Independent';

      const respSym = v.respiratory_symptoms || 'None';
      const respNotes = v.respiratory_notes ? ` (${v.respiratory_notes})` : '';

      const edema = v.edema_severity || v.edema || 'None';
      const edemaNotes = v.edema_notes ? ` (${v.edema_notes})` : '';

      const hydration = v.hydration_status || v.hydration || 'Normal';
      const meds = v.medication_adherence || 'Good';
      const medsNotes = v.medication_notes ? ` (${v.medication_notes})` : '';
      const cog = v.cognitive_observation || 'Normal';

      vitalsContainer.innerHTML = `
        <!-- Vital Signs (1-5) -->
        <div class="vital-tile">
          <div class="vital-val">${sys}/${dia}</div>
          <div class="vital-lbl">1. Blood Pressure${bpTime}</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${hr}</div>
          <div class="vital-lbl">2. Heart Rate (bpm)</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${spo2}%</div>
          <div class="vital-lbl">3. SpO₂</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${rr}</div>
          <div class="vital-lbl">4. Resp Rate (/min)</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${temp}</div>
          <div class="vital-lbl">5. Body Temperature</div>
        </div>

        <!-- Glucose (6-7) -->
        <div class="vital-tile">
          <div class="vital-val" style="font-size:17px;">${fastingGluc}</div>
          <div class="vital-lbl">6. Fasting Glucose</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:17px;">${randomGluc}</div>
          <div class="vital-lbl">7. Random Glucose${glucTiming}</div>
        </div>

        <!-- Body Measurements (8-11) -->
        <div class="vital-tile">
          <div class="vital-val">${wt}</div>
          <div class="vital-lbl">8. Weight</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${ht}</div>
          <div class="vital-lbl">9. Height</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val">${bmiVal}</div>
          <div class="vital-lbl">10. BMI (kg/m²)</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:17px;">${waist}</div>
          <div class="vital-lbl">11. Waist Circumference</div>
        </div>

        <!-- Pain & Consciousness (12-13) -->
        <div class="vital-tile">
          <div class="vital-val">${pain}</div>
          <div class="vital-lbl">12. Pain Score${painLoc}</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:17px;">${loc}</div>
          <div class="vital-lbl">13. Consciousness</div>
        </div>

        <!-- Risk & Mobility (14-15) -->
        <div class="vital-tile">
          <div class="vital-val" style="font-size:17px;">${fall}</div>
          <div class="vital-lbl">14. Fall Risk</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:16px;">${mobility}</div>
          <div class="vital-lbl">15. Mobility Status</div>
        </div>

        <!-- Symptoms & Observations (16-20) -->
        <div class="vital-tile">
          <div class="vital-val" style="font-size:16px;">${respSym}</div>
          <div class="vital-lbl">16. Resp Symptoms${respNotes}</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:16px;">${edema}</div>
          <div class="vital-lbl">17. Edema${edemaNotes}</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:16px;">${hydration}</div>
          <div class="vital-lbl">18. Hydration Status</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:16px;">${meds}</div>
          <div class="vital-lbl">19. Med Adherence${medsNotes}</div>
        </div>
        <div class="vital-tile">
          <div class="vital-val" style="font-size:16px;">${cog}</div>
          <div class="vital-lbl">20. Cognitive Observation</div>
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

        // Refresh care journal timeline in place so doctor sees their new entry
        await loadPatientClinicalSummary(activeSeniorId);

        // If in Work Order mode, show End Code section
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
