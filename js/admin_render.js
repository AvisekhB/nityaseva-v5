export function getSeniorName(id, allData) {
  const s = (allData.seniors || []).find(x => x.senior_id === id);
  return s ? s.full_name : id;
}

export function getStaffName(id, practitionerList) {
  if (!id) return '<span style="color:#a0aec0;">Unassigned</span>';
  const p = practitionerList.find(x => x.id === id);
  if (!p) return id;
  return p.type === 'Doctor' ? `🩺 Dr. ${p.name}` : `👩‍⚕️ ${p.name}`;
}

export function renderWorkOrders(orders, allData, practitionerList, activeSlicer, onOverride) {
  const tbody = document.querySelector('#admin-wo-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let filtered = [...orders];
  if (activeSlicer === 'SCHEDULED') filtered = filtered.filter(w => w.status === 'SCHEDULED' || w.status === 'UNSCHEDULED');
  else if (activeSlicer === 'IN_PROGRESS') filtered = filtered.filter(w => w.status === 'IN_PROGRESS');
  else if (activeSlicer === 'COMPLETE') filtered = filtered.filter(w => w.status === 'COMPLETE' || w.status === 'CLOSE');
  else if (activeSlicer === 'CANCELLED') filtered = filtered.filter(w => w.status === 'CANCELLED');

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No work orders match this view.</td></tr>';
    return;
  }

  filtered.reverse().forEach(wo => {
    const tr = document.createElement('tr');
    const isClosed = (wo.status === 'COMPLETE' || wo.status === 'CLOSE');
    const badgeColor = isClosed ? 'badge-complete' : (wo.status === 'IN_PROGRESS' ? 'badge-in-progress' : (wo.status === 'CANCELLED' ? 'badge-cancelled' : 'badge-scheduled'));
    const typeBadge = wo.type === 'DoctorConsult' ? 'badge-doctor-consult' : 'badge-nurse-visit';
    let displayTime = wo.created_at ? new Date(wo.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-';
    const canCancel = wo.status !== 'CANCELLED' && !isClosed;

    tr.innerHTML = `
      <td><strong>${wo.work_order_id}</strong></td>
      <td>${getSeniorName(wo.senior_id, allData)}</td>
      <td><span class="badge ${typeBadge}">${wo.type}</span></td>
      <td>${displayTime}</td>
      <td><span class="badge ${badgeColor}">${wo.status}</span></td>
      <td>${canCancel ? `<button class="override-btn danger" data-id="${wo.work_order_id}">Cancel</button>` : `<span style="color:#a0aec0;font-size:12px;">Locked</span>`}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.override-btn').forEach(btn => {
    btn.onclick = () => onOverride(btn.getAttribute('data-id'));
  });
}

export function renderSubscriptions(subs, allData) {
  const tbody = document.querySelector('#admin-subs-table tbody');
  if (!tbody) return;
  tbody.innerHTML = subs.length === 0 ? '<tr><td colspan="6">No active subscriptions found.</td></tr>' :
    subs.map(s => `
      <tr>
        <td><strong>${s.subscription_id}</strong></td>
        <td>${getSeniorName(s.senior_id, allData)}</td>
        <td>${s.plan_name}</td>
        <td>${s.start_date || '-'}</td>
        <td><strong>${s.end_date || '-'}</strong></td>
        <td><span class="badge badge-complete">${s.status || 'ACTIVE'}</span></td>
      </tr>
    `).join('');
}

export function renderEntitlements(ents, allData) {
  const tbody = document.querySelector('#admin-entitlements-table tbody');
  if (!tbody) return;
  tbody.innerHTML = ents.length === 0 ? '<tr><td colspan="4">No entitlement records recorded.</td></tr>' :
    ents.map(e => `<tr><td><strong>${getSeniorName(e.senior_id, allData)}</strong></td><td>${e.month}</td><td>${e.nurse_used} / ${e.nurse_allowed}</td><td>${e.doctor_used} / ${e.doctor_allowed}</td></tr>`).join('');
}

export function renderReports(reports, allData, onShare) {
  const tbody = document.querySelector('#admin-reports-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (reports.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No diagnostic reports recorded yet.</td></tr>';
    return;
  }

  [...reports].reverse().forEach(r => {
    const tr = document.createElement('tr');
    const createdDate = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '-';
    tr.innerHTML = `
      <td><strong>${r.report_id}</strong></td>
      <td>${getSeniorName(r.senior_id, allData)}</td>
      <td><span class="badge badge-nurse-visit">${r.type}</span></td>
      <td><a href="${r.file_url}" target="_blank" rel="noopener">Open Doc ↗</a></td>
      <td>${createdDate}</td>
      <td>
        <button class="share-btn" data-id="${r.report_id}" data-senior="${r.senior_id}" data-type="${r.type}">Get 72h Token Link</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.share-btn').forEach(btn => {
    btn.onclick = () => onShare(btn.getAttribute('data-id'), btn.getAttribute('data-senior'), btn.getAttribute('data-type'));
  });
}

export function renderSeniors(seniors) {
  const tbody = document.querySelector('#admin-seniors-table tbody');
  if (!tbody) return;
  tbody.innerHTML = seniors.length === 0 ? '<tr><td colspan="6">No seniors registered.</td></tr>' :
    seniors.map(s => `<tr><td><strong>${s.senior_id}</strong></td><td>${s.full_name}</td><td>${s.phone||'-'}</td><td>${s.email||'-'}</td><td>${s.address||'-'}</td><td><span class="badge badge-complete">${s.status||'ACTIVE'}</span></td></tr>`).join('');
}

export function renderFamilies(families, links, allData) {
  const tbody = document.querySelector('#admin-families-table tbody');
  if (!tbody) return;
  tbody.innerHTML = families.length === 0 ? '<tr><td colspan="6">No families recorded.</td></tr>' :
    families.map(f => {
      const link = links.find(l => l.family_id === f.family_id);
      return `<tr><td><strong>${f.family_id}</strong></td><td>${f.full_name}</td><td>${f.relationship||'-'}</td><td>${link ? getSeniorName(link.senior_id, allData) : 'Unlinked'}</td><td>${f.email||'-'}</td><td>${f.phone||'-'}</td></tr>`;
    }).join('');
}

export function renderStaff(staff) {
  const tbody = document.querySelector('#admin-staff-table tbody');
  if (!tbody) return;
  tbody.innerHTML = staff.length === 0 ? '<tr><td colspan="6">No staff recorded.</td></tr>' :
    staff.map(st => `<tr><td><strong>${st.staff_id}</strong></td><td>${st.full_name}</td><td>${st.role}</td><td>${st.email}</td><td>${st.phone||'-'}</td><td><span class="badge badge-complete">${st.status}</span></td></tr>`).join('');
}

export function renderDoctors(doctors) {
  const tbody = document.querySelector('#admin-doctors-table tbody');
  if (!tbody) return;
  tbody.innerHTML = doctors.length === 0 ? '<tr><td colspan="6">No doctors recorded.</td></tr>' :
    doctors.map(d => `<tr><td><strong>${d.doctor_id}</strong></td><td>${d.full_name}</td><td>${d.specialty||'General'}</td><td>${d.email}</td><td>${d.phone||'-'}</td><td><span class="badge badge-complete">${d.status}</span></td></tr>`).join('');
}

export function renderReviews(revs, allData, practitionerList) {
  const tbody = document.querySelector('#admin-reviews-table tbody');
  if (!tbody) return;
  tbody.innerHTML = revs.length === 0 ? '<tr><td colspan="6">No reviews pending.</td></tr>' :
    revs.map(r => {
      const color = r.priority === 'EMERGENCY' ? 'badge-red' : (r.priority === 'URGENT' ? 'badge-yellow' : 'badge-blue');
      return `<tr><td><strong>${r.review_id}</strong></td><td>${getSeniorName(r.senior_id, allData)}</td><td><span class="badge ${color}">${r.priority}</span></td><td>${r.reason}</td><td>${getStaffName(r.assigned_doctor_id, practitionerList)}</td><td><span class="badge badge-yellow">${r.status}</span></td></tr>`;
    }).join('');
}

export function renderAudit(logs) {
  const tbody = document.querySelector('#admin-audit-table tbody');
  if (!tbody) return;
  tbody.innerHTML = logs.length === 0 ? '<tr><td colspan="6">No audit records found.</td></tr>' :
    [...logs].reverse().slice(0, 100).map(l => {
      let timeStr = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-';
      return `<tr><td><small>${timeStr}</small></td><td>${l.actor_id}</td><td><span class="badge badge-blue">${l.actor_role}</span></td><td><strong>${l.event}</strong></td><td>${l.work_order_id||'-'}</td><td><small>${l.reason||''}</small></td></tr>`;
    }).join('');
}
