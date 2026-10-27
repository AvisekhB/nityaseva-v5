import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

let currentProfile = null;
let currentSeniorId = null;

async function init() {
  currentProfile = await requireAuth('family');
  if (!currentProfile) return;

  document.getElementById('user-display').textContent = currentProfile.full_name || currentProfile.email || 'Family Member';
  document.getElementById('btn-logout').addEventListener('click', signOut);

  setupMinBookingTime();
  await loadDashboard();
}

// Enforces minimum 24-hour advance slot booking
function setupMinBookingTime() {
  const aptTimeInput = document.getElementById('apt-time');
  if (!aptTimeInput) return;

  const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Now + 24 hours
  minDate.setMinutes(minDate.getMinutes() - minDate.getTimezoneOffset());
  const isoMin = minDate.toISOString().slice(0, 16);

  aptTimeInput.min = isoMin;
  aptTimeInput.value = isoMin;
}

async function loadDashboard() {
  try {
    const data = await callApi('getFamilyDashboard', { familyId: currentProfile.family_id || currentProfile.id });

    // 1. Senior Demographic Details
    const seniorInfo = document.getElementById('senior-info');
    if (data.seniors && data.seniors.length > 0) {
      const s = data.seniors[0];
      currentSeniorId = s.senior_id;
      seniorInfo.innerHTML = `
        <strong>${s.full_name}</strong> (ID: <code>${s.senior_id}</code>)<br>
        <strong>DOB:</strong> ${s.dob || 'N/A'} | <strong>Phone:</strong> ${s.phone || 'N/A'}<br>
        <strong>Residential Address:</strong> ${s.address || 'N/A'}<br>
        <strong>Emergency Contact:</strong> ${s.emergency_contact || '112 (National Emergency)'}
      `;

      // Load latest vitals for senior
      await loadLatestVitals(s.senior_id);
    } else {
      seniorInfo.innerHTML = '<em>No senior profile linked to this family account yet. Please contact support.</em>';
    }

    // 2. Entitlements Quotas
    if (data.entitlements && data.entitlements.length > 0) {
      const ent = data.entitlements[0];
      const nurseRem = Math.max(0, Number(ent.nurse_allowed) - Number(ent.nurse_used));
      const docRem = Math.max(0, Number(ent.doctor_allowed) - Number(ent.doctor_used));
      document.getElementById('nurse-count').textContent = `${nurseRem} / ${ent.nurse_allowed}`;
      document.getElementById('doctor-count').textContent = `${docRem} / ${ent.doctor_allowed}`;
    }

    // 3. Diagnostic Reports & Care Summaries
    const reportsTbody = document.querySelector('#family-reports-table tbody');
    if (reportsTbody) {
      const reports = data.reports || [];
      if (reports.length === 0) {
        reportsTbody.innerHTML = '<tr><td colspan="4">No diagnostic reports uploaded yet.</td></tr>';
      } else {
        reportsTbody.innerHTML = [...reports].reverse().map(r => {
          const isCareJournal = (r.file_url === 'INTERNAL_CARE_JOURNAL');
          const docLink = isCareJournal
            ? `<button class="view-care-btn secondary" style="padding:4px 8px; font-size:11px;">Open Care Summary</button>`
            : `<a href="${r.file_url}" target="_blank" rel="noopener">Download File ↗</a>`;

          return `
            <tr>
              <td><strong>${r.report_id}</strong></td>
              <td>${r.type}</td>
              <td>${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '-'}</td>
              <td>${docLink}</td>
            </tr>
          `;
        }).join('');

        reportsTbody.querySelectorAll('.view-care-btn').forEach(btn => {
          btn.onclick = () => openInteractiveCareSummary();
        });
      }
    }

    // 4. Scheduled Work Orders & Visits
    const tbody = document.querySelector('#work-orders-table tbody');
    tbody.innerHTML = '';
    if (data.workOrders && data.workOrders.length > 0) {
      data.workOrders.reverse().forEach(wo => {
        const tr = document.createElement('tr');
        const st = String(wo.status).toUpperCase();
        const badgeColor = st === 'COMPLETE' || st === 'COMPLETED' ? 'badge-green' : (st === 'IN_PROGRESS' ? 'badge-yellow' : 'badge-blue');
        
        tr.innerHTML = `
          <td><strong>${wo.work_order_id}</strong></td>
          <td>${wo.type === 'DoctorConsult' ? '🩺 Doctor Teleconsult' : '👩‍⚕️ Nurse Home Visit'}</td>
          <td><span class="badge ${badgeColor}">${wo.status}</span></td>
          <td>${wo.created_at ? new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
        `;
        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = '<tr><td colspan="4">No scheduled visits.</td></tr>';
    }

  } catch (err) {
    alert('Failed to load dashboard: ' + err.message);
  }
}

// Fetches latest vitals to show quick health snapshot
async function loadLatestVitals(seniorId) {
  try {
    const summary = await callApi('getSeniorClinicalSummary', { seniorId });
    const v = summary.latestAssessment;
    if (v) {
      document.getElementById('vitals-summary-container').classList.remove('hidden');
      const sys = v.bp_systolic || (v.bp ? v.bp.split('/')[0] : '--');
      const dia = v.bp_diastolic || (v.bp ? v.bp.split('/')[1] : '--');
      document.getElementById('disp-bp').textContent = `${sys}/${dia}`;
      document.getElementById('disp-hr').textContent = v.heart_rate || '--';
      document.getElementById('disp-spo2').textContent = (v.spo2 ? v.spo2 + '%' : '--%');
      document.getElementById('disp-sugar').textContent = v.glucose_random || v.glucose_fasting || v.blood_sugar || '--';
      document.getElementById('disp-temp').textContent = (v.temperature ? `${v.temperature}°${v.temperature_unit || 'C'}` : '--°C');
    }
  } catch (e) {
    console.warn('Could not load vitals snapshot:', e);
  }
}

// Opens the 72-Hour Animated Care Summary for Family
async function openInteractiveCareSummary() {
  if (!currentSeniorId) return alert('No senior linked to this account.');
  try {
    const res = await callApi('generateClinicalCareReport', { seniorId: currentSeniorId });
    const reportUrl = `report.html?token=${res.token}`;
    window.open(reportUrl, '_blank');
  } catch (err) {
    alert('Error loading Care Summary: ' + err.message);
  }
}

document.getElementById('btn-view-summary')?.addEventListener('click', openInteractiveCareSummary);

// 5. Handle Booking with 24h Check
document.getElementById('appointment-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('apt-type').value;
  const time = document.getElementById('apt-time').value;

  const chosenDate = new Date(time).getTime();
  const minRequired = Date.now() + (23.5 * 60 * 60 * 1000); // ~24h check

  if (chosenDate < minRequired) {
    return alert('Please select a date and time at least 24 hours in advance.');
  }

  try {
    await callApi('createAppointment', {
      seniorId: currentSeniorId || (currentProfile.senior_id || ''),
      type: type,
      scheduledAt: new Date(time).toISOString()
    });
    alert('Appointment requested successfully! Our team will assign staff within 24 hours.');
    await loadDashboard();
  } catch (err) {
    alert('Error booking appointment: ' + err.message);
  }
});

init();
