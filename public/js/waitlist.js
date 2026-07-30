// Casten — waitlist signup (Lovable Cloud backend).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://grsqzaesykqsiqamdxgt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_InUXVnCEzZaCAEX3HguA5w_xTGB_Fh_'

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const form = document.getElementById('waitlist-form')
const input = document.getElementById('waitlist-email')
const button = document.getElementById('waitlist-submit')
const msg = document.getElementById('waitlist-msg')

function say(text, ok) {
  msg.textContent = text
  msg.style.color = ok ? 'var(--teal)' : '#ff8a8a'
}

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = (input.value || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      say('Please enter a valid email address.', false)
      return
    }
    button.disabled = true
    const original = button.textContent
    button.textContent = 'Joining…'
    const { error } = await db
      .from('waitlist')
      .insert({ email, source: 'ai-hacker-simulator' })
    button.disabled = false
    button.textContent = original
    if (error) {
      if (error.code === '23505') {
        say("You're already on the list — we'll be in touch.", true)
        input.value = ''
      } else {
        say('Something went wrong. Please try again.', false)
      }
      return
    }
    input.value = ''
    say("You're on the waitlist. We'll email you when it opens.", true)
  })
}
