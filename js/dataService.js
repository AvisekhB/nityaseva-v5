import { CONFIG } from './config.js';

export async function callApi(action, params = {}) {
  let token = localStorage.getItem('nityaseva_token');

  if (!token && window.supabase) {
    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (session && session.access_token) token = session.access_token;
    } catch (e) {}
  }

  const payload = {
    action: action,
    params: params || {},
    token: token || ''
  };

  try {
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
      console.error('Non-JSON response from Apps Script:', rawText);
      throw new Error('Server returned unexpected output: ' + rawText.substring(0, 100));
    }

    if (!resJson.success) {
      if (resJson.error && resJson.error.includes('UNAUTHENTICATED')) {
        localStorage.removeItem('nityaseva_token');
        localStorage.removeItem('nityaseva_role');
        alert('Session expired. Please log in again.');
        window.location.href = 'index.html';
      }
      throw new Error(resJson.error || 'Server error occurred');
    }

    return resJson.data;
  } catch (err) {
    console.error(`callApi failure for [${action}]:`, err);
    throw err;
  }
}
