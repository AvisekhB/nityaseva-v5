
import { CONFIG } from './config.js';

// Ensure the window has the library
if (!window.supabase) {
  console.error("Supabase SDK not loaded! Check your script tag in HTML.");
}

// Revised initialization
const { createClient } = window.supabase;

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

