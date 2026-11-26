import { CONFIG } from './config.js';

// Double check that these exist before passing to Supabase
if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
  console.error("Supabase config is missing!", CONFIG);
}

export const supabase = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);
