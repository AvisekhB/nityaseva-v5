import { CONFIG } from './config.js';
import { supabase } from './supabaseClient.js';

/**
 * Robust API Adapter for Nityaseva V5
 * Handles JWT retrieval from Supabase and forwards to Google Apps Script
 */
export async function callApi(action, params = {}) {
  // 1. Get the latest session from Supabase
  // This automatically handles token refreshes
  const { data: { session } } = await supabase.auth.getSession();
  const token = session ? session.access_token : null;

  if (!token) {
    // If no token exists, redirect to login
    window.location.href = 'index.html';
    throw new Error('UNAUTHENTICATED');
  }

  const payload = {
    action: action,
    params: params || {},
    token: token
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
      throw new Error('Server returned unexpected output.');
    }

    // 2. Handle Unauthorized errors from the backend
    if (!resJson.success) {
      if (resJson.error && resJson.error.includes('UNAUTHENTICATED')) {
        await supabase.auth.signOut();
        alert('Your session has expired. Please log in again.');
        window.location.href = 'index.html';
      }
      throw new Error(resJson.error || 'Server error occurred');
    }

    return resJson.data;
  } catch (err) {
    console.error(`callApi failure [${action}]:`, err);
    throw err;
  }
}
