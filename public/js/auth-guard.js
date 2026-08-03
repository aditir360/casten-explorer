import { supabase } from "./casten-auth.js";

export async function requireAuth() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    const here = location.pathname.split('/').pop() || 'dashboard.html';
    window.location.href = 'login.html?next=' + encodeURIComponent(here);
    return null;
  }
  return data.session;
}
