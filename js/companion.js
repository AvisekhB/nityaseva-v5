import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let activeWO = null;

async function init() {
  currentProfile = await requireAuth('companion'); // Specific Role
  setupSosHandlers();
  setupEndVisitFlow();
  await loadCompanionWorkOrders();
}

async function loadCompanionWorkOrders() {
  const data = await callApi('getCompanionDashboard', { staffId: currentProfile.userId });
  renderCompanionList(data);
}

// No assessment/vitals functions here = NO VITALS BUG
async function handleCompleteVisit() {
  const remarks = document.getElementById('visit-remarks').value;
  const code = document.getElementById('input-end-code').value;
  const geo = await getDeviceLocation();
  
  await callApi('verifyEndCode', { workOrderId: activeWO.work_order_id, code, remarks, geo });
  alert('Trip Completed');
  location.reload();
}
