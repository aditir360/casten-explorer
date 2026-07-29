// Casten — shared auth module.
//
// Loaded on every page as: <script type="module" src="js/casten-auth.js"></script>
// Uses Supabase's hosted JS client straight from a CDN, so this works with
// plain static HTML — no npm, no build step, no bundler.
//
// IMPORTANT: fill in your own project's values below. Find them in
// Supabase Dashboard → Project Settings → API.
// This is the anon/public key — it's safe to expose in frontend code,
// that's what it's designed for (Row Level Security does the real
// protection, see supabase/schema.sql).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://qozeyxbjcfubdsddxwjl.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qeradWODupKRi1Fa2fDENQ_i7uiNSGf'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

/**
 * Call this at the top of any page that should be members-only
 * (scan.html, family.html, education.html). Redirects to login.html if
 * signed out, remembering where to send the user back afterwards.
 */
export async function requireAuth() {
  const session = await getSession()
  if (!session) {
    const here = location.pathname.split('/').pop() || 'index.html'
    location.href = `login.html?next=${encodeURIComponent(here)}`
    return null
  }
  return session
}

/**
 * Call this on every page to keep the nav in sync with auth state:
 * shows "Log in" + "Sign up" when signed out, or a greeting + "Log out"
 * when signed in.
 */
export async function wireAuthNav() {
  const session = await getSession()
  const cta = document.querySelector('.nav-cta')
  const loginLink = document.getElementById('nav-login-link')
  if (!cta) return

  if (session) {
    let name = session.user.email
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', session.user.id)
        .single()
      if (profile?.name) name = profile.name.split(' ')[0]
    } catch (_) {
      // profile row may not exist yet — fall back to email, that's fine
    }

    if (loginLink) {
      loginLink.textContent = `Hi, ${name}`
      loginLink.removeAttribute('href')
      loginLink.style.cursor = 'default'
    }

    cta.textContent = 'Log out'
    cta.href = '#'
    cta.onclick = async (e) => {
      e.preventDefault()
      await supabase.auth.signOut()
      location.href = 'index.html'
    }
  } else {
    if (loginLink) {
      loginLink.textContent = 'Log in'
      loginLink.href = 'login.html'
    }
    cta.textContent = 'Sign up'
    cta.href = 'signup.html'
    cta.onclick = null
  }
}

wireAuthNav()
