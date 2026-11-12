/* OmniPost staff console: a design prototype of the super admin screens.
 * Every route, field and rule here comes from backend/app/api/v1/admin and
 * backend/app/schemas/admin.py. Every figure is sample data. Nothing is sent:
 * each change slip names the request the live console will make instead. */
(() => {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => Number(v).toLocaleString('en-GB');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = (iso) => { const t = new Date(iso); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
  const dt = (iso) => { const t = new Date(iso); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}, ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`; };
  const short = (iso) => { const t = new Date(iso); return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`; };
  const limitText = (v) => (v === null || v === undefined ? 'Unlimited' : n(v));
  const valueText = (f, v) => (!v || !v.enabled ? 'Off' : f.type === 'limit' ? limitText(v.limit) : 'On');

  // ── Sample data (shapes from schemas/admin.py) ─────────────────────
  const F = (key, name, category, type, description, global = true) => ({ key, name, category, type, description, global });
  const FEATURES = [
    F('facebook_publishing', 'Facebook publishing', 'Publishing', 'boolean', 'Connect Facebook pages and publish to them.'),
    F('instagram_publishing', 'Instagram publishing', 'Publishing', 'boolean', 'Connect Instagram business accounts and publish to them.'),
    F('linkedin_publishing', 'LinkedIn publishing', 'Publishing', 'boolean', 'Connect LinkedIn profiles and pages and publish to them.'),
    F('scheduling', 'Scheduling and calendar', 'Publishing', 'boolean', 'Schedule posts for a later time and see them on the calendar.'),
    F('max_social_accounts', 'Connected social accounts', 'Publishing', 'limit', 'How many social accounts the workspace can connect.'),
    F('caption_templates', 'Smart Templates', 'Content', 'boolean', 'Use the caption template library when writing a post.'),
    F('approval_workflow', 'Approval workflow', 'Content', 'boolean', 'Require a second person to approve a post before it is published.'),
    F('max_posts_per_month', 'Posts per month', 'Content', 'limit', 'How many posts the workspace can create in a calendar month.'),
    F('max_brands', 'Brands', 'Workspace', 'limit', 'How many brands the workspace can manage.'),
    F('max_members', 'Team members', 'Workspace', 'limit', 'How many people can belong to the workspace.'),
    F('usage_export', 'Usage export', 'Workspace', 'boolean', 'Download the workspace’s usage as a file.'),
    F('video_uploads', 'Video uploads', 'Media', 'boolean', 'Attach videos to posts (images are always allowed).'),
    F('max_storage_mb', 'Media storage (MB)', 'Media', 'limit', 'Total size of uploaded media the workspace can keep, in megabytes.'),
    F('ai_captions', 'AI captions', 'AI', 'boolean', 'Generate captions with AI.', false),
    F('max_ai_tokens_per_month', 'AI tokens per month', 'AI', 'limit', 'How many AI tokens the workspace can use in a calendar month.', false),
  ];
  const FBY = Object.fromEntries(FEATURES.map((f) => [f.key, f]));
  const CATEGORIES = [...new Set(FEATURES.map((f) => f.category))];

  const on = (limit) => ({ enabled: true, limit: limit === undefined ? null : limit });
  const off = () => ({ enabled: false, limit: null });
  const PLANS = [
    { id: 'p-founding', key: 'founding', name: 'Founding', description: 'Early customers. Everything, no limits.', is_default: true, is_active: true, workspace_count: 104,
      values: Object.fromEntries(FEATURES.map((f) => [f.key, on(null)])) },
    { id: 'p-free', key: 'free', name: 'Free', description: 'One brand, a few posts a month.', is_default: false, is_active: true, workspace_count: 16,
      values: { facebook_publishing: on(), instagram_publishing: on(), linkedin_publishing: off(), scheduling: on(), max_social_accounts: on(3),
        caption_templates: on(), approval_workflow: off(), max_posts_per_month: on(30), max_brands: on(1), max_members: on(2),
        usage_export: off(), video_uploads: off(), max_storage_mb: on(500), ai_captions: off(), max_ai_tokens_per_month: off() } },
    { id: 'p-pro', key: 'pro', name: 'Pro', description: 'Teams with several brands and an approval step.', is_default: false, is_active: true, workspace_count: 8,
      values: { facebook_publishing: on(), instagram_publishing: on(), linkedin_publishing: on(), scheduling: on(), max_social_accounts: on(10),
        caption_templates: on(), approval_workflow: on(), max_posts_per_month: on(300), max_brands: on(5), max_members: on(10),
        usage_export: on(), video_uploads: on(), max_storage_mb: on(10240), ai_captions: on(), max_ai_tokens_per_month: on(100000) } },
  ];
  const PBY = Object.fromEntries(PLANS.map((p) => [p.key, p]));

  const W = (id, name, plan, owner, email, members, status, created, extra = {}) => ({
    id, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), plan_key: plan, owner_name: owner, owner_email: email,
    member_count: members, status, created_at: created, allow_self_approval: false, overrides: {}, ...extra,
  });
  const WORKSPACES = [
    W('w6', 'Example Coffee House', 'free', 'Rohan Mehta', 'rohan@example.com', 2, 'active', '2026-09-02T08:00:00Z',
      { usage: { posts_month_logged: 52, posts_month_table: 64, posts_created: 71, posts_published: 66, uploaded: 410, stored: 486, brands: 1, accounts: 3 } }),
    W('w9', 'Example Travel', 'free', 'Imran Shaikh', 'imran@example.com', 2, 'suspended', '2026-08-21T08:00:00Z',
      { suspended_at: '2026-11-04T12:20:00Z', suspended_reason: 'Connected four accounts after the free limit was lowered to three. Paused until the owner picks a plan.',
        usage: { posts_month_logged: 6, posts_month_table: 6, posts_created: 18, posts_published: 15, uploaded: 120, stored: 260, brands: 1, accounts: 4 } }),
    W('w2', 'Example Dental Clinic', 'pro', 'Priya Nair', 'priya@example.com', 6, 'active', '2026-07-14T08:00:00Z',
      { usage: { posts_month_logged: 118, posts_month_table: 121, posts_created: 160, posts_published: 148, uploaded: 2300, stored: 6100, brands: 3, accounts: 7 } }),
    W('w1', 'Example Bakery', 'free', 'Asha Kulkarni', 'asha@example.com', 2, 'active', '2026-10-01T08:00:00Z',
      { overrides: { max_social_accounts: { enabled: true, limit: 5, expires_at: '2026-11-30T23:59:00Z', reason: 'Opening a second shop this month. Five accounts until month end.', by: 'Sample Staff', updated_at: '2026-11-12T08:15:00Z' } },
        usage: { posts_month_logged: 21, posts_month_table: 21, posts_created: 28, posts_published: 26, uploaded: 180, stored: 240, brands: 1, accounts: 4 } }),
    W('w4', 'Example Realty', 'pro', 'Neha Joshi', 'neha@example.com', 4, 'suspended', '2026-06-30T08:00:00Z',
      { suspended_at: '2026-11-12T09:41:00Z', suspended_reason: 'Posting the same promotion to 40 pages a day. Paused while we talk to the owner.',
        usage: { posts_month_logged: 240, posts_month_table: 240, posts_created: 290, posts_published: 288, uploaded: 3100, stored: 7400, brands: 5, accounts: 10 } }),
    W('w3', 'Example Fitness Studio', 'founding', 'Kabir Singh', 'kabir@example.com', 3, 'active', '2026-05-18T08:00:00Z',
      { usage: { posts_month_logged: 40, posts_month_table: 40, posts_created: 52, posts_published: 50, uploaded: 900, stored: 2100, brands: 2, accounts: 5 } }),
    W('w7', 'Example Law Office', 'pro', 'Meera Iyer', 'meera@example.com', 5, 'active', '2026-04-09T08:00:00Z',
      { usage: { posts_month_logged: 14, posts_month_table: 14, posts_created: 20, posts_published: 18, uploaded: 60, stored: 300, brands: 1, accounts: 2 } }),
    W('w5', 'Example Florist', 'founding', 'Sara Thomas', 'sara@example.com', 2, 'active', '2026-03-27T08:00:00Z',
      { usage: { posts_month_logged: 30, posts_month_table: 30, posts_created: 38, posts_published: 37, uploaded: 640, stored: 1500, brands: 1, accounts: 3 } }),
    W('w8', 'Example School', 'founding', 'Vikram Desai', 'vikram@example.com', 8, 'active', '2026-02-11T08:00:00Z',
      { usage: { posts_month_logged: 26, posts_month_table: 26, posts_created: 34, posts_published: 30, uploaded: 1200, stored: 3800, brands: 2, accounts: 4 } }),
    W('w10', 'Example Salon', 'pro', 'Arjun Patil', 'arjun@example.com', 3, 'active', '2026-01-20T08:00:00Z',
      { usage: { posts_month_logged: 44, posts_month_table: 44, posts_created: 60, posts_published: 57, uploaded: 800, stored: 2600, brands: 2, accounts: 6 } }),
  ];
  const WBY = Object.fromEntries(WORKSPACES.map((w) => [w.id, w]));

  const U = (id, name, email, ws, extra = {}) => ({ id, full_name: name, email, is_active: true, platform_role: null, workspace_ids: ws, last_login_at: '2026-11-11T17:00:00Z', created_at: '2026-06-01T08:00:00Z', ...extra });
  const USERS = [
    U('u0', 'Sample Staff', 'staff@example.com', [], { platform_role: 'super_admin', last_login_at: '2026-11-12T08:02:00Z', created_at: '2026-01-02T08:00:00Z' }),
    U('u1', 'Asha Kulkarni', 'asha@example.com', ['w1'], { last_login_at: '2026-11-12T07:40:00Z', created_at: '2026-10-01T08:00:00Z' }),
    U('u2', 'Priya Nair', 'priya@example.com', ['w2'], { last_login_at: '2026-11-11T19:12:00Z', created_at: '2026-07-14T08:00:00Z' }),
    U('u3', 'Kabir Singh', 'kabir@example.com', ['w3'], { last_login_at: '2026-11-09T09:30:00Z', created_at: '2026-05-18T08:00:00Z' }),
    U('u4', 'Neha Joshi', 'neha@example.com', ['w4'], { last_login_at: '2026-11-12T09:02:00Z', created_at: '2026-06-30T08:00:00Z' }),
    U('u5', 'Rohan Mehta', 'rohan@example.com', ['w6'], { last_login_at: '2026-11-12T06:55:00Z', created_at: '2026-09-02T08:00:00Z' }),
    U('u6', 'Meera Iyer', 'meera@example.com', ['w7'], { last_login_at: null, created_at: '2026-11-11T16:30:00Z', pending_link: { purpose: 'account_setup', created_at: '2026-11-11T16:30:00Z', expires_at: '2026-11-13T16:30:00Z' } }),
    U('u7', 'Imran Shaikh', 'imran@example.com', ['w9'], { last_login_at: '2026-11-03T10:10:00Z', created_at: '2026-08-21T08:00:00Z' }),
    U('u8', 'Dev Malhotra', 'dev@example.com', ['w2', 'w10'], { last_login_at: '2026-10-02T11:00:00Z', created_at: '2026-07-20T08:00:00Z', is_active: false }),
    U('u9', 'Vikram Desai', 'vikram@example.com', ['w8'], { last_login_at: '2026-11-10T13:45:00Z', created_at: '2026-02-11T08:00:00Z' }),
  ];
  const UBY = Object.fromEntries(USERS.map((u) => [u.id, u]));

  const A = (id, at, actor, staff, action, type, label, ws, reason, changes = null, ip = '203.0.113.24') => ({ id, created_at: at, user_name: actor, staff, action, entity_type: type, entity_label: label, workspace_id: ws, reason, changes, ip_address: ip });
  const AUDIT = [
    A('a1', '2026-11-12T09:41:00Z', 'Sample Staff', true, 'SUSPEND', 'Workspace', 'Example Realty', 'w4', 'Posting the same promotion to 40 pages a day. Paused while we talk to the owner.', { status: ['active', 'suspended'] }),
    A('a2', '2026-11-12T08:15:00Z', 'Sample Staff', true, 'FEATURE_CHANGE', 'WorkspaceFeatureOverride', 'Example Bakery, connected social accounts', 'w1', 'Opening a second shop this month. Five accounts until month end.', { limit: ['3 (plan)', '5'], expires_at: ['none', '30 Nov 2026'] }),
    A('a3', '2026-11-11T18:02:00Z', 'Sample Staff', true, 'PLAN_CHANGE', 'Workspace', 'Example Law Office', 'w7', 'Upgraded on the owner’s request by phone.', { plan: ['free', 'pro'] }),
    A('a4', '2026-11-11T16:30:00Z', 'Sample Staff', true, 'SETUP_LINK', 'User', 'meera@example.com', null, 'Lost the first link and asked for a new one by email.', null),
    A('a5', '2026-11-11T12:10:00Z', 'Sample Staff', true, 'SETTING_CHANGE', 'PlatformSetting', 'setup_link_hours', null, 'Owners in other time zones missed the 24 hour window.', { value: ['24', '48'] }),
    A('a6', '2026-11-11T10:05:00Z', 'Asha Kulkarni', false, 'PUBLISH', 'Post', 'Weekend sourdough', 'w1', null, null, '198.51.100.7'),
    A('a7', '2026-11-10T15:20:00Z', 'Priya Nair', false, 'APPROVE', 'Post', 'Floss reminder', 'w2', null, null, '198.51.100.30'),
    A('a8', '2026-11-10T11:00:00Z', 'Sample Staff', true, 'VIEW', 'Post', 'Example Coffee House, Diwali menu', 'w6', null, null),
    A('a9', '2026-11-09T17:45:00Z', 'Sample Staff', true, 'CREATE', 'CaptionTemplate', 'Festive offer', null, 'Diwali set for retail customers.', { title: ['', 'Festive offer'], industry: ['', 'retail'] }),
    A('a10', '2026-11-09T09:30:00Z', 'Sample Staff', true, 'FORCE_LOGOUT', 'User', 'kabir@example.com', null, 'Owner reported a lost phone.', { sessions_ended: ['', '3'] }),
    A('a11', '2026-11-08T14:00:00Z', 'Sample Staff', true, 'OWNERSHIP_TRANSFER', 'Workspace', 'Example School', 'w8', 'The founder left; the principal takes over the account.', { owner: ['founder@example.com', 'vikram@example.com'] }),
  ];
  const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'PUBLISH', 'SUBMIT', 'APPROVE', 'REJECT', 'SCHEDULE', 'CONNECT', 'DISCONNECT', 'INVITE', 'ROLE_CHANGE', 'VIEW', 'SUSPEND', 'REACTIVATE', 'PLAN_CHANGE', 'FEATURE_CHANGE', 'SETTING_CHANGE', 'OWNERSHIP_TRANSFER', 'SETUP_LINK', 'FORCE_LOGOUT', 'ALERT_UPDATE'];
  const ACTION_TEXT = { CREATE: 'created', UPDATE: 'updated', DELETE: 'removed', PUBLISH: 'published', SUBMIT: 'submitted', APPROVE: 'approved', REJECT: 'rejected', SCHEDULE: 'scheduled', CONNECT: 'connected', DISCONNECT: 'disconnected', INVITE: 'invited', ROLE_CHANGE: 'changed the role on', VIEW: 'opened', SUSPEND: 'suspended', REACTIVATE: 'reactivated', PLAN_CHANGE: 'changed the plan of', FEATURE_CHANGE: 'changed a feature on', SETTING_CHANGE: 'changed the setting', OWNERSHIP_TRANSFER: 'transferred ownership of', SETUP_LINK: 'issued a setup link for', FORCE_LOGOUT: 'signed out every session of', ALERT_UPDATE: 'updated an alert on' };

  const TEMPLATES = [
    { id: 't1', industry: 'bakery', category: 'promotional', title: 'Fresh from the oven', template_text: 'Our {product} came out of the oven at {time}. Come early, it goes fast.\n\n{cta}', suggested_hashtags: ['#freshbread', '#bakery', '#localbakery'], suggested_cta: 'Order on WhatsApp', is_active: true },
    { id: 't2', industry: 'dental', category: 'educational', title: 'Two-minute brushing', template_text: 'Most people brush for under a minute. Two minutes, twice a day, keeps {problem} away.\n\nBook a check-up: {cta}', suggested_hashtags: ['#dentalcare', '#oralhealth'], suggested_cta: 'Book a check-up', is_active: true },
    { id: 't3', industry: 'fitness', category: 'engagement', title: 'Which class next week?', template_text: 'We are planning next week’s timetable. {option_a} or {option_b}? Tell us in the comments.', suggested_hashtags: ['#fitness', '#workout'], suggested_cta: null, is_active: true },
    { id: 't4', industry: 'retail', category: 'seasonal', title: 'Festive offer', template_text: '{festival} is here. {discount} off {range} until {end_date}.\n\n{cta}', suggested_hashtags: ['#festiveoffer', '#shoplocal'], suggested_cta: 'Visit the store', is_active: true },
    { id: 't5', industry: 'restaurant', category: 'promotional', title: 'Weekend special', template_text: 'This weekend only: {dish}, made with {ingredient}. Tables fill by eight.', suggested_hashtags: ['#weekendspecial', '#foodie'], suggested_cta: 'Reserve a table', is_active: false },
    { id: 't6', industry: 'real estate', category: 'promotional', title: 'New listing', template_text: 'Just listed in {area}: {bedrooms} bedrooms, {size} sq ft, {price}.\n\n{cta}', suggested_hashtags: ['#newlisting', '#realestate'], suggested_cta: 'Book a visit', is_active: true },
  ];

  const SETTINGS = [
    { key: 'setup_link_hours', value: 48, value_type: 'integer', default: 48, minimum: 1, maximum: 720, description: 'How long a “set your password” link stays valid, in hours.', updated_at: '2026-11-11T12:10:00Z' },
  ];

  const OVERVIEW = { workspaces_total: 128, workspaces_suspended: 3, users_total: 342, users_active: 296, users_signed_in_last_30_days: 211, posts_total: 9420, posts_created_last_30_days: 2310, posts_published_last_30_days: 1840, jobs_failed: 7, jobs_needing_review: 3, open_alerts: 0, database_role: 'omnipost_admin' };

  // ── Rules the backend applies ──────────────────────────────────────
  function resolve(ws) {
    const plan = PBY[ws.plan_key];
    return FEATURES.map((f) => {
      const pv = plan.values[f.key] || off();
      const ov = ws.overrides[f.key];
      let enabled = pv.enabled, limit = pv.limit, source = pv.enabled ? 'plan' : 'none';
      if (ov) { enabled = ov.enabled; limit = ov.limit; source = 'override'; }
      if (!f.global) { enabled = false; source = 'global_off'; }
      return { f, plan: pv, enabled, limit, source, override: ov };
    });
  }
  const effLimit = (ws, key) => resolve(ws).find((r) => r.f.key === key);

  function usageRow(ws) {
    const u = ws.usage;
    const over = [];
    const checks = [['max_posts_per_month', u.posts_month_table], ['max_social_accounts', u.accounts], ['max_brands', u.brands], ['max_members', ws.member_count], ['max_storage_mb', u.stored]];
    checks.forEach(([key, used]) => { const r = effLimit(ws, key); if (r.enabled && r.limit !== null && used > r.limit) over.push({ key, used, limit: r.limit }); });
    return { ws, ...u, over, mismatch: u.posts_month_table > u.posts_month_logged };
  }
  const USAGE = WORKSPACES.map(usageRow);
  const PROBLEMS = USAGE.filter((r) => r.over.length || r.mismatch);

  // ── Prototype state switch ─────────────────────────────────────────
  let protoState = 'full';
  $$('input[name="proto-state"]').forEach((r) => r.addEventListener('change', () => { protoState = r.value; render(); }));

  function region(full, o = {}) {
    if (protoState === 'loading') {
      const rows = Array.from({ length: o.rows || 5 }, () => '<div><span></span><span></span><span></span><span></span></div>').join('');
      return `<div class="skel" aria-busy="true"><span class="visually-hidden">Loading ${esc(o.what || 'this list')}</span>${rows}</div>`;
    }
    if (protoState === 'empty') {
      return `<div class="state"><h3>${esc(o.empty?.[0] || 'Nothing here yet')}</h3><p>${esc(o.empty?.[1] || '')}</p>${o.emptyAction || ''}</div>`;
    }
    if (protoState === 'error') {
      return `<div class="state state--error" role="alert"><h3>Could not load ${esc(o.what || 'this list')}</h3><p>The admin API did not answer (${esc(o.path || '/api/v1/admin')}). Check that the backend is running, then try again.</p><button class="btn" type="button" data-retry>Try again</button></div>`;
    }
    return full;
  }

  // ── Router ─────────────────────────────────────────────────────────
  function route() {
    const raw = location.hash.replace(/^#/, '') || '/overview';
    const [path, qs] = raw.split('?');
    return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
  }
  function setQuery(base, params) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined && v !== false) q.set(k, v); });
    const s = q.toString();
    location.hash = base + (s ? `?${s}` : '');
  }

  const VIEWS = {};
  function render() {
    const { parts, q } = route();
    const name = parts[0] || 'overview';
    const view = VIEWS[name] || VIEWS.overview;
    const out = view(parts.slice(1), q);
    $('#main').innerHTML = out.html;
    $('#crumbs').innerHTML = out.crumbs.map((c, i) => (i === out.crumbs.length - 1
      ? `<li aria-current="page">${esc(c[0])}</li>`
      : `<li><a href="${c[1]}">${esc(c[0])}</a></li>`)).join('');
    document.title = `${out.crumbs[out.crumbs.length - 1][0]}, OmniPost staff console`;
    $$('[data-nav]').forEach((a) => (a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $('#nav-usage-count').textContent = PROBLEMS.length ? String(PROBLEMS.length) : '';
    $('#nav-usage-count').setAttribute('aria-label', `${PROBLEMS.length} workspaces to check`);
    out.after?.();
  }
  window.addEventListener('hashchange', () => { closeMenu(); render(); $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); });

  // ── Small builders ─────────────────────────────────────────────────
  const statusChip = (s) => (s === 'suspended' ? '<span class="chip chip--bad">Suspended</span>' : '<span class="chip chip--ok">Active</span>');
  const planChip = (k) => `<span class="chip">${esc(PBY[k]?.name || k)}</span>`;
  const head = (title, lede, actions = '', meta = '') => `
    <div class="head">
      <div class="head__text"><h1>${esc(title)}</h1>${lede ? `<p>${lede}</p>` : ''}${meta ? `<div class="head__meta">${meta}</div>` : ''}</div>
      ${actions ? `<div class="head__actions">${actions}</div>` : ''}
    </div>`;
  const select = (id, label, options, value, extra = '') => `
    <div class="field"><label for="${id}">${esc(label)}</label>
      <select class="select" id="${id}" ${extra}>${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </div>`;
  const sw = (id, label, checked, attrs = '') => `<button class="switch" type="button" role="switch" id="${id}" aria-checked="${checked}" ${attrs}><span class="switch__track" aria-hidden="true"></span>${esc(label)}</button>`;

  function overText(o) {
    const f = FBY[o.key];
    return `${f.name}: <span class="mono over">${n(o.used)}</span> of <span class="mono">${n(o.limit)}</span>`;
  }

  function trailItem(a, withWs = true) {
    const ws = a.workspace_id && withWs && !a.entity_label.includes(WBY[a.workspace_id].name) ? WBY[a.workspace_id] : null;
    const rows = a.changes ? Object.entries(a.changes).map(([k, [was, now]]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td class="was">${was ? `<span>${esc(was)}</span>` : ''}</td><td class="now">${esc(now)}</td></tr>`).join('') : '';
    return `<li>
      <time datetime="${a.created_at}">${dt(a.created_at)}</time>
      <div class="trail__body">
        <div class="trail__line"><b class="${a.staff ? 'person' : 'ink2'}">${esc(a.user_name)}</b><span>${esc(ACTION_TEXT[a.action])}</span><b class="ink2">${esc(a.entity_label)}</b>${a.staff ? '<span class="chip chip--person">Staff</span>' : ''}${ws ? `<a class="link small" href="#/workspaces/${ws.id}">${esc(ws.name)}</a>` : ''}</div>
        ${a.reason ? `<p class="trail__reason">${esc(a.reason)}</p>` : ''}
        ${rows ? `<details><summary>What changed</summary><table class="diff"><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${rows}</tbody></table></details>` : ''}
        <span class="meta"><span class="mono">${esc(a.action)}</span> on ${esc(a.entity_type)}, from <span class="mono">${esc(a.ip_address)}</span></span>
      </div>
    </li>`;
  }

  // ── Overview ───────────────────────────────────────────────────────
  VIEWS.overview = () => {
    const o = OVERVIEW;
    const readings = `
      <dl class="readings">
        <div class="reading"><dt>Workspaces</dt><dd>${n(o.workspaces_total)}</dd><p class="sub"><span class="mono">${o.workspaces_suspended}</span> suspended</p></div>
        <div class="reading"><dt>Logins</dt><dd>${n(o.users_total)}</dd><p class="sub"><span class="mono">${n(o.users_signed_in_last_30_days)}</span> signed in, 30 days</p></div>
        <div class="reading"><dt>Published, 30 days</dt><dd>${n(o.posts_published_last_30_days)}</dd><p class="sub">of <span class="mono">${n(o.posts_created_last_30_days)}</span> created</p></div>
        <div class="reading"><dt>Failed publishing jobs</dt><dd class="${o.jobs_failed ? 'is-bad' : ''}">${n(o.jobs_failed)}</dd><p class="sub"><span class="mono">${o.jobs_needing_review}</span> waiting for review</p></div>
        <div class="reading"><dt>Open alerts</dt><dd>${n(o.open_alerts)}</dd><p class="sub">Nightly check not built yet</p></div>
      </dl>`;
    const watch = PROBLEMS.map((r) => `
      <li>
        <div class="watch__what"><b><a class="link" href="#/workspaces/${r.ws.id}/usage">${esc(r.ws.name)}</a></b><span class="small muted">${esc(PBY[r.ws.plan_key].name)} plan, owner ${esc(r.ws.owner_email)}</span></div>
        <div class="small ink2 watch__checks">${r.over.map((x) => `<div>${overText(x)}</div>`).join('')}${r.mismatch ? `<div>Posts this month: log <span class="mono">${r.posts_month_logged}</span>, table <span class="mono over">${r.posts_month_table}</span></div>` : ''}</div>
        <div>${r.over.length ? '<span class="chip chip--bad">Over a limit</span> ' : ''}${r.mismatch ? '<span class="chip chip--bad">Usage mismatch</span>' : ''}${r.ws.status === 'suspended' ? ' <span class="chip">Suspended</span>' : ''}</div>
      </li>`).join('');
    const max = Math.max(...PLANS.map((p) => p.workspace_count));
    const bars = PLANS.map((p) => `<div><dt>${esc(p.name)}</dt><dd class="track"><span class="fill" style="--v:${(p.workspace_count / max).toFixed(3)}"></span></dd><dd class="val">${p.workspace_count}</dd></div>`).join('');
    const staff = AUDIT.filter((a) => a.staff).slice(0, 4).map((a) => trailItem(a)).join('');
    return {
      crumbs: [['Overview']],
      html: `
        ${head('What needs a look today', 'Workspaces over a limit or with usage the log did not record come first. Everything below is counted live from the database.')}
        ${region(readings, { what: 'the overview', path: 'GET /api/v1/admin/overview', rows: 2, empty: ['No customers yet', 'Workspaces and logins appear here once the first customer signs up.'] })}
        <div class="grid-2">
          <section class="panel" aria-labelledby="h-watch">
            <div class="panel__head"><h2 id="h-watch">Watchlist</h2><p>From the usage check, this calendar month</p></div>
            ${region(`<ul class="watch">${watch}</ul>`, { what: 'the watchlist', path: 'GET /api/v1/admin/usage?problems_only=true', rows: 3, empty: ['Every workspace is inside its limits', 'Nothing is over a limit and the usage log matches the posts table.'] })}
            <div class="panel__foot"><span>Over a limit means a limit was lowered after the fact, or a check is being bypassed.</span><a class="link" href="#/usage?problems=1">Open usage</a></div>
          </section>
          <section class="panel" aria-labelledby="h-plans">
            <div class="panel__head"><h2 id="h-plans">Workspaces by plan</h2><a class="link small" href="#/plans">Plans and limits</a></div>
            <div class="panel__body">${region(`<dl class="bars">${bars}</dl>`, { what: 'plan counts', rows: 3, empty: ['No workspaces yet', 'Counts per plan appear with the first workspace.'] })}</div>
          </section>
        </div>
        <section class="panel" aria-labelledby="h-staff">
          <div class="panel__head"><h2 id="h-staff">Latest staff actions</h2><a class="link small" href="#/audit?staff=1">Full audit trail</a></div>
          ${region(`<ol class="trail">${staff}</ol>`, { what: 'staff actions', path: 'GET /api/v1/admin/audit?staff_only=true', rows: 4, empty: ['No staff actions yet', 'Every change made from this console is listed here with its reason.'] })}
        </section>`,
    };
  };

  // ── Workspaces ─────────────────────────────────────────────────────
  VIEWS.workspaces = (rest, q) => (rest[0] ? workspaceDetail(rest[0], rest[1] || 'features', q) : workspaceList(q));

  function workspaceList(q) {
    const term = (q.get('q') || '').toLowerCase(), plan = q.get('plan') || '', status = q.get('status') || '';
    const rows = WORKSPACES.filter((w) => (!term || `${w.name} ${w.slug} ${w.owner_email}`.toLowerCase().includes(term)) && (!plan || w.plan_key === plan) && (!status || w.status === status));
    const filtered = term || plan || status;
    const table = rows.length ? `
      <div class="table-scroll"><table class="table">
        <thead><tr><th scope="col">Workspace</th><th scope="col">Owner</th><th scope="col">Plan</th><th scope="col" class="num">Members</th><th scope="col">Status</th><th scope="col">Created</th></tr></thead>
        <tbody>${rows.map((w) => `<tr data-href="#/workspaces/${w.id}">
          <td><div class="name"><a href="#/workspaces/${w.id}">${esc(w.name)}</a><span class="mono">${esc(w.slug)}</span></div></td>
          <td><div class="name"><span class="ink2 small">${esc(w.owner_name)}</span><span>${esc(w.owner_email)}</span></div></td>
          <td>${planChip(w.plan_key)}${Object.keys(w.overrides).length ? ' <span class="chip chip--person">Override</span>' : ''}</td>
          <td class="num">${w.member_count}</td>
          <td>${statusChip(w.status)}</td>
          <td class="mono cool">${d(w.created_at)}</td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="state"><h3>No workspace matches</h3><p>Nothing has that name, slug or owner email on the ${esc(plan || 'any')} plan. Clear the filters to see every workspace.</p><a class="btn" href="#/workspaces">Clear filters</a></div>`;
    return {
      crumbs: [['Workspaces']],
      html: `
        ${head('Workspaces', 'Every customer workspace. Workspaces are never deleted here: suspend one instead, so its posts and media stay.', '<button class="btn btn--primary" type="button" data-act="new-workspace">New workspace</button>')}
        <form class="toolbar" id="ws-filter" role="search" aria-label="Filter workspaces">
          <div class="field field--grow"><label for="f-q">Name, slug or owner email</label><input class="input" id="f-q" name="q" type="search" value="${esc(q.get('q') || '')}" autocomplete="off"></div>
          ${select('f-plan', 'Plan', [['', 'Any plan'], ...PLANS.map((p) => [p.key, p.name])], plan, 'name="plan"')}
          <fieldset class="seg end"><legend>Status</legend>
            ${[['', 'All'], ['active', 'Active'], ['suspended', 'Suspended']].map(([v, t], i) => `<input type="radio" name="status" id="fs-${i}" value="${v}"${status === v ? ' checked' : ''}><label for="fs-${i}">${t}</label>`).join('')}
          </fieldset>
        </form>
        <section class="panel" aria-label="Workspace list">
          ${region(table, { what: 'workspaces', path: 'GET /api/v1/admin/workspaces', rows: 8, empty: ['No workspaces yet', 'Create the first one for a customer, or wait for someone to sign up.'], emptyAction: '<button class="btn btn--primary" type="button" data-act="new-workspace">New workspace</button>' })}
          <div class="panel__foot"><span>${filtered ? `${rows.length} of the sample rows match` : `${rows.length} sample rows of ${n(OVERVIEW.workspaces_total)}, newest first`}</span>
            <div class="pager"><button class="btn" type="button" disabled>Previous</button><span class="mono small">Page 1</span><button class="btn" type="button" disabled>Next</button></div></div>
        </section>`,
      after() {
        const f = $('#ws-filter');
        const apply = () => setQuery('/workspaces', { q: f.q.value.trim(), plan: f.plan.value, status: f.status.value });
        f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
        f.plan.addEventListener('change', apply);
        $$('input[name="status"]', f).forEach((r) => r.addEventListener('change', apply));
      },
    };
  }

  function membersOf(ws) {
    const owner = USERS.find((u) => u.email === ws.owner_email);
    const list = [{ user: owner || { id: 'x', full_name: ws.owner_name, email: ws.owner_email, is_active: true }, role: 'owner', joined: ws.created_at }];
    USERS.filter((u) => u !== owner && u.workspace_ids.includes(ws.id)).forEach((u) => list.push({ user: u, role: 'admin', joined: u.created_at }));
    const extra = ['Office manager', 'Social media lead', 'Designer', 'Front desk', 'Marketing intern', 'Branch head', 'Copywriter'];
    for (let i = list.length; i < ws.member_count; i += 1) {
      const nm = extra[i % extra.length];
      list.push({ user: { id: `${ws.id}-m${i}`, full_name: nm, email: `${nm.toLowerCase().replace(/ /g, '.')}@example.com`, is_active: true }, role: 'member', joined: ws.created_at });
    }
    return list;
  }

  function workspaceDetail(id, tab, q) {
    const ws = WBY[id];
    if (!ws) {
      return { crumbs: [['Workspaces', '#/workspaces'], ['Not found']], html: `${head('Workspace not found', 'There is no workspace with that id. It may have been typed by hand.', '<a class="btn" href="#/workspaces">All workspaces</a>')}` };
    }
    const tabs = [['features', 'Features'], ['members', 'Members', ws.member_count], ['posts', 'Posts'], ['accounts', 'Brands and accounts'], ['usage', 'Usage'], ['activity', 'Activity']];
    const usage = usageRow(ws);
    const facts = `
      <dl class="facts panel">
        <div><dt>Owner</dt><dd>${esc(ws.owner_name)}<br><span class="small muted">${esc(ws.owner_email)}</span></dd></div>
        <div><dt>Plan</dt><dd>${esc(PBY[ws.plan_key].name)} <span class="mono small cool">${esc(ws.plan_key)}</span></dd></div>
        <div><dt>Content</dt><dd><span class="mono">${usage.brands}</span> ${usage.brands === 1 ? 'brand' : 'brands'}, <span class="mono">${n(usage.posts_created * 4)}</span> posts, <span class="mono">${usage.accounts}</span> social accounts</dd></div>
        <div><dt>Created</dt><dd class="mono cool">${d(ws.created_at)}</dd></div>
      </dl>`;
    const banner = ws.status === 'suspended' ? `<div class="note note--bad" role="status"><div><b>Suspended on ${d(ws.suspended_at)}.</b> “${esc(ws.suspended_reason)}” Members can sign in and read; nothing can be created or published until you reactivate it.</div></div>` : '';
    const actions = `
      <button class="btn" type="button" data-act="change-plan" data-id="${ws.id}">Change plan</button>
      <button class="btn" type="button" data-act="transfer" data-id="${ws.id}">Transfer ownership</button>
      ${ws.status === 'suspended' ? `<button class="btn btn--primary" type="button" data-act="reactivate" data-id="${ws.id}">Reactivate</button>` : `<button class="btn btn--bad" type="button" data-act="suspend" data-id="${ws.id}">Suspend</button>`}`;
    const body = ({ features: wsFeatures, members: wsMembers, posts: wsPosts, accounts: wsAccounts, usage: wsUsage, activity: wsActivity }[tab] || wsFeatures)(ws, q);
    return {
      crumbs: [['Workspaces', '#/workspaces'], [ws.name, `#/workspaces/${ws.id}`], [tabs.find((t) => t[0] === tab)?.[1] || 'Features']],
      html: `
        ${head(ws.name, '', actions, `<span class="mono cool">${esc(ws.slug)}</span>${statusChip(ws.status)}${planChip(ws.plan_key)}`)}
        ${banner}
        ${facts}
        <nav class="tabs" aria-label="Workspace sections">${tabs.map(([k, t, c]) => `<a href="#/workspaces/${ws.id}/${k}"${k === tab ? ' aria-current="page"' : ''}>${t}${c ? ` <span class="mono">${c}</span>` : ''}</a>`).join('')}</nav>
        ${body}`,
    };
  }

  function wsFeatures(ws) {
    const rows = resolve(ws);
    const table = `
      <div class="table-scroll"><table class="table">
        <thead><tr><th scope="col">Feature</th><th scope="col">Their plan gives</th><th scope="col">They get now</th><th scope="col">Decided by</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>${CATEGORIES.map((c) => `<tr class="group"><td colspan="5">${esc(c)}</td></tr>${rows.filter((r) => r.f.category === c).map((r) => {
          const now = valueText(r.f, { enabled: r.enabled, limit: r.limit });
          const planV = valueText(r.f, r.plan);
          const changed = r.source === 'override' && now !== planV;
          const by = r.source === 'override'
            ? `<div class="name"><span><span class="chip chip--person">Override${r.override.expires_at ? ` until ${short(r.override.expires_at)}` : ''}</span></span><span>${esc(r.override.by)}: “${esc(r.override.reason)}”</span></div>`
            : r.source === 'global_off' ? '<span class="chip">Off for everyone</span>' : `<span class="chip">Plan</span>`;
          return `<tr>
            <td><div class="name"><span class="ink2">${esc(r.f.name)}</span><span class="mono">${esc(r.f.key)}</span></div></td>
            <td class="mono ${changed ? 'strike' : 'muted'}">${planV}</td>
            <td class="mono ${r.enabled ? '' : 'muted'}">${now}</td>
            <td>${by}</td>
            <td><div class="actions-cell">${r.source === 'override'
              ? `<button class="btn btn--ghost" type="button" data-act="override" data-id="${ws.id}" data-key="${r.f.key}">Edit</button><button class="btn btn--ghost btn--bad" type="button" data-act="remove-override" data-id="${ws.id}" data-key="${r.f.key}">Remove</button>`
              : `<button class="btn btn--ghost" type="button" data-act="override" data-id="${ws.id}" data-key="${r.f.key}"${r.source === 'global_off' ? ' disabled title="Switched off for everyone. Turn it on in Feature switches first."' : ''}>Override</button>`}</div></td></tr>`;
        }).join('')}`).join('')}</tbody>
      </table></div>`;
    return `<section class="panel" aria-labelledby="h-feat">
      <div class="panel__head"><h2 id="h-feat">What this workspace gets</h2><p>Global switch first, then an override, then the plan. Changes apply on their next request.</p></div>
      ${region(table, { what: 'features', path: `GET /api/v1/admin/workspaces/${ws.id}/features`, rows: 8, empty: ['No features registered', 'Features come from app/core/features.py and are created at startup.'] })}
    </section>`;
  }

  function wsMembers(ws) {
    const list = membersOf(ws);
    const table = `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Joined</th><th scope="col">Login</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
      <tbody>${list.map((m) => `<tr>
        <td><div class="name">${UBY[m.user.id] ? `<a href="#/users/${m.user.id}">${esc(m.user.full_name)}</a>` : `<span class="ink2">${esc(m.user.full_name)}</span>`}<span>${esc(m.user.email)}</span></div></td>
        <td>${m.role === 'owner' ? '<span class="chip chip--person">Owner</span>' : `<span class="chip">${m.role === 'admin' ? 'Admin' : 'Member'}</span>`}</td>
        <td class="mono cool">${d(m.joined)}</td>
        <td>${m.user.is_active ? '<span class="chip chip--ok">Active</span>' : '<span class="chip chip--bad">Deactivated</span>'}</td>
        <td><div class="actions-cell">${m.role === 'owner'
          ? '<button class="btn btn--ghost" type="button" disabled title="Transfer ownership to change the owner">Change role</button>'
          : `<button class="btn btn--ghost" type="button" data-act="member-role" data-id="${ws.id}" data-user="${esc(m.user.email)}" data-role="${m.role}">Change role</button><button class="btn btn--ghost btn--bad" type="button" data-act="member-remove" data-id="${ws.id}" data-user="${esc(m.user.email)}">Remove</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;
    const lim = effLimit(ws, 'max_members');
    return `<section class="panel" aria-labelledby="h-mem">
      <div class="panel__head"><h2 id="h-mem">Members</h2><div class="head__actions"><span class="small muted">Limit <span class="mono">${lim.enabled ? limitText(lim.limit) : 'Off'}</span></span><button class="btn" type="button" data-act="member-add" data-id="${ws.id}">Add member</button></div></div>
      ${region(table, { what: 'members', path: `GET /api/v1/admin/workspaces/${ws.id}/members`, rows: 4, empty: ['Only the owner so far', 'Add a login to this workspace, or let the owner invite their team.'] })}
    </section>`;
  }

  const POST_STATUS = { draft: ['Draft', ''], pending_approval: ['Waiting for approval', 'chip--person'], approved: ['Approved', 'chip--cool'], scheduled: ['Scheduled', 'chip--cool'], published: ['Published', 'chip--ok'], partially_published: ['Partly published', 'chip--bad'], failed: ['Failed', 'chip--bad'] };
  function wsPosts(ws, q) {
    const status = q.get('status') || '';
    const posts = [
      ['Diwali menu', 'Three sweets, one week only. Pre-order by Friday.', 'published', 2, null, '2026-11-10T09:00:00Z'],
      ['Weekend opening hours', 'Open till midnight this Saturday and Sunday.', 'scheduled', 1, '2026-11-14T06:30:00Z', null],
      ['New seasonal blend', 'Our winter blend is here: cardamom, jaggery and a little pepper.', 'pending_approval', 3, null, null],
      ['Staff pick', 'Meet the team behind the counter.', 'failed', 1, '2026-11-09T12:00:00Z', null],
      ['Loyalty card', 'Ten coffees, the eleventh is on us.', 'draft', 0, null, null],
    ].filter((p) => !status || p[2] === status);
    const author = ws.owner_email;
    const table = posts.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Post</th><th scope="col">Author</th><th scope="col">Status</th><th scope="col" class="num">Media</th><th scope="col">Scheduled or published</th></tr></thead>
      <tbody>${posts.map(([t, cap, s, m, sch, pub]) => `<tr><td><div class="name"><span class="ink2">${esc(t)}</span><span>${esc(cap)}</span></div></td><td class="small">${esc(author)}</td><td><span class="chip ${POST_STATUS[s][1]}">${POST_STATUS[s][0]}</span></td><td class="num">${m}</td><td class="mono cool">${pub ? dt(pub) : sch ? dt(sch) : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="state"><h3>No posts with that status</h3><p>Pick another status to see this workspace’s posts.</p></div>';
    return `<div class="note">Read-only. You can see this workspace’s posts but never write, approve or publish one. Opening a post is recorded in the audit trail as a staff view.</div>
      <form class="toolbar" id="post-filter">${select('pf-status', 'Status', [['', 'Any status'], ...Object.entries(POST_STATUS).map(([k, [t]]) => [k, t])], status, 'name="status"')}</form>
      <section class="panel" aria-label="Posts">${region(table, { what: 'posts', path: `GET /api/v1/admin/workspaces/${ws.id}/posts`, rows: 5, empty: ['No posts yet', 'This workspace has not written a post.'] })}</section>`;
  }

  function wsAccounts(ws) {
    const brands = [ws.name.replace('Example ', '')].concat(ws.usage.brands > 1 ? [`${ws.name.replace('Example ', '')} Express`] : []);
    const accounts = [
      ['Facebook', `${ws.name}`, 'page', true, false, '2027-01-08T00:00:00Z', '2026-10-02T08:00:00Z'],
      ['Instagram', `@${ws.slug.replace(/-/g, '')}`, 'business', true, true, '2026-11-10T00:00:00Z', '2026-10-02T08:10:00Z'],
      ['LinkedIn', `${ws.name}`, 'organisation', true, false, '2027-01-20T00:00:00Z', '2026-10-05T08:00:00Z'],
    ];
    return `<div class="grid-2">
      <section class="panel" aria-labelledby="h-acc">
        <div class="panel__head"><h2 id="h-acc">Connected social accounts</h2><p>Tokens are never shown: this console’s database role cannot read them.</p></div>
        ${region(`<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Account</th><th scope="col">Health</th><th scope="col">Token expires</th><th scope="col">Connected</th></tr></thead>
          <tbody>${accounts.map(([pl, name, type, , reauth, exp, con]) => `<tr><td><div class="name"><span class="ink2">${esc(name)}</span><span>${pl} ${type}</span></div></td><td>${reauth ? '<span class="chip chip--bad">Needs reconnecting</span>' : '<span class="chip chip--ok">Healthy</span>'}</td><td class="mono ${reauth ? 'over' : 'cool'}">${d(exp)}</td><td class="mono cool">${d(con)}</td></tr>`).join('')}</tbody></table></div>`,
          { what: 'social accounts', path: `GET /api/v1/admin/workspaces/${ws.id}/social-accounts`, rows: 3, empty: ['No accounts connected', 'The workspace has not connected Facebook, Instagram or LinkedIn yet.'] })}
      </section>
      <section class="panel" aria-labelledby="h-brands">
        <div class="panel__head"><h2 id="h-brands">Brands</h2></div>
        ${region(`<table class="table"><thead><tr><th scope="col">Brand</th></tr></thead><tbody>${brands.map((b) => `<tr><td class="ink2">${esc(b)}</td></tr>`).join('')}</tbody></table>`, { what: 'brands', path: `GET /api/v1/admin/workspaces/${ws.id}/brands`, rows: 2, empty: ['No brands yet', 'Brands are created by the workspace in the customer app.'] })}
      </section>
    </div>`;
  }

  function wsUsage(ws) {
    const r = usageRow(ws);
    const lim = (k) => effLimit(ws, k);
    const cell = (label, used, key, unit = '') => {
      const l = lim(key); const cap = l.enabled ? l.limit : 0; const over = l.enabled && cap !== null && used > cap;
      return `<div class="reading"><dt>${label}</dt><dd class="${over ? 'is-bad' : ''}">${n(used)}${unit}</dd><p class="sub">of <span class="mono">${l.enabled ? limitText(cap) : 'Off'}</span>${l.source === 'override' ? ', override' : ''}</p></div>`;
    };
    return `
      ${r.mismatch ? `<div class="note note--bad" role="status"><div><b>The posts table holds more posts than the usage log recorded this month.</b> Log <span class="mono">${r.posts_month_logged}</span>, table <span class="mono">${r.posts_month_table}</span>. Some code path created posts without logging them, so limits were checked against the lower number.</div></div>` : ''}
      ${region(`<dl class="readings">${cell('Posts this month', r.posts_month_table, 'max_posts_per_month')}${cell('Social accounts', r.accounts, 'max_social_accounts')}${cell('Brands', r.brands, 'max_brands')}${cell('Members', ws.member_count, 'max_members')}${cell('Media stored, MB', r.stored, 'max_storage_mb')}</dl>`, { what: 'usage', path: `GET /api/v1/admin/workspaces/${ws.id}/usage`, rows: 2, empty: ['No usage yet', 'Nothing has been created or uploaded in this workspace.'] })}
      <p class="small muted">Last 30 days: <span class="mono">${r.posts_created}</span> posts created, <span class="mono">${r.posts_published}</span> published, <span class="mono">${n(r.uploaded)}</span> MB uploaded.</p>`;
  }

  function wsActivity(ws) {
    const items = AUDIT.filter((a) => a.workspace_id === ws.id);
    return `<section class="panel" aria-labelledby="h-act"><div class="panel__head"><h2 id="h-act">Activity in this workspace</h2><p>Staff actions also show in the customer’s own audit log, marked as platform staff.</p></div>
      ${region(items.length ? `<ol class="trail">${items.map((a) => trailItem(a, false)).join('')}</ol>` : '<div class="state"><h3>No recorded activity</h3><p>Changes by this workspace’s members and by staff appear here.</p></div>', { what: 'activity', path: `GET /api/v1/admin/audit?workspace_id=${ws.id}`, rows: 3, empty: ['No recorded activity', 'Changes by this workspace’s members and by staff appear here.'] })}</section>`;
  }

  // ── Logins ─────────────────────────────────────────────────────────
  VIEWS.users = (rest, q) => (rest[0] ? userDetail(rest[0]) : userList(q));

  function userList(q) {
    const term = (q.get('q') || '').toLowerCase(), who = q.get('who') || '', active = q.get('active') || '';
    const rows = USERS.filter((u) => (!term || `${u.full_name} ${u.email}`.toLowerCase().includes(term)) && (!who || (who === 'staff' ? u.platform_role : !u.platform_role)) && (!active || String(u.is_active) === active));
    const table = rows.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Person</th><th scope="col" class="num">Workspaces</th><th scope="col">Platform role</th><th scope="col">Last sign-in</th><th scope="col">Login</th></tr></thead>
      <tbody>${rows.map((u) => `<tr data-href="#/users/${u.id}">
        <td><div class="name"><a href="#/users/${u.id}">${esc(u.full_name)}</a><span>${esc(u.email)}</span></div></td>
        <td class="num">${u.workspace_ids.length}</td>
        <td>${u.platform_role ? '<span class="chip chip--person">Super admin</span>' : '<span class="muted small">Customer</span>'}</td>
        <td class="mono cool">${u.last_login_at ? dt(u.last_login_at) : '<span class="muted">Never</span>'}</td>
        <td>${u.is_active ? (u.pending_link ? '<span class="chip chip--cool">Setup link sent</span>' : '<span class="chip chip--ok">Active</span>') : '<span class="chip chip--bad">Deactivated</span>'}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="state"><h3>No login matches</h3><p>Nobody has that name or email with these filters.</p><a class="btn" href="#/users">Clear filters</a></div>';
    return {
      crumbs: [['Logins']],
      html: `
        ${head('Logins', 'Every person who can sign in, customers and staff. New logins get a set-password link that is shown once.', '<button class="btn btn--primary" type="button" data-act="new-user">New login</button>')}
        <form class="toolbar" id="u-filter" role="search" aria-label="Filter logins">
          <div class="field field--grow"><label for="u-q">Name or email</label><input class="input" id="u-q" name="q" type="search" value="${esc(q.get('q') || '')}" autocomplete="off"></div>
          ${select('u-who', 'Who', [['', 'Everyone'], ['customers', 'Customers'], ['staff', 'Platform staff']], who, 'name="who"')}
          ${select('u-active', 'Login', [['', 'Active or not'], ['true', 'Active'], ['false', 'Deactivated']], active, 'name="active"')}
        </form>
        <section class="panel" aria-label="Login list">
          ${region(table, { what: 'logins', path: 'GET /api/v1/admin/users', rows: 8, empty: ['Only you so far', 'Create a login for a customer, or wait for someone to sign up.'], emptyAction: '<button class="btn btn--primary" type="button" data-act="new-user">New login</button>' })}
          <div class="panel__foot"><span>${rows.length} sample rows of ${n(OVERVIEW.users_total)}</span><div class="pager"><button class="btn" type="button" disabled>Previous</button><span class="mono small">Page 1</span><button class="btn" type="button" disabled>Next</button></div></div>
        </section>`,
      after() {
        const f = $('#u-filter');
        const apply = () => setQuery('/users', { q: f.q.value.trim(), who: f.who.value, active: f.active.value });
        f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
        f.who.addEventListener('change', apply); f.active.addEventListener('change', apply);
      },
    };
  }

  function userDetail(id) {
    const u = UBY[id];
    if (!u) return { crumbs: [['Logins', '#/users'], ['Not found']], html: head('Login not found', 'There is no login with that id.', '<a class="btn" href="#/users">All logins</a>') };
    const isOwner = (w) => w.owner_email === u.email;
    const sessions = u.is_active && u.last_login_at ? [
      ['203.0.113.24', 'Chrome on Windows', u.last_login_at, '2026-11-26T08:00:00Z'],
      ['198.51.100.7', 'Safari on iPhone', '2026-11-08T19:20:00Z', '2026-11-22T19:20:00Z'],
    ] : [];
    const actions = `
      <button class="btn" type="button" data-act="setup-link" data-user="${u.id}">Issue setup link</button>
      <button class="btn" type="button" data-act="force-logout" data-user="${u.id}"${sessions.length ? '' : ' disabled'}>Sign out everywhere</button>
      ${u.is_active ? `<button class="btn btn--bad" type="button" data-act="deactivate" data-user="${u.id}"${u.platform_role ? ' disabled title="Remove the platform role first"' : ''}>Deactivate</button>` : `<button class="btn btn--primary" type="button" data-act="activate" data-user="${u.id}">Reactivate</button>`}`;
    return {
      crumbs: [['Logins', '#/users'], [u.full_name]],
      html: `
        ${head(u.full_name, '', actions, `<span>${esc(u.email)}</span>${u.is_active ? '<span class="chip chip--ok">Active</span>' : '<span class="chip chip--bad">Deactivated</span>'}${u.platform_role ? '<span class="chip chip--person">Super admin</span>' : ''}`)}
        <dl class="facts panel">
          <div><dt>Last sign-in</dt><dd class="mono cool">${u.last_login_at ? dt(u.last_login_at) : 'Never'}</dd></div>
          <div><dt>Created</dt><dd class="mono cool">${d(u.created_at)}</dd></div>
          <div><dt>Workspaces</dt><dd class="mono">${u.workspace_ids.length}</dd></div>
          <div><dt>Open sessions</dt><dd class="mono">${sessions.length}</dd></div>
        </dl>
        ${u.pending_link ? `<div class="note note--person" role="status"><div><b>A setup link is waiting.</b> Sent <span class="mono">${dt(u.pending_link.created_at)}</span>, it expires <span class="mono">${dt(u.pending_link.expires_at)}</span>. Links are shown once and only their hash is stored, so a lost link needs a new one.</div></div>` : ''}
        <div class="grid-even">
          <section class="panel" aria-labelledby="h-memb"><div class="panel__head"><h2 id="h-memb">Workspaces</h2></div>
            ${region(u.workspace_ids.length ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Workspace</th><th scope="col">Role</th><th scope="col">Status</th></tr></thead><tbody>${u.workspace_ids.map((wid) => WBY[wid]).map((w) => `<tr data-href="#/workspaces/${w.id}/members"><td><div class="name"><a href="#/workspaces/${w.id}/members">${esc(w.name)}</a><span class="mono">${esc(w.slug)}</span></div></td><td>${isOwner(w) ? '<span class="chip chip--person">Owner</span>' : '<span class="chip">Admin</span>'}</td><td>${statusChip(w.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="state"><h3>Not in any workspace</h3><p>Platform staff do not belong to customer workspaces.</p></div>', { what: 'memberships', rows: 2, empty: ['Not in any workspace', 'Add this login to a workspace from that workspace’s Members tab.'] })}
          </section>
          <section class="panel" aria-labelledby="h-sess"><div class="panel__head"><h2 id="h-sess">Signed-in sessions</h2></div>
            ${region(sessions.length ? `<div class="table-scroll"><table class="table"><thead><tr><th scope="col">Device</th><th scope="col">From</th><th scope="col">Expires</th></tr></thead><tbody>${sessions.map(([ip, ua, c, e]) => `<tr><td><div class="name"><span class="ink2">${esc(ua)}</span><span>Since ${dt(c)}</span></div></td><td class="mono cool">${ip}</td><td class="mono cool">${dt(e)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="state"><h3>No open sessions</h3><p>This login is not signed in anywhere.</p></div>', { what: 'sessions', rows: 2, empty: ['No open sessions', 'This login is not signed in anywhere.'] })}
          </section>
        </div>
        <section class="panel" aria-labelledby="h-role">
          <div class="setting">
            <div><h2 id="h-role">Platform role</h2><p class="small muted">A super admin sees every workspace and can change plans, features and logins. Grant it only to platform staff.</p></div>
            <div class="setting__form">${select('role-sel', 'Role', [['', 'Customer (no platform role)'], ['super_admin', 'Super admin']], u.platform_role || '')}<div><button class="btn" type="button" data-act="platform-role" data-user="${u.id}">Change role</button></div></div>
          </div>
        </section>`,
    };
  }

  // ── Plans and limits ───────────────────────────────────────────────
  VIEWS.plans = () => {
    const head1 = PLANS.map((p) => `<th scope="col" class="plan"><div class="plan-head"><b>${esc(p.name)}</b><span class="mono">${esc(p.key)}</span><span class="small muted"><span class="mono">${p.workspace_count}</span> workspaces</span><span>${p.is_default ? '<span class="chip chip--person">Default for new sign-ups</span>' : `<button class="btn btn--ghost" type="button" data-act="make-default" data-plan="${p.key}">Make default</button>`}</span></div></th>`).join('');
    const body = CATEGORIES.map((c) => `<tr class="group"><td colspan="${PLANS.length + 1}">${esc(c)}</td></tr>${FEATURES.filter((f) => f.category === c).map((f) => `<tr>
      <th scope="row" class="rowhead"><div class="name"><span class="ink2">${esc(f.name)}</span><span class="mono">${esc(f.key)}${f.global ? '' : ', off for everyone'}</span></div></th>
      ${PLANS.map((p) => { const v = p.values[f.key] || off(); const t = valueText(f, v); return `<td><button class="cell ${!v.enabled ? 'is-off' : f.type === 'boolean' ? 'is-on' : ''}" type="button" data-act="plan-value" data-plan="${p.key}" data-key="${f.key}" aria-label="${esc(f.name)} on ${esc(p.name)}: ${t}. Change">${t}</button></td>`; }).join('')}
    </tr>`).join('')}`).join('');
    const matrix = `<div class="table-scroll"><table class="table matrix"><thead><tr><th scope="col">Feature</th>${head1}</tr></thead><tbody>${body}</tbody></table></div>`;
    return {
      crumbs: [['Plans and limits']],
      html: `
        ${head('Plans and limits', 'What each plan gives. A change reaches every workspace on that plan at its next request, except where a workspace has an override.', '<button class="btn btn--primary" type="button" data-act="new-plan">New plan</button>')}
        <div class="note note--person"><div><b>The Free and Pro values are placeholders.</b> Set the real limits before making Free the default for new sign-ups.</div></div>
        <section class="panel" aria-label="Plan and feature matrix">
          ${region(matrix, { what: 'plans', path: 'GET /api/v1/admin/plans', rows: 10, empty: ['No plans yet', 'Create the first plan. Every workspace needs one.'], emptyAction: '<button class="btn btn--primary" type="button" data-act="new-plan">New plan</button>' })}
          <div class="panel__foot"><span>Select a value to change it. Retired plans keep their workspaces but cannot be given to new ones.</span></div>
        </section>`,
    };
  };

  // ── Feature switches ───────────────────────────────────────────────
  VIEWS.features = () => {
    const table = `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Feature</th><th scope="col">Kind</th><th scope="col">What it does</th><th scope="col">For everyone</th></tr></thead>
      <tbody>${CATEGORIES.map((c) => `<tr class="group"><td colspan="4">${esc(c)}</td></tr>${FEATURES.filter((f) => f.category === c).map((f) => `<tr>
        <td><div class="name"><span class="ink2">${esc(f.name)}</span><span class="mono">${esc(f.key)}</span></div></td>
        <td class="small">${f.type === 'limit' ? 'Limit' : 'On or off'}</td>
        <td class="small">${esc(f.description)}${f.category === 'AI' ? ' <span class="chip">Phase 2</span>' : ''}</td>
        <td>${sw(`g-${f.key}`, f.global ? 'On' : 'Off', f.global, `data-act="global" data-key="${f.key}"`)}</td></tr>`).join('')}`).join('')}</tbody></table></div>`;
    return {
      crumbs: [['Feature switches']],
      html: `
        ${head('Feature switches', 'The kill switch above every plan. Off here means off for every workspace, whatever their plan or override says. The list itself comes from code; only the switch is changed here.')}
        <section class="panel" aria-label="Global feature switches">${region(table, { what: 'features', path: 'GET /api/v1/admin/features', rows: 8, empty: ['No features registered', 'Features are added in app/core/features.py and created at startup.'] })}</section>
        <p class="small muted">Turning a feature off stops new use only. Posts already queued still publish, and an existing approval rule is never relaxed.</p>`,
    };
  };

  // ── Smart Templates ────────────────────────────────────────────────
  VIEWS.templates = (rest, q) => {
    const term = (q.get('q') || '').toLowerCase(), show = q.get('show') || 'all';
    const list = TEMPLATES.filter((t) => (!term || `${t.title} ${t.industry} ${t.template_text}`.toLowerCase().includes(term)) && (show === 'all' || String(t.is_active) === (show === 'on' ? 'true' : 'false')));
    const sel = TEMPLATES.find((t) => t.id === q.get('id')) || list[0];
    const listHtml = list.length ? `<ul class="list">${list.map((t) => `<li><button type="button" data-tpl="${t.id}"${sel && t.id === sel.id ? ' aria-current="true"' : ''}><b>${esc(t.title)}</b>${t.is_active ? '' : '<span class="chip">Switched off</span>'}<span class="sub">${esc(t.industry)}, ${esc(t.category)}</span></button></li>`).join('')}</ul>`
      : '<div class="state"><h3>No template matches</h3><p>Try another word, or show switched-off templates too.</p></div>';
    const editor = sel ? `<form class="editor panel__body" id="tpl-form" novalidate>
        <div class="row">
          <div class="field"><label for="t-industry">Industry</label><input class="input" id="t-industry" name="industry" value="${esc(sel.industry)}" required maxlength="100"></div>
          ${select('t-category', 'Category', [['promotional', 'Promotional'], ['educational', 'Educational'], ['engagement', 'Engagement'], ['seasonal', 'Seasonal']], sel.category, 'name="category"')}
        </div>
        <div class="field"><label for="t-title">Title</label><input class="input" id="t-title" name="title" value="${esc(sel.title)}" required maxlength="255"></div>
        <div class="field"><label for="t-text">Template</label><textarea class="textarea" id="t-text" name="template_text" rows="5" maxlength="5000">${esc(sel.template_text)}</textarea><span class="help">Words in braces, like {product}, are filled in by the customer.</span></div>
        <div class="row">
          <div class="field"><label for="t-tags">Suggested hashtags</label><input class="input" id="t-tags" name="hashtags" value="${esc(sel.suggested_hashtags.join(' '))}"><span class="help">Up to 30, separated by spaces.</span></div>
          <div class="field"><label for="t-cta">Suggested call to action</label><input class="input" id="t-cta" name="cta" value="${esc(sel.suggested_cta || '')}" maxlength="255"></div>
        </div>
        <div class="toolbar">${sw('t-active', sel.is_active ? 'Customers can use it' : 'Switched off', sel.is_active, 'data-tpl-active')}<div class="toolbar__end"><button class="btn btn--primary" type="submit">Save changes</button></div></div>
      </form>` : '<div class="state"><h3>Pick a template</h3><p>Choose one from the list to edit it.</p></div>';
    return {
      crumbs: [['Smart Templates']],
      html: `
        ${head('Smart Templates', 'One library shared by every customer, who can only read it. Templates are switched off, never deleted; posts already written from one keep their text.', '<button class="btn btn--primary" type="button" data-act="new-template">New template</button>')}
        <form class="toolbar" id="tpl-filter" role="search" aria-label="Filter templates">
          <div class="field field--grow"><label for="tq">Title, industry or text</label><input class="input" id="tq" name="q" type="search" value="${esc(q.get('q') || '')}" autocomplete="off"></div>
          <fieldset class="seg end"><legend>Show</legend>${[['all', 'All'], ['on', 'In use'], ['off', 'Switched off']].map(([v, t], i) => `<input type="radio" name="show" id="ts-${i}" value="${v}"${show === v ? ' checked' : ''}><label for="ts-${i}">${t}</label>`).join('')}</fieldset>
        </form>
        <div class="md">
          <section class="panel" aria-label="Templates">${region(listHtml, { what: 'templates', path: 'GET /api/v1/admin/templates', rows: 6, empty: ['The library is empty', 'Add the first template customers will see when they write a post.'], emptyAction: '<button class="btn btn--primary" type="button" data-act="new-template">New template</button>' })}</section>
          <section class="panel" aria-labelledby="h-tpl"><div class="panel__head"><h2 id="h-tpl">${sel ? esc(sel.title) : 'Template'}</h2>${sel ? `<span class="mono small cool">${sel.id}</span>` : ''}</div>${protoState === 'full' ? editor : ''}</section>
        </div>`,
      after() {
        const f = $('#tpl-filter');
        const apply = (id) => setQuery('/templates', { q: f.q.value.trim(), show: f.show.value === 'all' ? '' : f.show.value, id });
        f.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
        $$('input[name="show"]', f).forEach((r) => r.addEventListener('change', () => apply()));
        $$('[data-tpl]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.tpl)));
        const tf = $('#tpl-form');
        if (!tf) return;
        const act = $('[data-tpl-active]');
        act.addEventListener('click', () => { const v = act.getAttribute('aria-checked') !== 'true'; act.setAttribute('aria-checked', v); act.lastChild.textContent = v ? 'Customers can use it' : 'Switched off'; });
        tf.addEventListener('submit', (e) => {
          e.preventDefault();
          const now = { industry: tf.industry.value.trim().toLowerCase(), category: tf.category.value, title: tf.title.value.trim(), template_text: tf.template_text.value, suggested_hashtags: tf.hashtags.value.trim(), suggested_cta: tf.cta.value.trim(), is_active: act.getAttribute('aria-checked') === 'true' ? 'on' : 'off' };
          const was = { industry: sel.industry, category: sel.category, title: sel.title, template_text: sel.template_text, suggested_hashtags: sel.suggested_hashtags.join(' '), suggested_cta: sel.suggested_cta || '', is_active: sel.is_active ? 'on' : 'off' };
          const diff = Object.keys(now).filter((k) => now[k] !== was[k]).map((k) => [k.replace(/_/g, ' '), was[k], now[k]]);
          openSlip({ title: `Save “${sel.title}”`, lede: diff.length ? 'Customers see the new version the next time they open the library.' : 'Nothing has changed yet. Edit a field first.', diff: () => diff, action: 'UPDATE', entity: `CaptionTemplate, ${sel.title}`, method: 'PATCH', path: `/api/v1/admin/templates/${sel.id}`, confirm: 'Save template', blocked: !diff.length });
        });
      },
    };
  };

  // ── Usage ──────────────────────────────────────────────────────────
  VIEWS.usage = (rest, q) => {
    const days = q.get('days') || '30', plan = q.get('plan') || '', problems = q.get('problems') === '1';
    const rows = USAGE.filter((r) => (!plan || r.ws.plan_key === plan) && (!problems || r.over.length || r.mismatch));
    const table = rows.length ? `<div class="table-scroll"><table class="table">
      <thead><tr><th scope="col">Workspace</th><th scope="col" class="num">Created</th><th scope="col" class="num">Published</th><th scope="col" class="num">Uploaded, MB</th><th scope="col" class="num">Stored, MB</th><th scope="col" class="num">Accounts</th><th scope="col" class="num">Month, log</th><th scope="col" class="num">Month, table</th><th scope="col">Check</th></tr></thead>
      <tbody>${rows.map((r) => `<tr data-href="#/workspaces/${r.ws.id}/usage"${r.over.length || r.mismatch ? ' class="is-flagged"' : ''}>
        <td><div class="name"><a href="#/workspaces/${r.ws.id}/usage">${esc(r.ws.name)}</a><span>${esc(PBY[r.ws.plan_key].name)}${r.ws.status === 'suspended' ? ', suspended' : ''}</span></div></td>
        <td class="num">${r.posts_created}</td><td class="num">${r.posts_published}</td><td class="num">${n(r.uploaded)}</td><td class="num">${n(r.stored)}</td>
        <td class="num${r.over.some((o) => o.key === 'max_social_accounts') ? ' over' : ''}">${r.accounts}</td>
        <td class="num">${r.posts_month_logged}</td><td class="num${r.mismatch || r.over.some((o) => o.key === 'max_posts_per_month') ? ' over' : ''}">${r.posts_month_table}</td>
        <td>${r.over.map((o) => `<span class="chip chip--bad">${esc(FBY[o.key].name)} over</span>`).join(' ')}${r.mismatch ? ' <span class="chip chip--bad">Mismatch</span>' : ''}${!r.over.length && !r.mismatch ? '<span class="chip chip--ok">Fine</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="state"><h3>Every workspace is inside its limits</h3><p>Nothing is over a limit and every usage log matches the posts table.</p><a class="btn" href="#/usage">Show every workspace</a></div>';
    return {
      crumbs: [['Usage']],
      html: `
        ${head('Usage', 'Usage per workspace for billing, and the check that catches a workspace getting more than its plan allows.')}
        <form class="toolbar" id="us-filter">
          <fieldset class="seg end"><legend>Period</legend>${[['7', '7 days'], ['30', '30 days'], ['90', '90 days']].map(([v, t]) => `<input type="radio" name="days" id="ud-${v}" value="${v}"${days === v ? ' checked' : ''}><label for="ud-${v}">${t}</label>`).join('')}</fieldset>
          ${select('us-plan', 'Plan', [['', 'Any plan'], ...PLANS.map((p) => [p.key, p.name])], plan, 'name="plan"')}
          <div class="end">${sw('us-problems', 'Only workspaces to check', problems)}</div>
          <div class="toolbar__end"><span class="small muted" id="export-status" aria-live="polite"></span><button class="btn" type="button" id="export">Download CSV</button></div>
        </form>
        <section class="panel" aria-label="Usage per workspace">
          ${region(table, { what: 'usage', path: 'GET /api/v1/admin/usage', rows: 8, empty: ['No usage recorded', 'Usage appears once workspaces start creating posts.'] })}
          <div class="panel__foot"><span>Created, published and uploaded cover the last ${esc(days)} days. Month log and month table should match: when the table is higher, posts were created without being logged.</span></div>
        </section>`,
      after() {
        const f = $('#us-filter');
        const p = $('#us-problems');
        const apply = () => setQuery('/usage', { days: f.days.value === '30' ? '' : f.days.value, plan: f.plan.value, problems: p.getAttribute('aria-checked') === 'true' ? '1' : '' });
        $$('input[name="days"]', f).forEach((r) => r.addEventListener('change', apply));
        f.plan.addEventListener('change', apply);
        p.addEventListener('click', () => { p.setAttribute('aria-checked', p.getAttribute('aria-checked') !== 'true'); apply(); });
        $('#export').addEventListener('click', () => { $('#export-status').textContent = `Not connected. The live console downloads GET /api/v1/admin/usage?days=${days}&format=csv`; });
      },
    };
  };

  // ── Audit trail ────────────────────────────────────────────────────
  VIEWS.audit = (rest, q) => {
    const action = q.get('action') || '', staff = q.get('staff') === '1', wsId = q.get('ws') || '';
    const items = AUDIT.filter((a) => (!action || a.action === action) && (!staff || a.staff) && (!wsId || a.workspace_id === wsId));
    const trail = items.length ? `<ol class="trail">${items.map((a) => trailItem(a)).join('')}</ol>` : '<div class="state"><h3>No entries match</h3><p>Nothing was recorded with these filters. Widen the action or the workspace.</p><a class="btn" href="#/audit">Clear filters</a></div>';
    return {
      crumbs: [['Audit trail']],
      html: `
        ${head('Audit trail', 'Every change on the platform, newest first, with who made it and why. Rows can be added but never changed or deleted.')}
        <form class="toolbar" id="au-filter">
          ${select('au-action', 'Action', [['', 'Any action'], ...ACTIONS.map((a) => [a, a.charAt(0) + a.slice(1).toLowerCase().replace(/_/g, ' ')])], action, 'name="action"')}
          ${select('au-ws', 'Workspace', [['', 'Any workspace'], ...WORKSPACES.map((w) => [w.id, w.name])], wsId, 'name="ws"')}
          <div class="end">${sw('au-staff', 'Staff actions only', staff)}</div>
        </form>
        <section class="panel" aria-label="Audit entries">
          ${region(trail, { what: 'the audit trail', path: 'GET /api/v1/admin/audit', rows: 6, empty: ['Nothing recorded yet', 'Every change made by customers and staff is listed here.'] })}
          <div class="panel__foot"><span>${items.length} sample entries</span><div class="pager"><button class="btn" type="button" disabled>Previous</button><span class="mono small">Page 1</span><button class="btn" type="button" disabled>Next</button></div></div>
        </section>`,
      after() {
        const f = $('#au-filter'); const s = $('#au-staff');
        const apply = () => setQuery('/audit', { action: f.action.value, ws: f.ws.value, staff: s.getAttribute('aria-checked') === 'true' ? '1' : '' });
        f.action.addEventListener('change', apply); f.ws.addEventListener('change', apply);
        s.addEventListener('click', () => { s.setAttribute('aria-checked', s.getAttribute('aria-checked') !== 'true'); apply(); });
      },
    };
  };

  // ── Platform settings ──────────────────────────────────────────────
  VIEWS.settings = () => {
    const rows = SETTINGS.map((s) => `<div class="setting">
      <div><h2>${esc(s.description)}</h2><p class="key">${esc(s.key)}</p><p class="small muted">Default <span class="mono">${s.default}</span>, allowed <span class="mono">${s.minimum}</span> to <span class="mono">${s.maximum}</span>. Last changed <span class="mono cool">${dt(s.updated_at)}</span>.</p></div>
      <form class="setting__form" data-setting="${s.key}" novalidate>
        <div class="field"><label for="s-${s.key}">Hours</label>
          <div class="setting__row"><input class="input mono" id="s-${s.key}" name="value" type="number" inputmode="numeric" min="${s.minimum}" max="${s.maximum}" value="${s.value}" required><button class="btn" type="submit">Change</button></div>
          <span class="help" id="sh-${s.key}" aria-live="polite"></span></div>
      </form></div>`).join('');
    return {
      crumbs: [['Platform settings']],
      html: `
        ${head('Platform settings', 'Values the code reads on every request instead of a constant, so a change here applies straight away. New settings are added in app/core/settings_registry.py.')}
        <section class="panel" aria-label="Settings">${region(rows, { what: 'settings', path: 'GET /api/v1/admin/settings', rows: 1, empty: ['No settings registered', 'Settings are added in code and created at startup.'] })}</section>`,
      after() {
        $$('[data-setting]').forEach((f) => f.addEventListener('submit', (e) => {
          e.preventDefault();
          const s = SETTINGS.find((x) => x.key === f.dataset.setting); const help = $(`#sh-${s.key}`); const v = Number(f.value.value);
          if (!f.value.value || !Number.isInteger(v) || v < s.minimum || v > s.maximum) { f.value.setAttribute('aria-invalid', 'true'); f.value.setAttribute('aria-describedby', help.id); help.classList.add('is-error'); help.textContent = `Use a whole number from ${s.minimum} to ${s.maximum}.`; f.value.focus(); return; }
          f.value.removeAttribute('aria-invalid'); help.classList.remove('is-error'); help.textContent = '';
          if (v === s.value) { help.textContent = 'That is already the value.'; return; }
          openSlip({ title: 'Change how long setup links last', lede: 'Links already sent keep the expiry they were issued with.', diff: () => [['setup link hours', String(s.value), String(v)]], action: 'SETTING_CHANGE', entity: `PlatformSetting, ${s.key}`, method: 'PATCH', path: `/api/v1/admin/settings/${s.key}`, confirm: 'Change setting' });
        }));
      },
    };
  };

  // ── The change slip ────────────────────────────────────────────────
  const slip = $('#slip');
  function openSlip(o) {
    const fields = (o.fields || []).map((f) => {
      const id = `sf-${f.name}`;
      if (f.type === 'select') return `<div class="field${f.wide ? ' field--wide' : ''}"><label for="${id}">${esc(f.label)}</label><select class="select" id="${id}" name="${f.name}">${f.options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(f.value ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
      return `<div class="field${f.wide ? ' field--wide' : ''}"><label for="${id}">${esc(f.label)}</label><input class="input" id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"${f.required ? ' required' : ''}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}${f.min !== undefined ? ` min="${f.min}"` : ''}${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}><span class="help" id="${id}-help">${esc(f.help || '')}</span></div>`;
    }).join('');
    slip.innerHTML = `
      <form method="dialog" novalidate>
        <div class="slip__head"><h2 id="slip-title">${esc(o.title)}</h2>${o.lede ? `<p>${esc(o.lede)}</p>` : ''}</div>
        <div class="slip__body">
          ${fields ? `<div class="slip__fields">${fields}</div>` : ''}
          <div id="slip-diff"></div>
          <div class="field"><label for="sf-reason">Reason</label>
            <textarea class="textarea" id="sf-reason" name="reason" maxlength="500" rows="3" placeholder="Why are you making this change? The customer may read it."></textarea>
            <span class="help" id="sf-reason-help"><span class="counter" id="sf-count">0 of 500</span></span></div>
          <div class="record" aria-live="polite">
            <span class="label">Recorded in the audit trail as</span>
            <span class="line"><b class="person">Sample Staff</b><span class="mono cool">${esc(o.action)}</span><span>${esc(o.entity)}</span></span>
            <span class="why" id="slip-why"></span>
            ${o.workspace ? '<span class="label">Also shown in this customer’s own audit log, marked as platform staff.</span>' : ''}
          </div>
          <span class="endpoint">${esc(o.method)} ${esc(o.path)}</span>
        </div>
        <div class="slip__foot"><p class="slip__status" id="slip-status" role="status"></p>
          <div class="btns"><button class="btn" type="button" data-close>Cancel</button><button class="btn ${o.danger ? 'btn--bad' : 'btn--primary'}" type="submit" value="confirm"${o.blocked ? ' disabled' : ''}>${esc(o.confirm)}</button></div></div>
      </form>`;
    const form = $('form', slip);
    const reason = $('#sf-reason');
    const drawDiff = () => {
      const vals = Object.fromEntries(new FormData(form));
      const rows = (o.diff ? o.diff(vals) : []).filter(Boolean);
      $('#slip-diff').innerHTML = rows.length ? `<table class="diff"><caption class="visually-hidden">What changes</caption><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${rows.map(([k, a, b]) => `<tr><td>${esc(k)}</td><td class="was">${a ? `<span>${esc(a)}</span>` : ''}</td><td class="now">${esc(b)}</td></tr>`).join('')}</tbody></table>` : '';
    };
    drawDiff();
    form.addEventListener('input', (e) => {
      if (e.target === reason) {
        $('#sf-count').textContent = `${reason.value.length} of 500`;
        $('#slip-why').textContent = reason.value.trim() ? `“${reason.value.trim()}”` : '';
        reason.removeAttribute('aria-invalid');
        const st = $('#slip-status');
        if (st.classList.contains('is-error') && reason.value.trim().length >= 3) { st.className = 'slip__status'; st.textContent = ''; }
      } else drawDiff();
    });
    form.addEventListener('change', drawDiff);
    $('[data-close]', slip).addEventListener('click', () => slip.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const status = $('#slip-status');
      const bad = (o.fields || []).find((f) => f.required && !form.elements[f.name].value.trim());
      if (bad) { const el = form.elements[bad.name]; el.setAttribute('aria-invalid', 'true'); status.className = 'slip__status is-error'; status.textContent = `${bad.label} is needed.`; el.focus(); return; }
      if (reason.value.trim().length < 3) { reason.setAttribute('aria-invalid', 'true'); reason.setAttribute('aria-describedby', 'slip-status'); status.className = 'slip__status is-error'; status.textContent = 'Give a short reason for this change. It goes in the audit trail.'; reason.focus(); return; }
      status.className = 'slip__status';
      status.textContent = 'Not sent. This prototype is not connected to the admin API.';
    });
    slip.showModal();
    (form.querySelector('.slip__fields input, .slip__fields select') || reason).focus();
  }

  // ── Actions ────────────────────────────────────────────────────────
  const planOptions = (activeOnly = true) => PLANS.filter((p) => !activeOnly || p.is_active).map((p) => [p.key, `${p.name} (${p.key})`]);
  const ACT = {
    'new-workspace': () => openSlip({ title: 'New workspace', lede: 'The owner must already have a login, or create one first from Logins.', fields: [
      { name: 'name', label: 'Workspace name', required: true, wide: true },
      { name: 'owner_email', label: 'Owner email', type: 'email', required: true, autocomplete: 'off' },
      { name: 'plan_key', label: 'Plan', type: 'select', options: planOptions(), value: 'founding' },
    ], diff: (v) => [['workspace', '', v.name || 'New workspace'], ['plan', '', v.plan_key]], action: 'CREATE', entity: 'Workspace', method: 'POST', path: '/api/v1/admin/workspaces', confirm: 'Create workspace' }),
    'change-plan': (b) => { const ws = WBY[b.dataset.id]; openSlip({ title: `Change the plan of ${ws.name}`, lede: 'Limits change at their next request. Overrides stay in place.', fields: [{ name: 'plan_key', label: 'New plan', type: 'select', options: planOptions(), value: ws.plan_key, wide: true }], diff: (v) => (v.plan_key !== ws.plan_key ? [['plan', ws.plan_key, v.plan_key]] : []), action: 'PLAN_CHANGE', entity: `Workspace, ${ws.name}`, workspace: true, method: 'PATCH', path: `/api/v1/admin/workspaces/${ws.id}`, confirm: 'Change plan' }); },
    transfer: (b) => { const ws = WBY[b.dataset.id]; const ms = membersOf(ws).filter((m) => m.role !== 'owner'); openSlip({ title: `Transfer ownership of ${ws.name}`, lede: 'The new owner must already be a member. The old owner stays on as an admin.', fields: [{ name: 'new_owner', label: 'New owner', type: 'select', wide: true, options: ms.length ? ms.map((m) => [m.user.email, `${m.user.full_name}, ${m.user.email}`]) : [['', 'No other members yet']] }], diff: (v) => [['owner', ws.owner_email, v.new_owner || '']], action: 'OWNERSHIP_TRANSFER', entity: `Workspace, ${ws.name}`, workspace: true, method: 'POST', path: `/api/v1/admin/workspaces/${ws.id}/transfer-ownership`, confirm: 'Transfer ownership', blocked: !ms.length }); },
    suspend: (b) => { const ws = WBY[b.dataset.id]; openSlip({ title: `Suspend ${ws.name}`, lede: 'Members can still sign in and read. Nothing can be created, scheduled or published until you reactivate it. Nothing is deleted.', diff: () => [['status', 'active', 'suspended']], action: 'SUSPEND', entity: `Workspace, ${ws.name}`, workspace: true, method: 'POST', path: `/api/v1/admin/workspaces/${ws.id}/suspend`, confirm: 'Suspend workspace', danger: true }); },
    reactivate: (b) => { const ws = WBY[b.dataset.id]; openSlip({ title: `Reactivate ${ws.name}`, lede: 'Members can create and publish again straight away.', diff: () => [['status', 'suspended', 'active']], action: 'REACTIVATE', entity: `Workspace, ${ws.name}`, workspace: true, method: 'POST', path: `/api/v1/admin/workspaces/${ws.id}/reactivate`, confirm: 'Reactivate workspace' }); },
    override: (b) => {
      const ws = WBY[b.dataset.id]; const r = resolve(ws).find((x) => x.f.key === b.dataset.key); const cur = r.override || r.plan;
      const fields = [{ name: 'enabled', label: 'They get', type: 'select', options: [['on', 'On'], ['off', 'Off']], value: cur.enabled ? 'on' : 'off' }];
      if (r.f.type === 'limit') fields.push({ name: 'limit', label: 'Limit', type: 'number', min: 0, inputmode: 'numeric', value: cur.limit ?? '', help: 'Leave empty for unlimited.' });
      fields.push({ name: 'expires', label: 'Until', type: 'date', value: r.override?.expires_at ? r.override.expires_at.slice(0, 10) : '', help: 'Leave empty to keep it until removed. Use a date for a trial.', wide: r.f.type !== 'limit' });
      openSlip({ title: `${r.override ? 'Edit the override on' : 'Override'} ${r.f.name}`, lede: `For ${ws.name} only. Their plan gives ${valueText(r.f, r.plan)}.`, fields,
        diff: (v) => { const now = v.enabled === 'on' ? (r.f.type === 'limit' ? limitText(v.limit === '' ? null : Number(v.limit)) : 'On') : 'Off'; return [[r.f.name.toLowerCase(), valueText(r.f, { enabled: r.enabled, limit: r.limit }), now], v.expires ? ['until', r.override?.expires_at ? d(r.override.expires_at) : 'none', d(`${v.expires}T00:00:00Z`)] : null]; },
        action: 'FEATURE_CHANGE', entity: `Workspace, ${ws.name}, ${r.f.key}`, workspace: true, method: 'PUT', path: `/api/v1/admin/workspaces/${ws.id}/features/${r.f.key}`, confirm: 'Save override' });
    },
    'remove-override': (b) => { const ws = WBY[b.dataset.id]; const r = resolve(ws).find((x) => x.f.key === b.dataset.key); openSlip({ title: `Remove the override on ${r.f.name}`, lede: `${ws.name} goes back to what the ${PBY[ws.plan_key].name} plan gives.`, diff: () => [[r.f.name.toLowerCase(), valueText(r.f, { enabled: r.enabled, limit: r.limit }), valueText(r.f, r.plan)]], action: 'FEATURE_CHANGE', entity: `Workspace, ${ws.name}, ${r.f.key}`, workspace: true, method: 'DELETE', path: `/api/v1/admin/workspaces/${ws.id}/features/${r.f.key}?reason=…`, confirm: 'Remove override', danger: true }); },
    'member-add': (b) => { const ws = WBY[b.dataset.id]; openSlip({ title: `Add a member to ${ws.name}`, lede: 'The person must already have a login.', fields: [{ name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'off' }, { name: 'role', label: 'Role', type: 'select', options: [['member', 'Member'], ['admin', 'Admin']], value: 'member' }], diff: (v) => [['member', '', v.email || ''], ['role', '', v.role]], action: 'INVITE', entity: `Workspace, ${ws.name}`, workspace: true, method: 'POST', path: `/api/v1/admin/workspaces/${ws.id}/members`, confirm: 'Add member' }); },
    'member-role': (b) => { const ws = WBY[b.dataset.id]; openSlip({ title: `Change the role of ${b.dataset.user}`, fields: [{ name: 'role', label: 'Role', type: 'select', options: [['member', 'Member'], ['admin', 'Admin']], value: b.dataset.role, wide: true }], diff: (v) => (v.role !== b.dataset.role ? [['role', b.dataset.role, v.role]] : []), action: 'ROLE_CHANGE', entity: `Member, ${b.dataset.user}`, workspace: true, method: 'PATCH', path: `/api/v1/admin/workspaces/${ws.id}/members/{user_id}`, confirm: 'Change role' }); },
    'member-remove': (b) => { const ws = WBY[b.dataset.id]; openSlip({ title: `Remove ${b.dataset.user} from ${ws.name}`, lede: 'Their login stays; they lose access to this workspace. Posts they wrote stay.', diff: () => [['member', b.dataset.user, 'removed']], action: 'DELETE', entity: `Member, ${b.dataset.user}`, workspace: true, method: 'DELETE', path: `/api/v1/admin/workspaces/${ws.id}/members/{user_id}?reason=…`, confirm: 'Remove member', danger: true }); },
    'new-user': () => openSlip({ title: 'New login', lede: 'They get a link to set their own password. It is shown once after you confirm; only its hash is stored.', fields: [
      { name: 'full_name', label: 'Full name', required: true, autocomplete: 'off' },
      { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'off' },
      { name: 'dest', label: 'Workspace', type: 'select', wide: true, options: [['new', 'A new workspace of their own (they become owner)'], ...WORKSPACES.map((w) => [w.id, `Join ${w.name}`])], value: 'new' },
      { name: 'new_workspace_name', label: 'New workspace name', help: 'Only for a new workspace.' },
      { name: 'plan_key', label: 'Plan for the new workspace', type: 'select', options: planOptions(), value: 'founding' },
    ], diff: (v) => [['login', '', v.email || ''], ['workspace', '', v.dest === 'new' ? (v.new_workspace_name || 'new workspace') : WBY[v.dest].name]], action: 'CREATE', entity: 'User', method: 'POST', path: '/api/v1/admin/users', confirm: 'Create login' }),
    'setup-link': (b) => { const u = UBY[b.dataset.user]; openSlip({ title: `Issue a setup link for ${u.full_name}`, lede: `Any earlier link stops working. The new one lasts ${SETTINGS[0].value} hours and is shown once.`, diff: () => [['setup link', u.pending_link ? 'pending' : 'none', `new, ${SETTINGS[0].value} hours`]], action: 'SETUP_LINK', entity: `User, ${u.email}`, method: 'POST', path: `/api/v1/admin/users/${u.id}/setup-link`, confirm: 'Issue link' }); },
    'force-logout': (b) => { const u = UBY[b.dataset.user]; openSlip({ title: `Sign ${u.full_name} out everywhere`, lede: 'Every session ends now. Their password does not change.', diff: () => [['open sessions', '2', '0']], action: 'FORCE_LOGOUT', entity: `User, ${u.email}`, method: 'POST', path: `/api/v1/admin/users/${u.id}/force-logout`, confirm: 'Sign out everywhere', danger: true }); },
    deactivate: (b) => { const u = UBY[b.dataset.user]; openSlip({ title: `Deactivate ${u.full_name}`, lede: 'They are signed out and cannot sign in again. Their workspaces and posts stay.', diff: () => [['login', 'active', 'deactivated']], action: 'UPDATE', entity: `User, ${u.email}`, method: 'PATCH', path: `/api/v1/admin/users/${u.id}`, confirm: 'Deactivate login', danger: true }); },
    activate: (b) => { const u = UBY[b.dataset.user]; openSlip({ title: `Reactivate ${u.full_name}`, lede: 'They can sign in again with their old password.', diff: () => [['login', 'deactivated', 'active']], action: 'UPDATE', entity: `User, ${u.email}`, method: 'PATCH', path: `/api/v1/admin/users/${u.id}`, confirm: 'Reactivate login' }); },
    'platform-role': (b) => { const u = UBY[b.dataset.user]; const v = $('#role-sel').value; const was = u.platform_role || ''; openSlip({ title: v ? `Make ${u.full_name} a super admin` : `Remove the platform role from ${u.full_name}`, lede: v ? 'They will see every workspace and can change plans, features and logins.' : 'They become an ordinary customer login.', diff: () => (v !== was ? [['platform role', was || 'customer', v || 'customer']] : []), action: 'ROLE_CHANGE', entity: `User, ${u.email}`, method: 'PUT', path: `/api/v1/admin/users/${u.id}/platform-role`, confirm: 'Change role', blocked: v === was, danger: !v }); },
    'new-plan': () => openSlip({ title: 'New plan', lede: 'Start from another plan’s values, then adjust them in the matrix.', fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'key', label: 'Key', required: true, help: 'Lowercase letters, digits and underscores. Never renamed later.' },
      { name: 'copy_from_key', label: 'Copy values from', type: 'select', wide: true, options: [['', 'Start with everything off'], ...planOptions()], value: 'free' },
    ], diff: (v) => [['plan', '', v.key || ''], ['values from', '', v.copy_from_key || 'nothing']], action: 'CREATE', entity: 'Plan', method: 'POST', path: '/api/v1/admin/plans', confirm: 'Create plan' }),
    'make-default': (b) => { const p = PBY[b.dataset.plan]; const cur = PLANS.find((x) => x.is_default); openSlip({ title: `Make ${p.name} the default`, lede: 'New sign-ups get this plan. Existing workspaces keep theirs.', diff: () => [['default plan', cur.key, p.key]], action: 'UPDATE', entity: `Plan, ${p.key}`, method: 'POST', path: `/api/v1/admin/plans/${p.id}/make-default`, confirm: 'Make default' }); },
    'plan-value': (b) => {
      const p = PBY[b.dataset.plan]; const f = FBY[b.dataset.key]; const v0 = p.values[f.key] || off();
      const fields = [{ name: 'enabled', label: 'Value', type: 'select', options: [['on', 'On'], ['off', 'Off']], value: v0.enabled ? 'on' : 'off', wide: f.type !== 'limit' }];
      if (f.type === 'limit') fields.push({ name: 'limit', label: 'Limit', type: 'number', min: 0, inputmode: 'numeric', value: v0.limit ?? '', help: 'Leave empty for unlimited.' });
      openSlip({ title: `${f.name} on the ${p.name} plan`, lede: `Reaches ${p.workspace_count} workspaces at their next request, except those with an override.${f.global ? '' : ' Still off for everyone until its global switch is on.'}`, fields,
        diff: (v) => { const now = v.enabled === 'on' ? (f.type === 'limit' ? limitText(v.limit === '' ? null : Number(v.limit)) : 'On') : 'Off'; const was = valueText(f, v0); return now !== was ? [[f.name.toLowerCase(), was, now]] : []; },
        action: 'FEATURE_CHANGE', entity: `Plan, ${p.key}, ${f.key}`, method: 'PUT', path: `/api/v1/admin/plans/${p.id}/features/${f.key}`, confirm: 'Save value' });
    },
    global: (b) => { const f = FBY[b.dataset.key]; openSlip({ title: `${f.global ? 'Turn off' : 'Turn on'} ${f.name} for everyone`, lede: f.global ? 'Every workspace loses it on its next request, whatever its plan or override says. Work already queued still runs.' : 'Workspaces whose plan or override gives it get it on their next request.', diff: () => [['for everyone', f.global ? 'on' : 'off', f.global ? 'off' : 'on']], action: 'FEATURE_CHANGE', entity: `Feature, ${f.key}`, method: 'PATCH', path: `/api/v1/admin/features/${f.key}`, confirm: f.global ? 'Turn off' : 'Turn on', danger: f.global }); },
    'new-template': () => openSlip({ title: 'New Smart Template', lede: 'Customers see it in the library straight away.', fields: [
      { name: 'title', label: 'Title', required: true },
      { name: 'industry', label: 'Industry', required: true, help: 'Stored in lowercase, like bakery.' },
      { name: 'category', label: 'Category', type: 'select', wide: true, options: [['promotional', 'Promotional'], ['educational', 'Educational'], ['engagement', 'Engagement'], ['seasonal', 'Seasonal']], value: 'promotional' },
    ], diff: (v) => [['title', '', v.title || ''], ['industry', '', (v.industry || '').toLowerCase()]], action: 'CREATE', entity: 'CaptionTemplate', method: 'POST', path: '/api/v1/admin/templates', confirm: 'Create template' }),
  };

  document.addEventListener('click', (e) => {
    const retry = e.target.closest('[data-retry]');
    if (retry) { $('#ps-full').checked = true; protoState = 'full'; render(); return; }
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled && ACT[b.dataset.act]) { e.preventDefault(); ACT[b.dataset.act](b); return; }
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a, button, input, select, details')) location.hash = tr.dataset.href.slice(1);
  });

  // ── Search, menu, shortcuts ────────────────────────────────────────
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#q').value.trim();
    if (!v) return;
    location.hash = v.includes('@') ? `/users?q=${encodeURIComponent(v)}` : `/workspaces?q=${encodeURIComponent(v)}`;
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
    if (e.key === 'Escape' && $('#app').classList.contains('is-menu-open')) closeMenu();
  });
  const menuBtn = $('#menu-btn');
  function closeMenu() { $('#app').classList.remove('is-menu-open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const open = !$('#app').classList.contains('is-menu-open'); $('#app').classList.toggle('is-menu-open', open); menuBtn.setAttribute('aria-expanded', String(open)); if (open) $('.nav a').focus(); });
  $('#app').addEventListener('click', (e) => { if ($('#app').classList.contains('is-menu-open') && !e.target.closest('.side') && !e.target.closest('#menu-btn')) closeMenu(); });

  render();
})();
