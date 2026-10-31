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
      } catch (err) { console.warn('Photo sync failed'); }
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
        <div class="visit-meta-row">🆔 ${wo.work_order_id}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.visit-card-item').forEach(card => {
    card.onclick = () => {
      const match = allWorkOrders.find(w => w.work_order_id === card.getAttribute('data-id'));
      if (match) openVisitFlow(match);
    };
  });
}

// -------------------------------------------------------------
// WORKFLOWS: OTP, COCKPIT, ASSESSMENT, SOS
// -------------------------------------------------------------
function openVisitFlow(wo) {
  activeWO = wo;
  const st = String(wo.status || '').toUpperCase();
  if (st === 'COMPLETE') return alert('Already completed.');
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
  document.getElementById('btn-open-assessment')?.onclick = () => show('assessment-overlay');
  document.getElementById('btn-doctor-options')?.onclick = () => show('doctor-overlay');
  document.getElementById('btn-open-end-code')?.onclick = () => {
    if (!isVitalsSavedForActiveWO) {
      alert('⚠️ Mandatory: Submit 20-Point Vitals Assessment first.');
      show('assessment-overlay');
      return;
    }
    show('end-visit-overlay');
  };
}

function setupAssessmentForm() {
  document.getElementById('assessment-form')?.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const geo = await getDeviceLocation();
      const payload = {
        senior_id: activeWO.senior_id,
        visit_id: activeWO.work_order_id,
        bp: `${document.getElementById('asm-bp-sys').value}/${document.getElementById('asm-bp-dia').value}`,
        heart_rate: Number(document.getElementById('asm-hr').value),
        spo2: Number(document.getElementById('asm-spo2').value),
        nurse_notes: document.getElementById('asm-notes').value,
        geo_location: geo ? `${geo.lat},${geo.lng}` : ''
      };
      await callApi('saveAssessment', payload);
      isVitalsSavedForActiveWO = true;
      alert('Assessment Saved!');
      hide('assessment-overlay');
    } catch (err) { alert(err.message); }
  };
}

function setupEndVisitFlow() {
  document.getElementById('btn-verify-end')?.onclick = async () => {
    const code = document.getElementById('input-end-code').value.replace(/\D/g, '');
    if (code.length !== 6) return alert('Enter 6-digit code');
    try {
      const res = await callApi('verifyEndCode', { workOrderId: activeWO.work_order_id, code });
      if (res.success) {
        clearInterval(timerInterval);
        hide('end-visit-overlay'); hide('cockpit-overlay');
        await loadNurseWorkOrders();
      }
    } catch (err) { alert(err.message); }
  };
}

function setupModalCloseButtons() {
  ['start', 'cockpit', 'assessment', 'doctor', 'end', 'sos'].forEach(id => {
    const btn = document.getElementById(`btn-close-${id === 'start' ? 'start-sheet' : id === 'end' ? 'end-sheet' : id}`);
    btn?.addEventListener('click', () => hide(id + (id === 'sos' ? '-modal' : '-overlay')));
  });
}

function setupSosHandlers() {
  document.getElementById('btn-sos-trigger')?.onclick = () => show('sos-modal');
  document.getElementById('btn-floating-sos')?.onclick = () => show('sos-modal');
  document.getElementById('btn-cancel-sos')?.onclick = () => hide('sos-modal');
  document.getElementById('btn-confirm-sos')?.onclick = async () => {
    const geo = await getDeviceLocation();
    await callApi('createDoctorReviewRequest', {
      seniorId: activeWO?.senior_id,
      reason: `🚨 NURSE SOS. GPS: ${geo ? geo.lat + ',' + geo.lng : 'Unknown'}`,
      priority: 'EMERGENCY'
    });
    alert('SOS Alert Sent!');
    hide('sos-modal');
  };
}

function setupAssessmentBmi() { /* ... */ }
function setupDoctorOptions() { /* ... */ }

init();
