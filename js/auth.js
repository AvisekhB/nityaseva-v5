import { callApi } from './dataService.js';

// Safe storage wrapper to prevent crashes in restricted WebViews
const storage = {
  setItem: (key, val) => {
    try { if (window.localStorage) localStorage.setItem(key, val); } 
    catch (e) { console.warn('localStorage setItem blocked:', e); }
  },
  getItem: (key) => {
    try { return window.localStorage ? localStorage.getItem(key) : null; } 
    catch (e) { return null; }
  },
  removeItem: (key) => {
    try { if (window.localStorage) localStorage.removeItem(key); } 
    catch (e) { }
  }
};

export async function sendOtp(email) {
  return await callApi('sendOtpEmail', { email: email });
}

export async function verifyOtp(email, code) {
  const result = await callApi('verifyOtpEmail', { email: email, code: code });
  
  if (result.success && result.token) {
    storage.setItem('nityaseva_token', result.token);
    storage.setItem('nityaseva_role', result.role);
    storage.setItem('nityaseva_user', JSON.stringify(result.profile || {}));
  }
  
  return result;
}

export function getCurrentUserProfile() {
  const userStr = storage.getItem('nityaseva_user');
  if (!userStr) return null;
  try {
    const user = JSON.parse(userStr);
    user.role = storage.getItem('nityaseva_role') || 'family';
    return user;
  } catch (e) {
    return null;
  }
}

export async function requireAuth(expectedRole = null) {
  const token = storage.getItem('nityaseva_token');
  const role = storage.getItem('nityaseva_role');

  if (!token) {
    window.location.href = 'index.html';
    return null;
  }

  const profile = getCurrentUserProfile();

  if (expectedRole && role !== expectedRole && role !== 'admin') {
    alert('Access restricted to ' + expectedRole + ' role.');
    window.location.href = role + '.html';
    return null;
  }

  return profile;
}

export function signOut() {
  storage.removeItem('nityaseva_token');
  storage.removeItem('nityaseva_role');
  storage.removeItem('nityaseva_user');
  window.location.href = 'index.html';
}
