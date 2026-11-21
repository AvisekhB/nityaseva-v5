import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let currentStaffProfile = null;
let allWorkOrders = [];
let activeWO = null;
let timerInterval = null;
let visitStartTime = null;
let isVitalsSavedForActiveWO = false;
let nurseActiveTab = 'PENDING'; 

const OFFICE_NUMBER = "+919239258921"; 

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

    // Initializing all modules
    setupNurseAvatarUpload();
    setupSosHandlers();
    setupModalCloseButtons();
    setupAssessmentBmi();
    setupStartVisitFlow();
    setupCockpitActions();
    setupAssessmentForm();
    setupDoctorOptions();
    setupRouteTabs();
    setupExtendedActions(); 
    
    await loadNurseWorkOrders();
  } catch (err) {
    console.error('Nurse Portal Init Error:', err);
    setHTML('route-list-container', `<p style="color:#dc2626; text-align:center; padding:20px 0;">Failed to load: ${err.message}</p>`);
  }
}

// -------------------------------------------------------------
// MODULE FUNCTIONS
// -------------------------------------------------------------

function setupRouteTabs() {
  const btnPending = document.getElementById('nurse-tab-pending');
  const btnComplete = document.getElementById('nurse-tab-complete');
  btnPending?.addEventListener('click', () => { nurseActiveTab = 'PENDING'; btnPending.classList.add('active'); btnComplete.classList.remove('active'); renderRouteList(); });
  btnComplete?.addEventListener('click', () => { nurseActiveTab = 'COMPLETE'; btnComplete.classList.add('active'); btnPending.classList.remove('active'); renderRouteList(); });
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

function setupNurseAvatarUpload() {
  const input = document.getElementById('nurse-photo-input');
  if (!input) return;
  document.querySelectorAll('#btn-nurse-avatar, .nurse-badge-avatar').forEach(trigger => {
    trigger.onclick = () => input.click();
  });
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
        renderNurseAvatar(base64);
        try {
          const sId = (currentStaffProfile?.staff_id) || (currentProfile?.staff_id || currentProfile?.userId);
          await callApi('updateNursePhoto', { staffId: sId, photoData: base64 });
          alert('✓ Photo saved!');
        } catch (err) { alert('Photo save failed'); }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
}

function renderNurseAvatar(base64) {
  if (!base64) return;
  document.querySelectorAll('#btn-nurse-avatar, .nurse-badge-avatar').forEach(el => {
    el.innerHTML = `<img src="${base64}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
  });
}

// Ensure handleCancelBooking and other helpers are defined here...
async function handleCancelBooking() {
  const dropdown = document.getElementById('cancel-reason-dropdown');
  const reason = dropdown ? dropdown.value : '';
  if (!reason) return alert('Select a reason.');
  if (!confirm('Cancel visit?')) return;
  try {
    await callApi('requestCancellation', { workOrderId: activeWO.work_order_id, reason });
    hide('cockpit-overlay');
    await loadNurseWorkOrders();
  } catch (err) { alert(err.message); }
}

function setupExtendedActions() {
  document.getElementById('btn-call-office')?.addEventListener('click', () => window.location.href = `tel:${OFFICE_NUMBER}`);
  document.getElementById('btn-sos-trigger-cockpit')?.addEventListener('click', () => show('sos-modal'));
}

// ... include your existing loadNurseWorkOrders, openVisitFlow, openCockpit, etc. here ...

init();
