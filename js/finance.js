import { requireAuth, signOut } from './auth.js';
import { callApi } from './dataService.js';

async function init() {
  const profile = await requireAuth('finance');
  if (!profile) return;

  document.getElementById('btn-logout').onclick = signOut;
  
  await loadFinanceDashboard();
  
  document.getElementById('invoice-form').onsubmit = async (e) => {
    e.preventDefault();
    await callApi('createInvoice', {
      seniorId: document.getElementById('inv-senior').value,
      amount: document.getElementById('inv-amount').value,
      dueDate: document.getElementById('inv-due').value
    });
    alert('Invoice Created!');
    loadFinanceDashboard();
  };
}

async function loadFinanceDashboard() {
  const data = await callApi('getFinancialSummary');
  document.getElementById('rev-total').textContent = `₹${data.totalRevenue}`;
  document.getElementById('rev-pending').textContent = data.pendingInvoices.length;
  
  const tbody = document.querySelector('#invoice-table tbody');
  tbody.innerHTML = data.pendingInvoices.map(i => `
    <tr>
      <td>${i.invoice_id}</td>
      <td>${i.senior_id}</td>
      <td>₹${i.amount}</td>
      <td>${i.due_date}</td>
      <td><button onclick="markPaid('${i.invoice_id}')">Mark Paid</button></td>
    </tr>
  `).join('');
}

window.markPaid = async (id) => {
  await callApi('updateInvoiceStatus', { invoiceId: id, status: 'PAID' });
  loadFinanceDashboard();
};

init();
