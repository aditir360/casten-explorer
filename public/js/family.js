// Casten — Family Network (real backend, Lovable Cloud).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = 'https://grsqzaesykqsiqamdxgt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_InUXVnCEzZaCAEX3HguA5w_xTGB_Fh_'

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const STORE_KEY = 'casten.family.code'
const $ = (id) => document.getElementById(id)

const ICON = {
  owner: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  senior: '<path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M6 21v-2a5 5 0 0 1 5-5h1"/><path d="M17 14v7"/><path d="M17 14a3 3 0 0 0-3 3"/>',
  child: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M9 8h.01"/><path d="M15 8h.01"/>',
  guardian: '<path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6l-7-3Z"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  danger: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  key: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="m10 13 8-8"/><path d="m15 5 2 2"/><path d="m18 8 2-2"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
}
const icon = (name, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ICON.info}</svg>`

const MODE_LABEL = { standard: 'Standard', senior_shield: 'Senior Shield', junior_guard: 'Junior Guard' }
const ROLE_LABEL = { owner: 'Owner', guardian: 'Guardian', senior: 'Senior', child: 'Child' }

let state = { code: null, network: null, members: [], events: [] }

function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}
function status(el, text, ok) {
  if (!el) return
  el.textContent = text || ''
  el.style.color = ok ? 'var(--teal)' : '#ff8a8a'
}

async function rpc(fn, args, msgEl) {
  status(msgEl, '', true)
  const { data, error } = await db.rpc(fn, args)
  if (error) {
    status(msgEl, error.message.replace(/^.*?:\s*/, '') || 'Something went wrong.', false)
    return null
  }
  if (!data) {
    status(msgEl, 'No network found for that code.', false)
    return null
  }
  return data
}

function apply(snapshot) {
  state.network = snapshot.network
  state.members = snapshot.members || []
  state.events = snapshot.events || []
  state.code = snapshot.network.join_code
  localStorage.setItem(STORE_KEY, state.code)
  render()
}

function render() {
  const setup = $('family-setup')
  const dash = $('family-dash')
  if (!state.network) {
    setup.style.display = ''
    dash.style.display = 'none'
    return
  }
  setup.style.display = 'none'
  dash.style.display = ''

  $('net-code').textContent = state.network.join_code
  $('net-owner').textContent = `${state.network.owner_name} · ${state.members.length}/6 members`

  $('member-list').innerHTML = state.members
    .map(
      (m) => `
      <div class="member-card">
        <div style="display:flex;align-items:center;gap:0.9rem;min-width:0;">
          <div class="member-avatar">${icon(m.role === 'owner' ? 'owner' : m.role === 'senior' ? 'senior' : m.role === 'child' ? 'child' : 'guardian', 18)}</div>
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:500;color:var(--white);">${esc(m.name)}${m.role === 'owner' ? ' <span style="color:var(--white-muted);font-weight:400;">(you)</span>' : ''}</div>
            <div style="font-size:11px;color:var(--white-dim);overflow:hidden;text-overflow:ellipsis;">${esc(m.email || ROLE_LABEL[m.role] || m.role)}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.6rem;flex-shrink:0;">
          <select class="mode-select" data-id="${m.id}" aria-label="Protection mode">
            ${Object.entries(MODE_LABEL)
              .map(([v, l]) => `<option value="${v}" ${m.mode === v ? 'selected' : ''}>${l}</option>`)
              .join('')}
          </select>
          ${m.role === 'owner' ? '' : `<button class="icon-btn" data-remove="${m.id}" title="Remove ${esc(m.name)}">${icon('trash', 15)}</button>`}
        </div>
      </div>`,
    )
    .join('')

  $('member-select').innerHTML = state.members
    .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
    .join('')

  $('feed').innerHTML = state.events.length
    ? state.events
        .map(
          (e) => `
        <div class="feed-item">
          <div class="feed-icon feed-${e.severity}">${icon(e.severity === 'danger' ? 'danger' : e.severity === 'warning' ? 'alert' : 'shield', 15)}</div>
          <div>
            <div style="font-size:13px;font-weight:500;color:var(--white);margin-bottom:0.25rem;">${esc(e.title)}</div>
            ${e.detail ? `<div style="font-size:12px;color:var(--white-dim);line-height:1.6;">${esc(e.detail)}</div>` : ''}
            <div style="font-size:10px;color:var(--white-muted);margin-top:0.4rem;letter-spacing:0.05em;">${ago(e.created_at)}</div>
          </div>
        </div>`,
        )
        .join('')
    : '<div style="font-size:12px;color:var(--white-dim);padding:1rem 0;">No activity yet.</div>'
}

// ---- wiring -------------------------------------------------------------
function wire() {
  $('create-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = $('create-msg')
    const data = await rpc(
      'family_create_network',
      { _owner_name: $('create-name').value.trim(), _owner_email: $('create-email').value.trim() },
      msg,
    )
    if (data) apply(data)
  })

  $('join-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = $('join-msg')
    const data = await rpc('family_snapshot', { _code: $('join-code-input').value.trim().toUpperCase() }, msg)
    if (data) apply(data)
  })

  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = $('add-msg')
    const data = await rpc(
      'family_add_member',
      {
        _code: state.code,
        _name: $('add-name').value.trim(),
        _email: $('add-email').value.trim(),
        _role: $('add-role').value,
        _mode: $('add-mode').value,
      },
      msg,
    )
    if (data) {
      $('add-name').value = ''
      $('add-email').value = ''
      status(msg, 'Member added.', true)
      apply(data)
    }
  })

  $('threat-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const msg = $('threat-msg')
    const data = await rpc(
      'family_log_threat',
      {
        _code: state.code,
        _member_id: $('member-select').value || null,
        _title: $('threat-title').value.trim(),
        _detail: $('threat-detail').value.trim(),
        _severity: $('threat-severity').value,
      },
      msg,
    )
    if (data) {
      $('threat-title').value = ''
      $('threat-detail').value = ''
      status(msg, 'Alert shared with the network.', true)
      apply(data)
    }
  })

  $('member-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove]')
    if (!btn) return
    const data = await rpc('family_remove_member', { _code: state.code, _member_id: btn.dataset.remove }, $('add-msg'))
    if (data) apply(data)
  })

  $('member-list').addEventListener('change', async (e) => {
    const sel = e.target.closest('.mode-select')
    if (!sel) return
    const data = await rpc('family_set_mode', { _code: state.code, _member_id: sel.dataset.id, _mode: sel.value }, $('add-msg'))
    if (data) apply(data)
  })

  $('copy-code').addEventListener('click', async () => {
    await navigator.clipboard.writeText(state.code)
    const b = $('copy-code')
    b.textContent = 'Copied'
    setTimeout(() => (b.textContent = 'Copy code'), 1800)
  })

  $('leave-network').addEventListener('click', () => {
    localStorage.removeItem(STORE_KEY)
    state = { code: null, network: null, members: [], events: [] }
    render()
  })
}

async function boot() {
  wire()
  const saved = localStorage.getItem(STORE_KEY)
  if (saved) {
    const { data } = await db.rpc('family_snapshot', { _code: saved })
    if (data) {
      apply(data)
      return
    }
    localStorage.removeItem(STORE_KEY)
  }
  render()
}

boot()
