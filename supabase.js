const SUPABASE_URL = "https://daxrirnhbcfpqzswjofl.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_ZQSOJjMvm6ypIfe3dOQBdw_qFcEorrb";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);