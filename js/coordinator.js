import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let dashboardData = {};

// -------------------------------------------------------------
// SAFE DOM HELPERS
// -------------------------------------------------------------
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text ?? ''; }
function setHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html ?? ''; }

async function init() {
  try {
    currentProfile = await requireAuth('coordinator');
    if (!currentProfile) return;

    setText('crd-name-display', currentProfile.full_name || 'Coordinator');
    setText('crd-id-display', currentProfile.coordinator_id || 'CRD-XXXX');

    document.getElementById('btn-logout')?.addEventListener('click', signOut);

    setupSubTabs();
      resDiv.classList.remove('hidden');
      e.target.reset();
    } catch (err) {
      resDiv.className = 'message error';
      resDiv.textContent = 'Error: ' + err.message;
      resDiv.classList.remove('hidden');
    }
  });

  // Hospital Admission Logging
  document.getElementById('hospital-admission-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await callApi('coordinatorLogHospitalAdmission', {
        seniorId: document.getElementById('adm-senior-id').value.trim(),
        hospitalName: document.getElementById('adm-hospital').value.trim(),
        admissionType: document.getElementById('adm-type').value,
        bedStatus: document.getElementById('adm-bed').value.trim() || 'CONFIRMED',
        familyNotified: document.getElementById('adm-family-notified').checked
      });
      alert('✅ Hospital admission logged! Admission ID: ' + res.admissionId);
      e.target.reset();
      await loadCoordinatorDashboard();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Complaint Logging
  document.getElementById('complaint-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await callApi('coordinatorLogComplaint', {
        seniorId: document.getElementById('cmp-senior-id').value.trim(),
        complaintText: document.getElementById('cmp-text').value.trim(),
        dueDate: document.getElementById('cmp-due-date').value
      });
      alert('✅ Complaint logged! Complaint ID: ' + res.complaintId);
      e.target.reset();
      await loadCoordinatorDashboard();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

init();
