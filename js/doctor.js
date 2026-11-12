import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allWorkOrders = [];
let allQueue = [];
let activeSeniorId = null;
let activeDocWO = null;
let activeReviewId = null;

let activeTab = 'PENDING'; // 'PENDING' | 'COMPLETE' | 'QUEUE'
let currentAssessments = [];
let selectedAssessmentIndex = 0;
let showAllReportChips = false;

let timerInterval = null;
let visitStartTime = null;

// -------------------------------------------------------------
// SAFE DOM HELPERS
// -------------------------------------------------------------
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

async function init() {
  currentProfile = await requireAuth('doctor');
  if (!currentProfile) return;

  setText('user-display', currentProfile.full_name || 'Dr. Physician');
  setText('doc-id-display', currentProfile.doctor_id || currentProfile.userId || 'DOC-XXXX');

  document.getElementById('btn-logout')?.addEventListener('click', signOut);

  setupSubTabs();
  setupModalDismissals();
  wireWorkspaceActions();

  await loadDoctorDashboard();
}

// -------------------------------------------------------------
// 3-WAY SUB-TAB SLICER
// -------------------------------------------------------------
function setupSubTabs() {
  const btnPending = document.getElementById('tab-btn-pending');
  const btnComplete = document.getElementById('tab-btn-complete');
  const btnQueue = document.getElementById('tab-btn-queue');

  const vPending = document.getElementById('view-pending');
  const vComplete = document.getElementById('view-complete');
  const vQueue = document.getElementById('view-queue');

  function resetTabs() {
    [btnPending, btnComplete, btnQueue].forEach(b => b?.classList.remove('active'));
    [vPending, vComplete, vQueue].forEach(v => v?.classList.add('hidden'));
  }

  btnPending?.addEventListener('click', () => {
    resetTabs();
    activeTab = 'PENDING';
    btnPending.classList.add('active');
    vPending.classList.remove('hidden');
    renderWorkOrders();
  });

  btnComplete?.addEventListener('click', () => {
    resetTabs();
    activeTab = 'COMPLETE';
    btnComplete.classList.add('active');
    vComplete.classList.remove('hidden');
    renderWorkOrders();
  });

  btnQueue?.addEventListener('click', () => {
    resetTabs();
    activeTab = 'QUEUE';
    btnQueue.classList.add('active');
    vQueue.classList.remove('hidden');
    renderQueueList();
  });
}

function setupModalDismissals() {
  document.getElementById('btn-close-start-sheet')?.addEventListener('click', () => hide('start-consult-overlay'));
  document.getElementById('btn-close-cockpit')?.addEventListener('click', () => {
    stopLiveTimer();
    hide('cockpit-overlay');
  });

  document.getElementById('btn-toggle-compare')?.addEventListener('click', () => {
    const box = document.getElementById('compare-panel-box');
    if (box) box.classList.toggle('hidden');
  });

  document.getElementById('btn-toggle-all-reports')?.addEventListener('click', () => {
    showAllReportChips = !showAllReportChips;
    setText('btn-toggle-all-reports', showAllReportChips ? 'Show 4' : 'View All');
    renderReportChips();
  });
}

// -------------------------------------------------------------
// LOAD DASHBOARD DATA
// -------------------------------------------------------------
async function loadDoctorDashboard() {
  try {
    const doctorId = currentProfile.doctor_id || currentProfile.id || '';
    const data = await callApi('getDoctorDashboard', { doctorId });

    allWorkOrders = data.workOrders || [];
    allQueue = data.queue || [];

    // Update Counts in Sub-Tabs
    const pendingCount = allWorkOrders.filter(w => {
      const st = String(w.status || '').toUpperCase();
      return st === 'SCHEDULED' || st === 'UNSCHEDULED' || st === 'IN_PROGRESS';
    }).length;

    const completeCount = allWorkOrders.filter(w => {
      const st = String(w.status || '').toUpperCase();
      return st === 'COMPLETE' || st === 'CLOSE';
    }).length;

    setText('count-pending', pendingCount);
    setText('count-complete', completeCount);
    setText('count-queue', allQueue.length);

    renderWorkOrders();
    renderQueueList();
  } catch (err) {
    alert('Dashboard load error: ' + err.message);
  }
}

