import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let dashboardData = {};

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? '';
}
// -------------------------------------------------------------
// PROFILE CARD RENDER (Age/Exp/Role/Phone + Photo)
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
  const el = document.getElementById('btn-crd-avatar');
  if (el) {
    el.innerHTML = `<img src="${base64}" alt="Photo" style="width:100%; height:100%; object-fit:cover; border-radius:50%; display:block;">`;
  }
}

// -------------------------------------------------------------
// PROFILE PHOTO UPLOAD
// -------------------------------------------------------------
function setupCoordinatorAvatarUpload() {
  const input = document.getElementById('crd-photo-input');
  if (!input) return;

  const trigger = document.getElementById('btn-crd-avatar');
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

        renderCoordinatorAvatar(base64);

        const coordinatorId = currentProfile.coordinator_id;
        if (!coordinatorId) {
          alert('Coordinator ID not found. Could not save photo.');
          return;
        }

        try {
          const res = await callApi('updateCoordinatorPhoto', { coordinatorId, photoData: base64 });
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

async function init() {
  try {
    currentProfile = await requireAuth('coordinator');
    if (!currentProfile) return;

    setText('crd-name-display', currentProfile.full_name || 'Coordinator');
    setText('crd-id-display', currentProfile.coordinator_id || 'CRD-XXXX');

    document.getElementById('btn-logout')?.addEventListener('click', signOut);

    setupSubTabs();
    setupForms();
    await loadCoordinatorDashboard();
  } catch (err) {
    console.error('Coordinator init failed:', err);
    showFatalError('Dashboard failed to load: ' + err.message);
  }
}

function showFatalError(msg) {
  const containers = ['morning-visits-list', 'morning-pending-list', 'morning-incidents-list'];
  containers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<p style="color:#dc2626; font-weight:700; padding:12px; background:#fef2f2; border-radius:8px;">⚠️ ' + msg + '</p>';
  });
  setText('crd-name-display', 'Error Loading');
}

function setupSubTabs() {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.workflow-card').forEach(card => card.classList.add('hidden'));
      btn.classList.add('active');
      const targetId = 'section-' + btn.getAttribute('data-section');
      const target = document.getElementById(targetId);
      if (target) target.classList.remove('hidden');
    });
  });
}

