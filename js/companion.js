import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let allWorkOrders = [];
let activeWO = null;
let timerInterval = null;
let visitStartTime = null;
let compActiveTab = 'PENDING';

const OFFICE_NUMBER = "+919239258921"; // Update with actual office number

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

async function init() {
  try {
    currentProfile = await requireAuth('companion');
    if (!currentProfile) return;

    setText('comp-name-display', currentProfile.full_name || 'Companion');
    setText('comp-id-display', currentProfile.staff_id || 'FCRD-XXXX');
    setText('comp-name-profile', currentProfile.full_name || 'Companion');
    setText('comp-role-profile', `ID: ${currentProfile.staff_id || 'FCRD-XXXX'}`);

    document.getElementById('btn-logout')?.addEventListener('click', signOut);

    setupRouteTabs();
    setupSosHandlers();
    setupModalCloseButtons();
    setupStartVisitFlow();
    setupCockpitActions();
    setupExtendedActions();

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
// LOAD & RENDER
// -------------------------------------------------------------
async function init() {
  try {
    currentProfile = await requireAuth('companion');
    if (!currentProfile) return;

    const companionId = currentProfile.companion_id || currentProfile.userId || 'FCRD-XXXX';

    setText('comp-name-display', currentProfile.full_name || 'Companion');
    setText('comp-id-display', companionId);
    setText('comp-name-profile', currentProfile.full_name || 'Companion');
    setText('comp-role-profile', `ID: ${companionId}`);

    document.getElementById('btn-logout')?.addEventListener('click', signOut);

    setupRouteTabs();
    setupSosHandlers();
    setupModalCloseButtons();
    setupStartVisitFlow();
    setupCockpitActions();
    setupExtendedActions();

    await loadCompanionWorkOrders();
  } catch (err) {
    console.error('Companion Portal Init Error:', err);
    setHTML('route-list-container', `<p style="color:#dc2626; text-align:center;">Failed to load: ${err.message}</p>`);
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
        <div
