import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allWorkOrders = [];
let activeWO = null;
let timerInterval = null;
let visitStartTime = null;
let compActiveTab = 'PENDING';

const storage = {
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch(e) {} },
  getItem: (k) => { try { return localStorage.getItem(k); } catch(e) { return null; } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch(e) {} }
};

const OFFICE_NUMBER = "+919239258921"; // Update with actual office number

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

// -------------------------------------------------------------
// INIT (single, correct version — uses companion_id, not staff_id)
// -------------------------------------------------------------
async function init() {
  try {
    currentProfile = await requireAuth('companion');
    if (!currentProfile) return;

    const companionId = currentProfile.companion_id || currentProfile.userId || 'COM-XXXX';

    setText('comp-name-display', currentProfile.full_name || 'Companion');
    setText('comp-id-display', companionId);
    setText('comp-name-profile', currentProfile.full_name || 'Companion');
    setText('comp-role-profile', `ID: ${companionId}`);

    renderCompanionProfile(currentProfile);
    
    document.getElementById('btn-logout')?.addEventListener('click', signOut);
    
    setupCompanionAvatarUpload();   
    setupRouteTabs();
    setupSosHandlers();
    setupModalCloseButtons();
    setupStartVisitFlow();
    setupCockpitActions();
    setupEndVisitFlow();

    await loadCompanionWorkOrders();
  } catch (err) {
    console.error('Companion Portal Init Error:', err);
    setHTML('route-list-container', `<p style="color:#dc2626; text-align:center;">Failed to load: ${err.message}</p>`);
  }
}