async function loadCoordinatorDashboard() {
  try {
    dashboardData = await callApi('getCoordinatorDashboard');

    const counts = dashboardData.counts || {};
    setText('stat-visits', counts.todaysVisits || 0);
    setText('stat-pending', counts.pending || 0);
    setText('stat-incidents', counts.incidents || 0);
    setText('morning-visits-count', (dashboardData.todaysVisits || []).length);
    setText('morning-pending-count', (dashboardData.pendingRequests || []).length);
    setText('morning-incidents-count', (dashboardData.incidents || []).length);
    setText('missed-count', (dashboardData.missedVisits || []).length);
    setText('complaints-count', (dashboardData.openComplaints || []).length);
    setText('insurance-count', (dashboardData.insuranceFollowUps || []).length);
    setText('companion-jobs-count', (dashboardData.myCompanionJobs || []).length);
    setText('hospital-count', (dashboardData.myHospitalJobs || []).length);

    renderMorningVisits(dashboardData.todaysVisits || []);
    renderPendingRequests(dashboardData.pendingRequests || []);
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

function getSeniorLabel(v) {
  return v.senior_name || v.senior_id || 'Unknown Senior';
}

function getAssignedLabel(v) {
  return v.assigned_staff_id || v.assigned_doctor_id || v.assigned_coordinator_id || 'Unassigned';
}

function formatDateTime(val) {
  if (!val) return 'Not set';
  try {
    return new Date(val).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (e) {
    return String(val);
  }
}

function renderMorningVisits(visits) {
  const container = document.getElementById('morning-visits-list');
  if (!container) return;
  if (!visits || visits.length === 0) {
    container.innerHTML = '<p class="empty-state">No visits scheduled for today.</p>';
    return;
  }
  container.innerHTML = visits.map(function (v) {
    var badgeClass = v.status === 'SCHEDULED' ? 'badge-yellow' : 'badge-green';
    var dateLabel = v.scheduled_at ? formatDateTime(v.scheduled_at) : formatDateTime(v.created_at);
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + v.work_order_id + '</span>' +
          '<span class="badge ' + badgeClass + '">' + v.status + '</span>' +
        '</div>' +
        '<div class="item-meta">Senior: <strong>' + getSeniorLabel(v) + '</strong> | Type: ' + v.type + '</div>' +
        '<div class="item-meta">Staff: ' + getAssignedLabel(v) + '</div>' +
        '<div class="item-meta">Scheduled: ' + dateLabel + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderPendingRequests(requests) {
  const container = document.getElementById('morning-pending-list');
  if (!container) return;
  if (!requests || requests.length === 0) {
    container.innerHTML = '<p class="empty-state">No pending requests.</p>';
    return;
  }
  container.innerHTML = requests.map(function (r) {
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + r.appointment_id + '</span>' +
          '<span class="badge badge-yellow">REQUESTED</span>' +
        '</div>' +
        '<div class="item-meta">Senior: ' + r.senior_id + ' | Scheduled: ' + formatDateTime(r.scheduled_at) + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderIncidents(incidents) {
  const container = document.getElementById('morning-incidents-list');
  if (!container) return;
  if (!incidents || incidents.length === 0) {
    container.innerHTML = '<p class="empty-state">No overnight incidents.</p>';
    return;
  }
  container.innerHTML = incidents.map(function (i) {
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + (i.review_id || i.incident_id) + '</span>' +
          '<span class="badge badge-red">' + (i.priority || 'URGENT') + '</span>' +
        '</div>' +
        '<div class="item-meta">Senior: ' + i.senior_id + '</div>' +
        '<div class="item-meta">' + (i.reason || i.incident_type) + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderMissedVisits(missed) {
  const container = document.getElementById('missed-visits-list');
  if (!container) return;
  if (!missed || missed.length === 0) {
    container.innerHTML = '<p class="empty-state">No missed visits.</p>';
    return;
  }
  container.innerHTML = missed.map(function (m) {
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + m.work_order_id + '</span>' +
          '<span class="badge badge-red">MISSED / DELAYED</span>' +
        '</div>' +
        '<div class="item-meta">Senior: ' + getSeniorLabel(m) + ' | Staff: ' + getAssignedLabel(m) + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderStaffAvailability(staffList) {
  const container = document.getElementById('staff-availability-list');
  if (!container) return;
  if (!staffList || staffList.length === 0) {
    container.innerHTML = '<p class="empty-state">No active staff found.</p>';
    return;
  }
  container.innerHTML = staffList.map(function (s) {
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + s.full_name + ' (' + s.staff_id + ')</span>' +
          '<span class="badge badge-blue">Load: ' + s.todays_load + ' visits</span>' +
        '</div>' +
        '<div class="item-meta">Role: ' + s.role + ' | Phone: ' + (s.phone || '-') + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderComplaints(complaints) {
  const container = document.getElementById('complaints-list');
  if (!container) return;
  if (!complaints || complaints.length === 0) {
    container.innerHTML = '<p class="empty-state">No open complaints.</p>';
    return;
  }
  container.innerHTML = complaints.map(function (c) {
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + c.complaint_id + '</span>' +
          '<span class="badge badge-yellow">' + c.status + '</span>' +
        '</div>' +
        '<div class="item-meta">' + c.complaint_text + '</div>' +
      '</div>'
    );
  }).join('');
}

function renderInsurance(claims) {
  const container = document.getElementById('insurance-list');
  if (!container) return;
  if (!claims || claims.length === 0) {
    container.innerHTML = '<p class="empty-state">No pending insurance claims.</p>';
    return;
  }
  container.innerHTML = claims.map(function (cl) {
    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + cl.claim_id + ' (' + cl.insurer + ')</span>' +
          '<span class="badge badge-yellow">' + cl.claim_status + '</span>' +
        '</div>' +
        '<div class="item-meta">Policy: ' + cl.policy_number + ' | Senior: ' + cl.senior_id + '</div>' +
      '</div>'
    );
  }).join('');
}

var typeLabels = {
  OUTINGS: '🚶 Outings',
  BANK_WORK: '🏦 Bank Work',
  HOSPITAL_TRIP: '🏥 Hospital Trip',
  SHOPPING_GROCERIES: '🛒 Shopping',
  RAILWAY_BUS_DROP: '🚉 Station Drop',
  MEDICINE_PICKUP: '💊 Medicine Pickup',
  MEDICAL_REPORT_PICKUP: '📄 Report Pickup'
};

function renderCompanionJobs(jobs) {
  const container = document.getElementById('companion-jobs-list');
  if (!container) return;
  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">No companion service jobs assigned to you yet.</p>';
    return;
  }

  container.innerHTML = jobs.map(function (j) {
    var statusMap = {
      REQUESTED: 'badge-yellow',
      CONFIRMED: 'badge-blue',
      IN_PROGRESS: 'badge-blue',
      COMPLETED: 'badge-green',
      CANCELLED: 'badge-red'
    };
    var statusCls = statusMap[j.status] || 'badge-yellow';

    var actionBtn = '';
    if (j.status === 'REQUESTED') {
      actionBtn = '<button class="mini-btn" data-action="confirm-companion" data-id="' + j.service_id + '">Confirm Job</button>';
    } else if (j.status === 'CONFIRMED') {
      actionBtn = '<button class="mini-btn" data-action="assign-staff-companion" data-id="' + j.service_id + '">Assign Field Staff</button>';
    } else if (j.status === 'IN_PROGRESS') {
      actionBtn = '<button class="mini-btn" data-action="complete-companion" data-id="' + j.service_id + '">Mark Complete</button>';
    }

    var typeLabel = typeLabels[j.companion_type] || j.companion_type;

    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + j.service_id + '</span>' +
          '<span class="badge ' + statusCls + '">' + j.status + '</span>' +
        '</div>' +
        '<div class="item-meta">Senior: <strong>' + j.senior_id + '</strong> | ' + typeLabel + '</div>' +
        '<div class="item-meta">Destination: ' + (j.destination || '-') + '</div>' +
        '<div class="item-meta">Staff: ' + (j.assigned_staff_id || 'Not yet assigned') + '</div>' +
        '<div class="action-btn-row">' + actionBtn + '</div>' +
      '</div>'
    );
  }).join('');

  wireCompanionJobActions(container);
}

function wireCompanionJobActions(container) {
  container.querySelectorAll('[data-action="confirm-companion"]').forEach(function (btn) {
    btn.onclick = async function () {
      var pickupTime = prompt('Enter pickup time (e.g. 10:00 AM):');
      try {
        await callApi('coordinatorConfirmCompanionService', { serviceId: btn.getAttribute('data-id'), pickupTime: pickupTime || '' });
        alert('✅ Companion job confirmed.');
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });

  container.querySelectorAll('[data-action="assign-staff-companion"]').forEach(function (btn) {
    btn.onclick = async function () {
      var staffId = prompt('Enter Field Staff ID (e.g. STF-001):');
      if (!staffId) return;
      try {
        await callApi('coordinatorAssignCompanionStaff', { serviceId: btn.getAttribute('data-id'), staffId: staffId.trim() });
        alert('✅ Staff assigned.');
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });

  container.querySelectorAll('[data-action="complete-companion"]').forEach(function (btn) {
    btn.onclick = async function () {
      if (!confirm('Mark this companion job as COMPLETED?')) return;
      try {
        await callApi('markCompanionServiceComplete', { serviceId: btn.getAttribute('data-id') });
        alert('✅ Marked complete.');
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });
}

function renderHospitalJobs(jobs) {
  const container = document.getElementById('hospital-services-list');
  if (!container) return;
  if (!jobs || jobs.length === 0) {
    container.innerHTML = '<p class="empty-state">No hospital service jobs assigned to you yet.</p>';
    return;
  }

  container.innerHTML = jobs.map(function (j) {
    var statusMap = {
      REQUESTED: 'badge-yellow',
      CONFIRMED: 'badge-blue',
      IN_PROGRESS: 'badge-blue',
      COMPLETED: 'badge-green',
      CANCELLED: 'badge-red'
    };
    var statusCls = statusMap[j.status] || 'badge-yellow';

    var actionBtn = '';
    if (j.status === 'REQUESTED') {
      actionBtn = '<button class="mini-btn" data-action="confirm-hospital" data-id="' + j.service_id + '">Confirm Appointment</button>';
    } else if (j.status === 'CONFIRMED' && j.service_type === 'HOSPITAL_ESCORT') {
      actionBtn = '<button class="mini-btn" data-action="assign-escort" data-id="' + j.service_id + '">Assign Escort Staff</button>';
    } else if (j.status === 'IN_PROGRESS' || j.status === 'CONFIRMED') {
      actionBtn = '<button class="mini-btn" data-action="complete-hospital" data-id="' + j.service_id + '">Mark Complete</button>';
    }

    var typeLabel = j.service_type === 'HOSPITAL_ESCORT' ? '🏥 Escort' : '📞 Coordination';

    return (
      '<div class="item-card">' +
        '<div class="item-top">' +
          '<span class="item-name">' + j.service_id + '</span>' +
          '<span class="badge ' + statusCls + '">' + j.status + '</span>' +
        '</div>' +
        '<div class="item-meta">Senior: <strong>' + j.senior_id + '</strong> | ' + typeLabel + '</div>' +
        '<div class="item-meta">Hospital: ' + (j.preferred_hospital || 'Not set') + '</div>' +
        '<div class="action-btn-row">' + actionBtn + '</div>' +
      '</div>'
    );
  }).join('');

  wireHospitalJobActions(container);
}

function wireHospitalJobActions(container) {
  container.querySelectorAll('[data-action="confirm-hospital"]').forEach(function (btn) {
    btn.onclick = async function () {
      var hospitalName = prompt('Confirm hospital name:');
      if (!hospitalName) return;
      try {
        await callApi('coordinatorConfirmHospitalAppointment', { serviceId: btn.getAttribute('data-id'), hospitalName: hospitalName, appointmentDate: '' });
        alert('✅ Appointment confirmed & checklist sent to family.');
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });

  container.querySelectorAll('[data-action="assign-escort"]').forEach(function (btn) {
    btn.onclick = async function () {
      var staffId = prompt('Enter Staff ID to assign as escort:');
      if (!staffId) return;
      try {
        await callApi('coordinatorAssignEscortStaff', { serviceId: btn.getAttribute('data-id'), staffId: staffId.trim(), pickupTime: '', travelArranged: true });
        alert('✅ Escort staff assigned.');
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });

  container.querySelectorAll('[data-action="complete-hospital"]').forEach(function (btn) {
    btn.onclick = async function () {
      if (!confirm('Mark this hospital service as COMPLETED?')) return;
      try {
        await callApi('markHospitalServiceComplete', { serviceId: btn.getAttribute('data-id') });
        alert('✅ Marked complete.');
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    };
  });
}

function setupForms() {
  var scheduleForm = document.getElementById('schedule-visit-form');
  if (scheduleForm) {
    scheduleForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var resDiv = document.getElementById('sch-result');
      try {
        var res = await callApi('coordinatorScheduleVisit', {
          seniorId: document.getElementById('sch-senior-id').value.trim(),
          type: document.getElementById('sch-type').value,
          scheduledAt: document.getElementById('sch-datetime').value,
          staffId: document.getElementById('sch-staff-id').value.trim()
        });
        if (resDiv) {
          resDiv.className = 'message success';
          resDiv.innerHTML = '✅ Visit Scheduled! Work Order: <code>' + res.workOrderId + '</code>';
          resDiv.classList.remove('hidden');
        }
        e.target.reset();
        await loadCoordinatorDashboard();
      } catch (err) {
             if (resDiv) {
          resDiv.className = 'message error';
          resDiv.textContent = 'Error: ' + err.message;
          resDiv.classList.remove('hidden');
        }
      }
    });
  }

  var rescheduleForm = document.getElementById('reschedule-visit-form');
  if (rescheduleForm) {
    rescheduleForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        await callApi('coordinatorRescheduleVisit', {
          workOrderId: document.getElementById('resch-wo-id').value.trim(),
          newScheduledAt: document.getElementById('resch-datetime').value,
          rescheduleReason: document.getElementById('resch-reason').value.trim()
        });
        alert('✅ Visit rescheduled successfully.');
        e.target.reset();
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  var reportReviewForm = document.getElementById('report-review-form');
  if (reportReviewForm) {
    reportReviewForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var resDiv = document.getElementById('rev-result');
      try {
        await callApi('coordinatorReviewReport', {
          assessmentId: document.getElementById('rev-asm-id').value.trim(),
          seniorId: document.getElementById('rev-senior-id').value.trim(),
          reviewStatus: document.getElementById('rev-status').value,
          notes: document.getElementById('rev-notes').value.trim()
        });
        if (resDiv) {
          resDiv.className = 'message success';
          resDiv.textContent = '✅ Review submitted successfully.';
          resDiv.classList.remove('hidden');
        }
        e.target.reset();
      } catch (err) {
        if (resDiv) {
          resDiv.className = 'message error';
          resDiv.textContent = 'Error: ' + err.message;
          resDiv.classList.remove('hidden');
        }
      }
    });
  }

  var hospitalAdmissionForm = document.getElementById('hospital-admission-form');
  if (hospitalAdmissionForm) {
    hospitalAdmissionForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        var res = await callApi('coordinatorLogIncident', {
          seniorId: document.getElementById('adm-senior-id').value.trim(),
          incidentType: 'HOSPITAL_ADMISSION',
          severity: document.getElementById('adm-type').value === 'EMERGENCY' ? 'HIGH' : 'MEDIUM',
          actionsTaken: 'Hospital: ' + document.getElementById('adm-hospital').value.trim() + ', Bed Status: ' + (document.getElementById('adm-bed').value.trim() || 'CONFIRMED'),
          familyNotified: document.getElementById('adm-family-notified').checked
        });
        alert('✅ Hospital admission logged! Incident ID: ' + res.incidentId);
        e.target.reset();
        await loadCoordinatorDashboard();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });
  }

  var complaintForm = document.getElementById('complaint-form');
  if (complaintForm) {
    complaintForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      try {
        var res = await callApi('coordinatorLogComplaint', {
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
}

init();

