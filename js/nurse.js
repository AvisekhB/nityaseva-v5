import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null, currentStaffProfile = null, allWorkOrders = [], activeWO = null, timerInterval = null, visitStartTime = null, isVitalsSavedForActiveWO = false, nurseActiveTab = 'PENDING';
const OFFICE_NUMBER = "+919239258921";

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

async function init() {
  try {
    currentProfile = await requireAuth('nurse');
    if (!currentProfile) return;
    document.getElementById('btn-logout')?.addEventListener('click', signOut);
    setupNurseAvatarUpload(); setupSosHandlers(); setupModalCloseButtons(); setupAssessmentBmi(); setupStartVisitFlow();
    setupCockpitActions(); setupAssessmentForm(); setupDoctorOptions(); setupRouteTabs(); setupExtendedActions();
    await loadNurseWorkOrders();
  } catch (err) {
    console.error('Init Error:', err);
  }
}

async function getDeviceLocation() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }), () => res(null), { timeout: 5000 });
  });
}

function setupExtendedActions() {
  document.getElementById('btn-call-office')?.addEventListener('click', () => window.location.href = `tel:${OFFICE_NUMBER}`);
  document.getElementById('btn-sos-trigger-cockpit')?.addEventListener('click', () => show('sos-modal'));
}

async function handleCancelBooking() {
  const reason = document.getElementById('cancel-reason-dropdown').value;
  if (!reason) return alert('Select reason.');
  if (!confirm('Cancel this visit?')) return;
  try {
    await callApi('requestCancellation', { workOrderId: activeWO.work_order_id, reason });
    hide('cockpit-overlay');
    loadNurseWorkOrders();
  } catch (err) { alert(err.message); }
}

async function handleCompleteVisit() {
  const remarks = document.getElementById('visit-remarks').value;
  const code = document.getElementById('input-end-code').value;
  if (!remarks) return alert('Remarks mandatory.');
  const geo = await getDeviceLocation();
  try {
    const res = await callApi('verifyEndCode', { workOrderId: activeWO.work_order_id, code, remarks, geo });
    if (res.success) {
      clearInterval(timerInterval);
      alert('Visit Completed');
      hide('end-visit-overlay'); hide('cockpit-overlay');
      loadNurseWorkOrders();
    } else alert(res.error);
  } catch (err) { alert(err.message); }
}

// ... (Keep your existing loadNurseWorkOrders, renderRouteList, setupRouteTabs, openVisitFlow, openCockpit, setupCockpitActions, setupAssessmentForm, setupStartVisitFlow, setupEndVisitFlow, setupModalCloseButtons, setupSosHandlers, setupAssessmentBmi, setupDoctorOptions, setupNurseAvatarUpload functions here) ...

init();
