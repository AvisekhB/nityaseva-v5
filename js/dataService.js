import { CONFIG } from './config.js';

export async function callApi(action, params = {}) {
  // 1. Get token from localStorage (Google OTP session)
  let token = localStorage.getItem('nityaseva_token');

  // 2. Fallback: check if Supabase token exists in window
  if (!token && window.supabase) {
    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (session && session.access_token) {
        token = session.access_token;
      }
    } catch (e) {}
  }

  // 3. If still no token and this is a protected action, stop early
  const publicActions = ['sendOtpEmail', 'verifyOtpEmail', 'getReportLink'];
  if (!token && !publicActions.includes(action)) {
    alert('Your session has expired or you are not logged in. Redirecting to login page...');
    window.location.href = 'index.html';
    throw new Error('UNAUTHENTICATED: No session found. Please log in.');
  }

  const payload = {
    action: action,
    params: params,
    token: token
  };

  const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  const rawText = await response.text();
  let resJson;
  try {
    resJson = JSON.parse(rawText);
  } catch (e) {
    console.error('Non-JSON server response:', rawText);
    throw new Error('Server returned invalid response: ' + rawText.substring(0, 100));
  }

  if (!resJson.success) {
    // If session expired on backend, clear token and redirect
    if (resJson.error && resJson.error.includes('UNAUTHENTICATED')) {
      localStorage.removeItem('nityaseva_token');
      localStorage.removeItem('nityaseva_role');
      alert('Session expired. Please log in again.');
      window.location.href = 'index.html';
    }
    throw new Error(resJson.error || 'Server error occurred');
  }

  return resJson.data;
}