// -------------------------------------------------------------
// RENDER PENDING / COMPLETED CARDS
// -------------------------------------------------------------
function renderWorkOrders() {
  const containerPending = document.getElementById('pending-list-container');
  const containerComplete = document.getElementById('complete-list-container');

  const pendingList = allWorkOrders.filter(w => {
    const st = String(w.status || '').toUpperCase();
    return st === 'SCHEDULED' || st === 'UNSCHEDULED' || st === 'IN_PROGRESS';
  });

  const completeList = allWorkOrders.filter(w => {
    const st = String(w.status || '').toUpperCase();
    return st === 'COMPLETE' || st === 'CLOSE';
  });

  setText('badge-pending-pill', `${pendingList.length} Consults`);
  setText('badge-complete-pill', `${completeList.length} Closed`);

  // Render Pending List
  if (containerPending) {
    if (pendingList.length === 0) {
      containerPending.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px 0; font-size:13px;">No active teleconsults scheduled today.</p>';
    } else {
      containerPending.innerHTML = pendingList.map(wo => {
        const st = String(wo.status || '').toUpperCase();
        const badgeClass = st === 'IN_PROGRESS' ? 'badge-in_progress' : 'badge-scheduled';
        const displayTime = wo.scheduled_at ? new Date(wo.scheduled_at).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' }) : 'Pending scheduling';

        return `
          <div class="doc-wo-item" data-id="${wo.work_order_id}" data-action="open-wo">
            <div class="doc-wo-top">
              <span class="doc-wo-name">${wo.senior_name || wo.senior_id}</span>
              <span class="status-badge ${badgeClass}">${wo.status}</span>
            </div>
            <div class="doc-wo-meta">🕐 Scheduled: ${displayTime}</div>
            <div class="doc-wo-meta">🆔 ${wo.work_order_id}</div>
          </div>
        `;
      }).join('');
    }
  }

  // Render Complete List
  if (containerComplete) {
    if (completeList.length === 0) {
      containerComplete.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px 0; font-size:13px;">No completed consultations on record.</p>';
    } else {
      containerComplete.innerHTML = completeList.map(wo => {
        const displayTime = (wo.end_verified_at || wo.updated_at || wo.created_at) ? new Date(wo.end_verified_at || wo.updated_at || wo.created_at).toLocaleString('en-IN', { dateStyle:'short', timeStyle:'short' }) : '-';

        return `
          <div class="doc-wo-item" data-id="${wo.work_order_id}" data-action="open-wo">
            <div class="doc-wo-top">
              <span class="doc-wo-name">${wo.senior_name || wo.senior_id}</span>
              <span class="status-badge badge-complete">${wo.status}</span>
            </div>
            <div class="doc-wo-meta">🏁 Concluded: ${displayTime}</div>
            <div class="doc-wo-meta">🆔 ${wo.work_order_id}</div>
          </div>
        `;
      }).join('');
    }
  }

  // Attach card click handlers
  document.querySelectorAll('[data-action="open-wo"]').forEach(card => {
    card.onclick = () => {
      const id = card.getAttribute('data-id');
      const match = allWorkOrders.find(w => w.work_order_id === id);
      if (match) openDoctorWorkflow(match);
    };
  });
}