async function getDeviceLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6), accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 6000 }
    );
  });
}
// -------------------------------------------------------------
// PROFILE PHOTO UPLOAD
// -------------------------------------------------------------
function setupCompanionAvatarUpload() {
  const input = document.getElementById('comp-photo-input');
  if (!input) return;

  const trigger = document.getElementById('btn-comp-avatar');
  if (trigger) {
    trigger.style.cursor = 'pointer';
    trigger.title = 'Click to upload your photo';
    trigger.onclick = () => input.click();
  }

  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const MAX = 150;
        let w = img.width, h = img.height;
        if (w > h) { if (w > MAX) { h = Math.round(h * (MAX / w)); w = MAX; } }
        else { if (h > MAX) { w = Math.round(w * (MAX / h)); h = MAX; } }
        canvas.width = w; canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const base64 = canvas.toDataURL('image/jpeg', 0.7);

        renderCompanionAvatar(base64);

        const companionId = currentProfile.companion_id || currentProfile.userId;
        if (!companionId) {
          alert('Companion ID not found. Could not save photo.');
          return;
        }

        try {
          const res = await callApi('updateCompanionPhoto', { companionId, photoData: base64 });
          if (res && res.success) {
            currentProfile.photo_url = base64;
            alert('✓ Profile photo saved successfully!');
          }
        } catch (err) {
          console.error('Photo sync error:', err);
          alert('Photo save failed: ' + err.message);
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
}

function renderCompanionAvatar(base64) {
  if (!base64) return;
  
  const imgHtml = `<img src="${base64}" alt="Photo" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;">`;
  
  // 1. Update the Big Profile Card
  const bigAvatar = document.getElementById('btn-comp-avatar');
  if (bigAvatar) bigAvatar.innerHTML = imgHtml;

  // 2. Update the Small Header Icon
  // Based on your HTML, the header icon uses the class 'comp-badge-avatar'
  const smallAvatar = document.querySelector('.comp-badge-avatar');
  if (smallAvatar) smallAvatar.innerHTML = imgHtml;
}


// -------------------------------------------------------------
// RENDER PROFILE STATS (Age / Exp / Role / Phone)
// -------------------------------------------------------------
function renderCompanionProfile(profile) {
  setText('c-age', profile.age || '--');
  setText('c-exp', profile.experience || '--');
  setText('c-role', profile.role || 'Companion');
  setText('c-phone', profile.phone || '--');

  if (profile.photo_url && String(profile.photo_url).length > 20) {
    renderCompanionAvatar(profile.photo_url);
  }
}

// -------------------------------------------------------------
// LOAD & RENDER
// -------------------------------------------------------------
async function loadCompanionWorkOrders() {
  try {
    // DO NOT pass staffId. Let the server figure it out from the auth token.
    const data = await callApi('getCompanionDashboard', {}); 
    allWorkOrders = data || [];
    renderRouteList();
  } catch (err) {
    setHTML('route-list-container', `<p style="color:#dc2626;">Error: ${err.message}</p>`);
  }
}

function setupRouteTabs() {
  const btnPending = document.getElementById('comp-tab-pending');
  const btnComplete = document.getElementById('comp-tab-complete');
  btnPending?.addEventListener('click', () => { compActiveTab = 'PENDING'; btnPending.classList.add('active'); btnComplete.classList.remove('active'); renderRouteList(); });
  btnComplete?.addEventListener('click', () => { compActiveTab = 'COMPLETE'; btnComplete.classList.add('active'); btnPending.classList.remove('active'); renderRouteList(); });
}

function renderRouteList() {
  const container = document.getElementById('route-list-container');
  if (!container) return;

  let filtered = allWorkOrders.filter(w => {
    const st = String(w.status || '').toUpperCase();
    if (compActiveTab === 'PENDING') return ['SCHEDULED', 'UNSCHEDULED', 'IN_PROGRESS'].includes(st);
    return ['COMPLETE', 'CLOSE'].includes(st);
  });

  setText('route-count-badge', `${filtered.length} ${compActiveTab === 'PENDING' ? 'Active' : 'Completed'}`);

  if (filtered.length === 0) {
    container.innerHTML = `<p style="text-align:center; color:#94a3b8; padding:20px 0;">No ${compActiveTab.toLowerCase()} trips found.</p>`;
    return;
  }

  container.innerHTML = filtered.map(wo => {
    const st = String(wo.status || '').toUpperCase();
    const badgeClass = st === 'IN_PROGRESS' ? 'badge-in_progress' : (st === 'COMPLETE' || st === 'CLOSE' ? 'badge-complete' : 'badge-scheduled');
    const displayTime = wo.scheduled_at ? new Date(wo.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-';

    return `
      <div class="visit-card-item" data-id="${wo.work_order_id}">
        <div class="visit-card-top">
          <span class="visit-senior-name">${wo.senior_name || wo.senior_id}</span>
          <span class="status-badge ${badgeClass}">${wo.status}</span>
        </div>
        <div class="visit-meta-row">📍 ${wo.destination || wo.senior_address || 'Address on file'}</div>
        <div class="visit-meta-row">🕐 ${displayTime}</div>
        <div class="visit-meta-row">🆔 ${wo.work_order_id}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.visit-card-item').forEach(card => {
    card.onclick = () => {
      const match = allWorkOrders.find(w => w.work_order_id === card.getAttribute('data-id'));
      if (match) openTripFlow(match);
    };
  });
}

// -------------------------------------------------------------
// WORKFLOW: OPEN TRIP (START OTP vs COCKPIT)
// -------------------------------------------------------------
function openTripFlow(wo) {
  activeWO = wo;
  const st = String(wo.status || '').toUpperCase();
  if (st === 'COMPLETE' || st === 'CLOSE') {
    alert(`✅ Trip for ${wo.senior_name || wo.senior_id} has already been completed.`);
    return;
  }
  st === 'IN_PROGRESS' ? openCockpit(wo) : openStartVisitSheet(wo);
}

function openStartVisitSheet(wo) {
  setText('start-sheet-senior-name', wo.senior_name || wo.senior_id);
  const input = document.getElementById('input-start-code');
  if (input) input.value = '';
  show('start-visit-overlay');
}

function openCockpit(wo) {
  activeWO = wo;
  setText('cockpit-senior-name', wo.senior_name || wo.senior_id);
  setText('cockpit-service-sub', wo.companion_type || 'Companion Service');

  visitStartTime = wo.start_verified_at ? new Date(wo.start_verified_at) : new Date();
  setText('timer-started-at', 'started ' + visitStartTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
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

function stopLiveTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// -------------------------------------------------------------
// START VISIT OTP FLOW
// -------------------------------------------------------------
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
        await loadCompanionWorkOrders();
      } else {
        alert(res.error || 'Invalid Start Code.');
      }
    } catch (err) {
      alert('Verification error: ' + err.message);
    }
  });
}

// -------------------------------------------------------------
// END VISIT OTP FLOW
// -------------------------------------------------------------
function setupEndVisitFlow() {
  document.getElementById('btn-verify-end')?.addEventListener('click', async () => {
    const code = document.getElementById('input-end-code')?.value.trim().replace(/\D/g, '');
    if (!code || code.length !== 6) return alert('Please enter a valid 6-digit numeric End Code.');

    const remarks = document.getElementById('visit-remarks')?.value.trim() || '';

    try {
      const res = await callApi('verifyEndCode', { workOrderId: activeWO.work_order_id, code, remarks });
      if (res.success) {
        stopLiveTimer();
        alert('✅ Trip Completed & Closed Successfully.');
        hide('end-visit-overlay');
        hide('cockpit-overlay');
        activeWO = null;
        await loadCompanionWorkOrders();
      } else {
        alert(res.error || 'Invalid End Code.');
      }
    } catch (err) {
      alert('Completion error: ' + err.message);
    }
  });
}

// -------------------------------------------------------------
// COCKPIT ACTIONS (Open End Code sheet, SOS, Office Call)
// -------------------------------------------------------------
function setupCockpitActions() {
  document.getElementById('btn-open-end-code')?.addEventListener('click', () => {
    const input = document.getElementById('input-end-code');
    if (input) input.value = '';
    show('end-visit-overlay');
  });

  document.getElementById('btn-call-office')?.addEventListener('click', () => {
    window.location.href = `tel:${OFFICE_NUMBER}`;
  });

  document.getElementById('btn-sos-trigger-cockpit')?.addEventListener('click', () => show('sos-modal'));
}

// -------------------------------------------------------------
// CANCEL BOOKING (called via inline onclick in companion.html)
// -------------------------------------------------------------
window.handleCancelBooking = async function () {
  const reasonSelect = document.getElementById('cancel-reason-dropdown');
  const reason = reasonSelect ? reasonSelect.value : '';
  if (!reason) return alert('Please select a cancellation reason.');
  if (!activeWO) return;

  if (!confirm('Are you sure you want to cancel this booking?')) return;

  try {
    await callApi('requestCancellation', { workOrderId: activeWO.work_order_id, reason });
    alert('Booking cancelled.');
    stopLiveTimer();
    hide('cockpit-overlay');
    activeWO = null;
    await loadCompanionWorkOrders();
  } catch (err) {
    alert('Cancellation error: ' + err.message);
  }
};

// -------------------------------------------------------------
// SOS HANDLERS
// -------------------------------------------------------------
function setupSosHandlers() {
  document.getElementById('btn-sos-trigger')?.addEventListener('click', () => show('sos-modal'));
  document.getElementById('btn-cancel-sos')?.addEventListener('click', () => hide('sos-modal'));
  document.getElementById('btn-confirm-sos')?.addEventListener('click', async () => {
    const geo = await getDeviceLocation();
    try {
      await callApi('createDoctorReviewRequest', {
        seniorId: activeWO?.senior_id || 'UNKNOWN',
        workOrderId: activeWO?.work_order_id || '',
        reason: `🚨 COMPANION SOS. GPS: ${geo ? geo.lat + ',' + geo.lng : 'Unknown'}`,
        priority: 'EMERGENCY'
      });
      alert('🚨 Emergency Alert Sent to Control Room!');
    } catch (err) {
      alert('SOS error: ' + err.message);
    } finally {
      hide('sos-modal');
    }
  });
}

// -------------------------------------------------------------
// MODAL CLOSE BUTTONS
// -------------------------------------------------------------
function setupModalCloseButtons() {
  document.getElementById('btn-close-start-sheet')?.addEventListener('click', () => hide('start-visit-overlay'));
  document.getElementById('btn-close-cockpit')?.addEventListener('click', () => {
    stopLiveTimer();
    hide('cockpit-overlay');
  });
  document.getElementById('btn-close-end-sheet')?.addEventListener('click', () => hide('end-visit-overlay'));
}

init();
