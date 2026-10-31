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
async function getDeviceLocation() {
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
// LOAD NURSE DASHBOARD
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
    container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-size:13px; padding:20px 0;">No visits assigned today. 🎉</p>';
    return;
    // Inside renderRouteList() map function:
return `
  <div class="visit-card-item" data-id="${wo.work_order_id}">
    <div class="visit-card-top">
      <span class="visit-senior-name">${wo.senior_name}</span>
      <span class="status-badge ${badgeClass}">${wo.status}</span>
    </div>
    <div class="visit-meta-row">📍 ${wo.senior_address}</div>
    <div class="visit-meta-row">📞 <a href="tel:${wo.senior_phone}">${wo.senior_phone}</a> | 🚨 ICE: ${wo.senior_emergency}</div>
    <div class="visit-meta-row">🆔 ${wo.work_order_id}</div>
  </div>
`;
  }

  const priority = { 'IN_PROGRESS': 0, 'SCHEDULED': 1, 'UNSCHEDULED': 1, 'COMPLETE': 2 };
  const sorted = [...allWorkOrders].sort((a, b) => (priority[String(a.status).toUpperCase()] ?? 3) - (priority[String(b.status).toUpperCase()] ?? 3));

  container.innerHTML = sorted.map(wo => {
    const st = String(wo.status || '').toUpperCase();
    const badgeClass = st === 'IN_PROGRESS' ? 'badge-in_progress' : (st === 'COMPLETE' ? 'badge-complete' : 'badge-scheduled');
    return `
      <div class="visit-card-item" data-id="${wo.work_order_id}">
        <div class="visit-card-top">
          <span class="visit-senior-name">${wo.senior_name || wo.senior_id}</span>
          <span class="status-badge ${badgeClass}">${wo.status}</span>
        </div>
        <div class="visit-meta-row">🆔 ${wo.work_order_id}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.visit-card-item').forEach(card => {
    card.addEventListener('click', () => {
      const match = allWorkOrders.find(w => w.work_order_id === card.getAttribute('data-id'));
      if (match) openVisitFlow(match);
    });
  });
}

function openVisitFlow(wo) {
  activeWO = wo;
  const st = String(wo.status || '').toUpperCase();
  if (st === 'COMPLETE' || st === 'CLOSE') {
    alert(`✅ Visit for ${wo.senior_name || wo.senior_id} is already complete.`);
    return;
  }
  st === 'IN_PROGRESS' ? openCockpit(wo) : openStartVisitSheet(wo);
}

// -------------------------------------------------------------
// WORKFLOWS: OTP & COCKPIT
// -------------------------------------------------------------
function openStartVisitSheet(wo) {
  setText('start-sheet-senior-name', wo.senior_name || wo.senior_id);
  show('start-visit-overlay');
}

function setupStartVisitFlow() {
  document.getElementById('btn-verify-start')?.addEventListener('click', async () => {
    const code = document.getElementById('input-start-code')?.value.trim().replace(/\D/g, '');
    if (!code || code.length !== 6) return alert('Please enter a valid 6-digit numeric Start Code.');
    
    try {
      const geo = await getDeviceLocation();
      const res = await callApi('verifyStartCode', { workOrderId: activeWO.work_order_id, code, geo });
      if (res.success) {
        activeWO.status = 'IN_PROGRESS';
        hide('start-visit-overlay');
        openCockpit(activeWO);
        await loadNurseWorkOrders();
      } else { alert(res.error); }
    } catch (err) { alert(err.message); }
  });
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
  document.getElementById('btn-open-assessment')?.addEventListener('click', () => show('assessment-overlay'));
  document.getElementById('btn-doctor-options')?.addEventListener('click', () => show('doctor-overlay'));
  
  // FIXED END CODE BUTTON: Strictly gated by isVitalsSavedForActiveWO
  document.getElementById('btn-open-end-code')?.addEventListener('click', () => {
    if (!isVitalsSavedForActiveWO) {
      alert('⚠️ Mandatory: Submit 20-Point Vitals Assessment first.');
      show('assessment-overlay');
      return;
    }
    show('end-visit-overlay');
  });
}

// -------------------------------------------------------------
// ASSESSMENT & SOS
// -------------------------------------------------------------
function setupAssessmentForm() {
  document.getElementById('assessment-form')?.addEventListener('submit', async (e) => {
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
  });
}

function setupSosHandlers() {
  const btnTrigger = document.getElementById('btn-sos-trigger');
  const btnConfirm = document.getElementById('btn-confirm-sos');
  if (btnTrigger) btnTrigger.addEventListener('click', () => show('sos-modal'));
  if (btnConfirm) btnConfirm.addEventListener('click', async () => {
    const geo = await getDeviceLocation();
    await callApi('createDoctorReviewRequest', {
        seniorId: activeWO ? activeWO.senior_id : 'UNKNOWN',
        reason: `🚨 EMERGENCY SOS. Location: ${geo ? geo.lat + ',' + geo.lng : 'Unknown'}`,
        priority: 'EMERGENCY'
    });
    alert('SOS Sent!');
    hide('sos-modal');
  });
}

function setupEndVisitFlow() {
  document.getElementById('btn-verify-end')?.addEventListener('click', async () => {
    const code = document.getElementById('input-end-code').value.replace(/\D/g, '');
    try {
      const res = await callApi('verifyEndCode', { workOrderId: activeWO.work_order_id, code });
      if (res.success) {
        clearInterval(timerInterval);
        alert('Visit Complete');
        hide('end-visit-overlay');
        hide('cockpit-overlay');
        init();
      }
    } catch (err) { alert(err.message); }
  });
}

function setupModalCloseButtons() {
  ['start', 'cockpit', 'assessment', 'doctor', 'end', 'sos'].forEach(id => {
    document.getElementById(`btn-close-${id === 'start' ? 'start-sheet' : id === 'cockpit' ? 'cockpit' : id === 'assessment' ? 'assessment' : id === 'doctor' ? 'doctor' : id === 'end' ? 'end-sheet' : 'sos'}`)
      ?.addEventListener('click', () => hide(id + (id === 'sos' ? '-modal' : '-overlay')));
  });
}

function setupAssessmentBmi() { /* ... existing logic ... */ }
function setupDoctorOptions() { /* ... existing logic ... */ }

init();