function renderQueueList() {
  const container = document.getElementById('queue-list-container');
  if (!container) return;
  setText('badge-queue-pill', `${allQueue.length} Alerts`);

  if (allQueue.length === 0) {
    container.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px 0; font-size:13px;">No urgent escalations pending review. 🎉</p>';
    return;
  }

  container.innerHTML = allQueue.map(q => {
    const badgeClass = q.priority === 'EMERGENCY' ? 'badge-emergency' : 'badge-urgent';
    return `
      <div class="doc-wo-item" data-review-id="${q.review_id}" data-senior="${q.senior_id}" data-action="open-queue">
        <div class="doc-wo-top">
          <span class="doc-wo-name">Patient: ${q.senior_id}</span>
          <span class="status-badge ${badgeClass}">${q.priority}</span>
        </div>
        <div class="doc-wo-meta">🚨 Reason: ${q.reason || 'Clinical alert flagged'}</div>
        <div class="doc-wo-meta">🆔 Review ID: ${q.review_id}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-action="open-queue"]').forEach(card => {
    card.onclick = () => {
      activeReviewId = card.getAttribute('data-review-id');
      const seniorId = card.getAttribute('data-senior');
      openClinicalCockpit(seniorId, null);
    };
  });
}

// -------------------------------------------------------------
// WORKFLOW: START VISIT OTP vs COCKPIT
// -------------------------------------------------------------
function openDoctorWorkflow(wo) {
  activeDocWO = wo;
  activeSeniorId = wo.senior_id;
  activeReviewId = null;

  const st = String(wo.status || '').toUpperCase();
  if (st === 'IN_PROGRESS' || st === 'COMPLETE' || st === 'CLOSE') {
    openClinicalCockpit(wo.senior_id, wo);
  } else {
    // Open Start Visit Sheet to enter PIN
    setText('start-sheet-senior-name', wo.senior_name || wo.senior_id);
    const input = document.getElementById('doc-input-start-code');
    if (input) input.value = '';
    show('start-consult-overlay');
  }
}

// -------------------------------------------------------------
// CLINICAL COCKPIT (WORKSPACE)
// -------------------------------------------------------------
async function openClinicalCockpit(seniorId, workOrder) {
  activeSeniorId = seniorId;
  activeDocWO = workOrder;
  showAllReportChips = false;

  show('cockpit-overlay');

  setText('cockpit-senior-name', workOrder ? (workOrder.senior_name || seniorId) : seniorId);
  setText('cockpit-wo-id', workOrder ? `${workOrder.work_order_id} • Teleconsult` : `Escalation Review (${activeReviewId})`);

  const st = workOrder ? String(workOrder.status || '').toUpperCase() : 'IN_PROGRESS';
  setText('cockpit-badge-state', st);
  const badgeState = document.getElementById('cockpit-badge-state');
  if (badgeState) {
    badgeState.className = 'status-badge ' + (st === 'COMPLETE' || st === 'CLOSE' ? 'badge-complete' : 'badge-in_progress');
  }

  // Handle End Step Box Visibility
  const endBox = document.getElementById('doc-end-step-box');
  if (endBox) {
    if (st === 'COMPLETE' || st === 'CLOSE') endBox.classList.add('hidden');
    else endBox.classList.remove('hidden');
  }

  // Start live timer if active
  visitStartTime = (workOrder && workOrder.start_verified_at) ? new Date(workOrder.start_verified_at) : new Date();
  setText('doc-timer-started-at', 'started ' + visitStartTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  startLiveTimer();

  await loadPatientClinicalSummary(seniorId);
}

function startLiveTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - visitStartTime.getTime()) / 1000);
    setText('doc-live-timer-display', new Date(diff * 1000).toISOString().substr(11, 8));
  }, 1000);
}

function stopLiveTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// -------------------------------------------------------------
// LOAD CLINICAL SUMMARY & LAST 4 REPORTS CHIPS
// -------------------------------------------------------------
async function loadPatientClinicalSummary(seniorId) {
  const vitalsBox = document.getElementById('doc-vitals-container');
  const stream = document.getElementById('doc-timeline-stream');
  if (vitalsBox) vitalsBox.innerHTML = '<p style="color:#64748b; font-size:12px;">Loading nurse assessments...</p>';

  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId });
    if (summary.senior) {
      setText('cockpit-senior-name', summary.senior.full_name || seniorId);
    }

    currentAssessments = summary.recentAssessments || (summary.latestAssessment ? [summary.latestAssessment] : []);
    selectedAssessmentIndex = 0;

    renderReportChips();
    if (currentAssessments.length > 0) {
      renderVitalsForAssessment(currentAssessments[0]);
    } else {
      if (vitalsBox) vitalsBox.innerHTML = '<p style="color:#94a3b8; font-size:12px;">No nurse assessments recorded yet.</p>';
    }

    // Render Care Journal timeline
    renderCareJournalTimeline(summary.careJournal ? summary.careJournal.timeline : []);

  } catch (err) {
    if (vitalsBox) vitalsBox.innerHTML = `<p style="color:#dc2626; font-size:12px;">Error: ${err.message}</p>`;
  }
}

function renderReportChips() {
  const container = document.getElementById('report-chips-container');
  if (!container) return;

  if (currentAssessments.length === 0) {
    container.innerHTML = '<span style="font-size:11px; color:#94a3b8;">No historical visits</span>';
    return;
  }

  // Limit to 4 unless toggled
  const visible = showAllReportChips ? currentAssessments : currentAssessments.slice(0, 4);

  container.innerHTML = visible.map((asm, idx) => {
    const d = asm.created_at ? new Date(asm.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : `Visit ${idx + 1}`;
    return `<button class="report-chip ${idx === selectedAssessmentIndex ? 'active' : ''}" data-idx="${idx}">${d}</button>`;
  }).join('');

  container.querySelectorAll('.report-chip').forEach(chip => {
    chip.onclick = () => {
      const idx = Number(chip.getAttribute('data-idx'));
      selectedAssessmentIndex = idx;
      renderReportChips();

            renderVitalsForAssessment(currentAssessments[idx]);
    };
  });

  // Automatically update the comparison table between previous and selected
  updateCompareTable();
}

// -------------------------------------------------------------
// RENDER 20-POINT VITALS FOR SELECTED REPORT
// -------------------------------------------------------------
function renderVitalsForAssessment(v) {
  const container = document.getElementById('doc-vitals-container');
  if (!container || !v) return;

  const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
  const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
  const hr = v.heart_rate || '--';
  const spo2 = v.spo2 ? `${v.spo2}%` : '--%';
  const rr = v.respiratory_rate ? `${v.respiratory_rate}/min` : '--';
  const temp = v.temperature ? `${v.temperature}°${v.temperature_unit || 'C'}` : '--';
  const sugar = v.glucose_random || v.glucose_fasting || v.blood_sugar || '--';
  const wt = v.weight ? `${v.weight} kg` : '--';
  const bmi = v.bmi || '--';
  const pain = (v.pain_level !== undefined && v.pain_level !== '') ? `${v.pain_level}/10` : '0/10';
  const loc = v.level_of_consciousness || 'Alert';
  const fall = v.fall_risk || 'Low';
  const mobility = v.mobility_status || 'Independent';

  container.innerHTML = `
    <div class="vital-tile"><div class="vital-val">${sys}/${dia}</div><div class="vital-lbl">Blood Pressure</div></div>
    <div class="vital-tile"><div class="vital-val">${hr}</div><div class="vital-lbl">Heart Rate</div></div>
    <div class="vital-tile"><div class="vital-val">${spo2}</div><div class="vital-lbl">SpO₂ Oxygen</div></div>
    <div class="vital-tile"><div class="vital-val">${sugar}</div><div class="vital-lbl">Blood Glucose</div></div>
    <div class="vital-tile"><div class="vital-val">${temp}</div><div class="vital-lbl">Temperature</div></div>
    <div class="vital-tile"><div class="vital-val">${rr}</div><div class="vital-lbl">Resp Rate</div></div>
    <div class="vital-tile"><div class="vital-val">${wt}</div><div class="vital-lbl">Weight (${bmi} BMI)</div></div>
    <div class="vital-tile"><div class="vital-val">${pain}</div><div class="vital-lbl">Pain Level</div></div>
    <div class="vital-tile"><div class="vital-val">${loc}</div><div class="vital-lbl">Consciousness</div></div>
    <div class="vital-tile"><div class="vital-val">${fall}</div><div class="vital-lbl">Fall Risk</div></div>
    <div class="vital-tile"><div class="vital-val" style="font-size:14px;">${mobility}</div><div class="vital-lbl">Mobility</div></div>
    <div class="vital-tile"><div class="vital-val" style="font-size:14px;">${v.hydration_status || 'Normal'}</div><div class="vital-lbl">Hydration</div></div>
  `;

  setText('doc-nurse-notes', v.nurse_notes || 'No specific notes recorded for this visit.');
}

// -------------------------------------------------------------
// LIVE COMPARE TABLE (Previous vs Selected Assessment)
// -------------------------------------------------------------
function updateCompareTable() {
  const tbody = document.getElementById('compare-tbody');
  if (!tbody) return;

  const curr = currentAssessments[selectedAssessmentIndex];
  // Previous is the next item in the chronological reverse list
  const prev = currentAssessments[selectedAssessmentIndex + 1];

  if (!curr || !prev) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:8px;">Need at least 2 visits to calculate comparison delta.</td></tr>';
    setText('cmp-label-prev', 'Prev');
    setText('cmp-label-curr', 'Current');
    return;
  }

  const dPrev = prev.created_at ? new Date(prev.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : 'Prev';
  const dCurr = curr.created_at ? new Date(curr.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : 'Current';
  setText('cmp-label-prev', dPrev);
  setText('cmp-label-curr', dCurr);

  const metrics = [
    {
      name: 'Blood Pressure',
      prev: `${prev.bp_systolic || '--'}/${prev.bp_diastolic || '--'}`,
      curr: `${curr.bp_systolic || '--'}/${curr.bp_diastolic || '--'}`,
      delta: () => {
        const sOld = Number(prev.bp_systolic || (prev.bp ? prev.bp.split('/')[0] : 0));
        const sNew = Number(curr.bp_systolic || (curr.bp ? curr.bp.split('/')[0] : 0));
        if (!sOld || !sNew) return { txt: 'Recorded', cls: 'trend-improved' };
        const d = sNew - sOld;
        return d === 0 ? { txt: 'Stable (0)', cls: 'trend-improved' } : (d > 0 ? { txt: `+${d} mmHg`, cls: 'trend-caution' } : { txt: `${d} mmHg`, cls: 'trend-improved' });
      }
    },
    {
      name: 'Heart Rate',
      prev: prev.heart_rate ? `${prev.heart_rate} bpm` : '--',
      curr: curr.heart_rate ? `${curr.heart_rate} bpm` : '--',
      delta: () => {
        const hOld = Number(prev.heart_rate || 0);
        const hNew = Number(curr.heart_rate || 0);
        if (!hOld || !hNew) return { txt: '--', cls: 'trend-improved' };
        const d = hNew - hOld;
        return { txt: `${d > 0 ? '+' : ''}${d} bpm`, cls: Math.abs(d) > 15 ? 'trend-caution' : 'trend-improved' };
      }
    },
    {
      name: 'SpO₂ Oxygen',
      prev: prev.spo2 ? `${prev.spo2}%` : '--',
      curr: curr.spo2 ? `${curr.spo2}%` : '--',
      delta: () => {
        const sOld = Number(prev.spo2 || 0);
        const sNew = Number(curr.spo2 || 0);
        if (!sOld || !sNew) return { txt: '--', cls: 'trend-improved' };
        const d = sNew - sOld;
        return { txt: `${d >= 0 ? '+' : ''}${d}%`, cls: d < 0 ? 'trend-caution' : 'trend-improved' };
      }
    },
    {
      name: 'Blood Sugar',
      prev: (prev.glucose_random || prev.glucose_fasting || prev.blood_sugar) ? `${prev.glucose_random || prev.glucose_fasting || prev.blood_sugar} mg/dL` : '--',
      curr: (curr.glucose_random || curr.glucose_fasting || curr.blood_sugar) ? `${curr.glucose_random || curr.glucose_fasting || curr.blood_sugar} mg/dL` : '--',
      delta: () => {
        const gOld = Number(prev.glucose_random || prev.glucose_fasting || prev.blood_sugar || 0);
        const gNew = Number(curr.glucose_random || curr.glucose_fasting || curr.blood_sugar || 0);
        if (!gOld || !gNew) return { txt: '--', cls: 'trend-improved' };
        const d = gNew - gOld;
        return { txt: `${d > 0 ? '+' : ''}${d} mg/dL`, cls: d > 20 ? 'trend-caution' : 'trend-improved' };
      }
    },
    {
      name: 'Pain Score',
      prev: prev.pain_level !== undefined ? `${prev.pain_level}/10` : '0/10',
      curr: curr.pain_level !== undefined ? `${curr.pain_level}/10` : '0/10',
      delta: () => {
        const pOld = Number(prev.pain_level || 0);
        const pNew = Number(curr.pain_level || 0);
        const d = pNew - pOld;
        return d < 0 ? { txt: `${d} (Relief)`, cls: 'trend-improved' } : (d > 0 ? { txt: `+${d} (Up)`, cls: 'trend-caution' } : { txt: 'Stable', cls: 'trend-improved' });
      }
    }
  ];

  tbody.innerHTML = metrics.map(m => {
    const res = m.delta();
    return `
      <tr>
        <td><strong>${m.name}</strong></td>
        <td>${m.prev}</td>
        <td><strong>${m.curr}</strong></td>
        <td><span class="${res.cls}">${res.txt}</span></td>
      </tr>
    `;
  }).join('');
}

// -------------------------------------------------------------
// RENDER CARE JOURNAL STREAM
// -------------------------------------------------------------
function renderCareJournalTimeline(timeline) {
  const stream = document.getElementById('doc-timeline-stream');
  if (!stream) return;

  if (!timeline || timeline.length === 0) {
    stream.innerHTML = '<p style="color:#94a3b8; font-size:12px; text-align:center; padding:10px;">No previous journal history recorded.</p>';
    return;
  }

  stream.innerHTML = timeline.map(evt => {
    let roleClass = '';
    let icon = '👩‍⚕️';
    if (evt.senderRole === 'doctor') { roleClass = 'chat-doctor'; icon = '🩺'; }
    if (evt.senderRole === 'family') { roleClass = 'chat-family'; icon = '👨‍👩‍👦'; }

    return `
      <div class="chat-bubble ${roleClass}">
        <div style="font-size:18px;">${icon}</div>
        <div style="flex:1;">
          <div class="chat-meta">
            <span><strong>${evt.sender} Says:</strong></span>
            <span>${evt.date || ''}</span>
          </div>
          <div class="chat-title">${evt.title || ''}</div>
          <div class="chat-text">${evt.message || ''}</div>
          ${evt.flagged ? '<div class="alert-tag">⚠️ Flagged for Clinical Review</div>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// -------------------------------------------------------------
// WORKSPACE ACTION BUTTONS (Start OTP, Advice Save, End OTP)
// -------------------------------------------------------------
function wireWorkspaceActions() {
  // 1. Verify 6-digit Start Code (Teleconsult Start)
  document.getElementById('doc-btn-verify-start')?.addEventListener('click', async () => {
    const raw = document.getElementById('doc-input-start-code')?.value || '';
    const code = raw.trim().replace(/\D/g, '');

    if (!code || code.length !== 6) {
      return alert('Please enter a valid 6-digit numeric Start Code.');
    }

    const btn = document.getElementById('doc-btn-verify-start');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
      const res = await callApi('verifyStartCode', {
        workOrderId: activeDocWO.work_order_id,
        code: code
      });

      if (res.success) {
        alert('Start Code Verified! Consultation is now IN_PROGRESS.');
        activeDocWO.status = 'IN_PROGRESS';
        hide('start-consult-overlay');
        openClinicalCockpit(activeSeniorId, activeDocWO);
        await loadDoctorDashboard();
      } else {
        alert(res.error || 'Invalid Start Code');
      }
    } catch (err) {
      alert('Verification error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Authorize & Start Teleconsult';
    }
  });

  // 2. Submit Doctor Clinical Advice ("Doctor Says")
  document.getElementById('doc-consult-feedback-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving Advice...';
    }

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

      alert('✅ Clinical prescription saved to the Patient Care Journal!');
      document.getElementById('doc-consult-feedback-form').reset();

      // Refresh care journal timeline in cockpit
      await loadPatientClinicalSummary(activeSeniorId);

      // Unhide the End Code box if hidden
      const endBox = document.getElementById('doc-end-step-box');
      if (endBox) endBox.classList.remove('hidden');

      await loadDoctorDashboard();
    } catch (err) {
      alert('Failed to save advice: ' + err.message);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Save Clinical Advice to Care Journal';
      }
    }
  });

  // 3. Verify 6-digit End Code (Conclude Teleconsult)
  document.getElementById('doc-btn-verify-end')?.addEventListener('click', async () => {
    const raw = document.getElementById('doc-input-end-code')?.value || '';
    const code = raw.trim().replace(/\D/g, '');

    if (!code || code.length !== 6) {
      return alert('Please enter a valid 6-digit numeric End Code provided by the patient.');
    }

    const btn = document.getElementById('doc-btn-verify-end');
    btn.disabled = true;
    btn.textContent = 'Concluding...';

    try {
      const res = await callApi('verifyEndCode', {
        workOrderId: activeDocWO.work_order_id,
        code: code
      });

      if (res.success) {
        stopLiveTimer();
        alert('🏁 Teleconsultation Concluded & Locked Successfully.');
        hide('cockpit-overlay');
        activeDocWO = null;
        await loadDoctorDashboard();
      } else {
        alert(res.error || 'Invalid End Code');
      }
    } catch (err) {
      alert('Completion error: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify End Code & Conclude Visit';
    }
  });
}

init();
