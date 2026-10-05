import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let activeReviewId = null;
let activeSeniorId = null;
let activeDocWO = null;

async function init() {
  currentProfile = await requireAuth('doctor');
  if (!currentProfile) return;

  document.getElementById('user-display').textContent = currentProfile.full_name || 'Dr. Practitioner';
  document.getElementById('btn-logout').addEventListener('click', signOut);

  await loadDoctorQueue();
}

async function loadDoctorQueue() {
  try {
    const data = await callApi('getDoctorDashboard', { doctorId: currentProfile.doctor_id || currentProfile.id });

    renderReviewQueue(data.queue || []);
    renderWorkOrders(data.workOrders || []);

  } catch (err) {
    alert('Error loading queue: ' + err.message);
  }
}

function renderReviewQueue(queue) {
  const tbody = document.querySelector('#doctor-queue-table tbody');
  tbody.innerHTML = '';

  if (queue.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No pending doctor escalations in queue.</td></tr>';
    return;
  }

  queue.forEach(q => {
    const badgeColor = q.priority === 'EMERGENCY' ? 'badge-red' : (q.priority === 'URGENT' ? 'badge-yellow' : 'badge-blue');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${q.review_id}</strong></td>
      <td>${q.senior_id}</td>
      <td><span class="badge ${badgeColor}">${q.priority}</span></td>
      <td>${q.reason || 'Routine review'}</td>
      <td><button class="review-btn" data-id="${q.review_id}" data-senior="${q.senior_id}">Consult</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.review-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      activeReviewId = e.target.getAttribute('data-id');
      activeSeniorId = e.target.getAttribute('data-senior');
      document.getElementById('feedback-panel').classList.remove('hidden');
      document.getElementById('current-senior-title').textContent = activeSeniorId + ' (' + activeReviewId + ')';
      document.getElementById('feedback-panel').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

function renderWorkOrders(orders) {
  const tbody = document.querySelector('#doctor-wo-table tbody');
  tbody.innerHTML = '';

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No doctor consultation work orders assigned yet.</td></tr>';
    return;
  }

  orders.forEach(wo => {
    const tr = document.createElement('tr');
    const badgeColor = wo.status === 'COMPLETE' ? 'badge-green' : (wo.status === 'IN_PROGRESS' ? 'badge-yellow' : 'badge-blue');

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
      <td><span class="badge ${badgeColor}">${wo.status}</span></td>
      <td><button class="open-doc-wo-btn" data-id="${wo.work_order_id}">Open</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('.open-doc-wo-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const match = orders.find(w => w.work_order_id === id);
      if (match) openDoctorWorkspace(match);
    });
  });
}

function openDoctorWorkspace(wo) {
  activeDocWO = wo;
  const workspace = document.getElementById('doctor-wo-workspace');
  workspace.classList.remove('hidden');

  document.getElementById('doc-active-wo-id').textContent = wo.work_order_id;
  document.getElementById('doc-active-senior').textContent = wo.senior_id;

  const startStep = document.getElementById('doc-start-step');
  const endStep = document.getElementById('doc-end-step');

  if (wo.status === 'IN_PROGRESS') {
    startStep.classList.add('hidden');
    endStep.classList.remove('hidden');
  } else {
    startStep.classList.remove('hidden');
    endStep.classList.add('hidden');
  }

  workspace.scrollIntoView({ behavior: 'smooth' });
}

document.getElementById('doc-btn-verify-start').addEventListener('click', async () => {
  const code = document.getElementById('doc-input-start-code').value.trim();
  if (!code) return alert('Please enter the Start Code.');

  try {
    const res = await callApi('verifyStartCode', { workOrderId: activeDocWO.work_order_id, code: code });
    if (res.success) {
      alert('Start Code Verified! Consultation is now IN_PROGRESS.');
      activeDocWO.status = 'IN_PROGRESS';
      openDoctorWorkspace(activeDocWO);
      await loadDoctorQueue();
    } else {
      alert(res.error || 'Invalid Start Code');
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('doc-btn-verify-end').addEventListener('click', async () => {
  const code = document.getElementById('doc-input-end-code').value.trim();
  if (!code) return alert('Please enter the End Code.');

  try {
    const res = await callApi('verifyEndCode', { workOrderId: activeDocWO.work_order_id, code: code });
    if (res.success) {
      alert('End Code Verified! Consultation COMPLETE.');
      document.getElementById('doctor-wo-workspace').classList.add('hidden');
      await loadDoctorQueue();
    } else {
      alert(res.error || 'Invalid End Code');
    }
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('doctor-feedback-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await callApi('saveDoctorFeedback', {
      reviewId: activeReviewId,
      seniorId: activeSeniorId,
      clinicalSummary: document.getElementById('doc-summary').value,
      observations: document.getElementById('doc-obs').value,
      advice: document.getElementById('doc-advice').value,
      investigationRecommendation: document.getElementById('doc-inv').value,
      followUpRequired: !!document.getElementById('doc-followup').value,
      followUpDate: document.getElementById('doc-followup').value
    });

    alert('Clinical feedback submitted and review closed successfully!');
    document.getElementById('feedback-panel').classList.add('hidden');
    loadDoctorQueue();
  } catch (err) {
    alert('Failed to save feedback: ' + err.message);
  }
});

init();
