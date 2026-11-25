import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let dashboardData = {};

const storage = {
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} },
  getItem: (k) => { try { return localStorage.getItem(k); } catch(e) { return null; } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch(e) {} }
};

const OFFICE_NUMBER = "+919239258921";

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

// -------------------------------------------------------------
// INIT
// -------------------------------------------------------------
async function init() {
  try {
    currentProfile = await requireAuth('coordinator');
    if (!currentProfile) return;

    const coordinatorId = currentProfile.coordinator_id || currentProfile.userId || 'CRD-XXXX';
    setText('crd-name-display', currentProfile.full_name || 'Coordinator');
    setText('crd-id-display', coordinatorId);
    setText('crd-name-profile', currentProfile.full_name || 'Coordinator');
    setText('crd-role-profile', `Coordinator ID: ${coordinatorId}`);

    renderCoordinatorProfile(currentProfile);
    document.getElementById('btn-logout')?.addEventListener('click', signOut);
    
    setupCoordinatorAvatarUpload();
    setupSubTabs();
    setupForms();
    
    await loadCoordinatorDashboard();
  } catch (err) {
    console.error('Coordinator init failed:', err);
    showFatalError('Init Error: ' + err.message); 
  }
}

// -------------------------------------------------------------
// PROFILE LOGIC
// -------------------------------------------------------------
function renderCoordinatorProfile(profile) {
  setText('crd-age', profile.age || '--');
  setText('crd-exp', profile.experience || '--');
  setText('crd-role', profile.role || 'Care Coordinator');
  setText('crd-phone', profile.phone || '--');
  if (profile.photo_url && String(profile.photo_url).length > 20) {
    renderCoordinatorAvatar(profile.photo_url);
  }
}

function renderCoordinatorAvatar(base64) {
  if (!base64) return;
  const imgHtml = `<img src="${base64}" alt="Photo" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;">`;
  const bigAvatar = document.getElementById('btn-crd-avatar');
  const smallAvatar = document.querySelector('.crd-avatar');
  if (bigAvatar) bigAvatar.innerHTML = imgHtml;
  if (smallAvatar) smallAvatar.innerHTML = imgHtml;
}

function setupCoordinatorAvatarUpload() {
  const input = document.getElementById('crd-photo-input');
  const trigger = document.getElementById('btn-crd-avatar');
  if (!input || !trigger) return;
  trigger.onclick = () => input.click();
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 150; canvas.height = 150;
        canvas.getContext('2d').drawImage(img, 0, 0, 150, 150);
        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        renderCoordinatorAvatar(base64);
        try {
          await callApi('updateCoordinatorPhoto', { coordinatorId: currentProfile.coordinator_id, photoData: base64 });
          alert('✓ Photo saved!');
        } catch (err) { alert('Save failed: ' + err.message); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
}

// -------------------------------------------------------------
// DASHBOARD & RENDERING (ONE SINGLE DEFINITION)
// -------------------------------------------------------------
async function loadCoordinatorDashboard() {
  try {
    dashboardData = await callApi('getCoordinatorDashboard');
    const appointments = await callApi('getAppointments', {});

    const counts = dashboardData.counts || {};
    setText('stat-visits', counts.todaysVisits || 0);
    setText('stat-pending', counts.pending || 0);
    setText('stat-incidents', counts.incidents || 0);
    
    setText('morning-visits-count', (dashboardData.todaysVisits || []).length);
    setText('morning-pending-count', (dashboardData.pendingRequests || []).length);
    setText('morning-incidents-count', (dashboardData.incidents || []).length);
    setText('missed-count', (dashboardData.missedVisits || []).length);
    setText('complaints-count', (dashboardData.openComplaints || []).length);
    setText('companion-jobs-count', (dashboardData.myCompanionJobs || []).length);
    setText('hospital-count', (dashboardData.myHospitalJobs || []).length);

    renderMorningVisits(dashboardData.todaysVisits || []);
    renderPendingRequests(dashboardData.pendingRequests || []);
    renderAppointmentQueue(appointments); 
    renderIncidents(dashboardData.incidents || []);
    renderMissedVisits(dashboardData.missedVisits || []);
    renderStaffAvailability(dashboardData.staffWithLoad || []);
    renderComplaints(dashboardData.openComplaints || []);
    renderInsurance(dashboardData.insuranceFollowUps || []);
    renderCompanionJobs(dashboardData.myCompanionJobs || []);
    renderHospitalJobs(dashboardData.myHospitalJobs || []);
  } catch (err) {
    console.error('Error loading dashboard:', err);
    showFatalError('Could not reach server: ' + err.message);
  }
}

function renderAppointmentQueue(apts) {
  const container = document.getElementById('morning-pending-list');
  if (!container) return;
  const requested = apts.filter(a => a.status === 'REQUESTED');
  if (requested.length === 0) return;

  container.innerHTML += requested.map(a => `
    <div class="item-card">
      <div class="item-top">
        <span class="item-name">${a.appointment_id}</span>
        <button class="mini-btn remind-btn" data-id="${a.appointment_id}">Send Reminder</button>
      </div>
      <div class="item-meta">Senior: ${a.senior_id} | Scheduled: ${formatDateTime(a.scheduled_at)}</div>
    </div>
  `).join('');

  container.querySelectorAll('.remind-btn').forEach(btn => {
    btn.onclick = async () => {
      try {
        await callApi('sendAppointmentReminder', { appointmentId: btn.dataset.id });
        alert('Reminder sent!');
      } catch (err) { alert('Error: ' + err.message); }
    };
  });
}

function showFatalError(msg) {
  const el = document.getElementById('morning-visits-list');
  if (el) el.innerHTML = `<p style="color:#dc2626; padding:12px;">⚠️ ${msg}</p>`;
}

function setupSubTabs() {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.workflow-card').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      const target = document.getElementById('section-' + btn.getAttribute('data-section'));
      if (target) target.classList.remove('hidden');
    });
  });
}

function getSeniorLabel(v) { return v.senior_name || v.senior_id || 'Unknown Senior'; }
function getAssignedLabel(v) { return v.assigned_staff_id || v.assigned_doctor_id || v.assigned_coordinator_id || 'Unassigned'; }
function formatDateTime(val) { try { return new Date(val).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); } catch(e) { return String(val); } }

// Helper renderers
function renderMorningVisits(v) { /* ... keep your existing logic ... */ }
function renderPendingRequests(r) { /* ... keep your existing logic ... */ }
function renderIncidents(i) { /* ... keep your existing logic ... */ }
function renderMissedVisits(m) { /* ... keep your existing logic ... */ }
function renderStaffAvailability(s) { /* ... keep your existing logic ... */ }
function renderComplaints(c) { /* ... keep your existing logic ... */ }
function renderInsurance(cl) { /* ... keep your existing logic ... */ }
function renderCompanionJobs(j) { /* ... keep your existing logic ... */ }
function renderHospitalJobs(j) { /* ... keep your existing logic ... */ }
function setupForms() { /* ... keep your existing logic ... */ }

init();
