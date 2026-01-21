// API helper with automatic redirect on 401
const api = {
  get: async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('Unauthorized');
    }
    return res.json();
  },
  post: async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('Unauthorized');
    }
    return res.json();
  }
};

// DOM elements - will be checked in functions to handle late loading
// These are initialized when DOM is ready

// Debounce function to prevent rapid API calls
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle function for settings updates
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

let isLoading = false;
const debouncedLoadAll = debounce(loadAll, 500);

// Initialize buttons and forms when DOM is ready
function initButtonsAndForms() {
  const refreshBtn = document.getElementById('refreshBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const form = document.getElementById('broadcastForm');
  
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      if (isLoading) return;
      debouncedLoadAll();
    };
  }
  
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api.post('/admin/api/logout', {}).catch(() => {});
      window.location.href = '/admin/login';
    };
  }
  
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const messageEl = document.getElementById('broadcastMessage');
      const statusEl = document.getElementById('broadcastStatus');
      const message = (messageEl?.value || '').trim();
      const audience = document.getElementById('broadcastAudience')?.value || 'all';
      if (!message) return;
      
      const submitBtn = form.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.textContent : 'Send';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }
      
      if (statusEl) statusEl.textContent = 'Queueing...';
      
      try {
        const res = await api.post('/admin/api/broadcast', { message, audience });
        if (res && res.success) {
          if (statusEl) statusEl.textContent = `✅ Queued (job ${res.jobId || 'N/A'}, ${audience})`;
          if (messageEl) messageEl.value = '';
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        } else {
          if (statusEl) statusEl.textContent = `❌ ${res.error || 'Failed'}`;
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = `❌ Error: ${err.message || 'Failed'}`;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalText;
        }
      }
    });
  }
}

async function checkBroadcastStatus() {
  try {
    const res = await api.get('/admin/api/broadcast/status');
    if (res.success) {
      const meta = document.getElementById('broadcastMeta');
      if (meta) {
        meta.textContent = `Active: ${res.data.activeJobs} jobs`;
      }
    }
  } catch (err) {
    console.error('Broadcast status error:', err);
  }
}

async function loadAll() {
  if (isLoading) return;
  isLoading = true;
  
  try {
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading...';
    
    const [overview, users, settings, bots, recs] = await Promise.all([
      api.get('/admin/api/overview').catch((e) => { console.error('Overview API error:', e); return { success: false, data: {} }; }),
      api.get('/admin/api/users').catch((e) => { console.error('Users API error:', e); return { success: false, data: {} }; }),
      api.get('/admin/api/settings').catch((e) => { console.error('Settings API error:', e); return { success: false, data: {} }; }),
      api.get('/admin/api/bots').catch((e) => { console.error('Bots API error:', e); return { success: false, bots: [] }; }),
      api.get('/admin/api/recommendations').catch((e) => { console.error('Recs API error:', e); return { success: false, data: [] }; })
    ]);
    
    const settingsData = (settings && settings.data) ? settings.data : (settings && settings.config ? settings.config : {});
    
    console.log('Loaded data:', { 
      overview: overview?.data, 
      users: users?.data, 
      settings: settingsData, 
      bots: bots?.bots,
      settingsRaw: settings 
    });
    
    // Always render, even with empty data
    renderOverview(overview?.data || {});
    renderUsers(users?.data || {});
    renderSettings(settingsData);
    loadVipPlans(); // Load dynamic VIP plans
    renderLockPricing(settingsData);
    renderRequiredChannels(settingsData);
    renderBots((bots && bots.bots) ? bots.bots : []);
    renderRecommendations(recs?.data || []);
  } catch (error) {
    if (error.message === 'Unauthorized') {
      return;
    }
    console.error('Failed to load dashboard data:', error);
  } finally {
    isLoading = false;
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  }
}

function renderOverview(data = {}) {
  const container = document.getElementById('overviewCards');
  if (!container) {
    console.error('overviewCards container not found');
    return;
  }
  
  const cards = [
    { label: 'Total Users', value: data.totalUsers || 0 },
    { label: 'VIP Active', value: data.vipActive || 0 },
    { label: 'Active Chats', value: data.activeChats || 0 },
    { label: 'Stars Revenue (total)', value: data.totalStars || 0 }
  ];
  container.innerHTML = cards.map(c => cardTemplate(c.label, c.value)).join('');
}

function renderUsers(data = {}) {
  const metaContainer = document.getElementById('usersMeta');
  const cardsContainer = document.getElementById('userCards');
  
  if (metaContainer) {
    metaContainer.textContent = `${data.total || 0} total | ${data.vip || 0} VIP | ${data.lock || 0} lock credits`;
  }
  
  if (!cardsContainer) {
    console.error('userCards container not found');
    return;
  }
  
  const cards = [
    { label: 'Today New', value: data.today || 0 },
    { label: 'VIP Expiring (7d)', value: data.expiring || 0 },
    { label: 'Referrals', value: data.referrals || 0 }
  ];
  cardsContainer.innerHTML = cards.map(c => cardTemplate(c.label, c.value)).join('');
}

// Throttled config update to prevent spam
const updateConfig = throttle(async (key, value) => {
  try {
    const res = await api.post('/admin/api/config', { key, value });
    const input = document.querySelector(`[data-setting="${key}"]`);
    if (input) {
      input.classList.toggle('border-green-500', !!res.success);
      setTimeout(() => input.classList.remove('border-green-500'), 2000);
    }
  } catch (err) {
    console.error('Config update failed:', err);
  }
}, 1000);

function renderSettings(data = {}) {
  const container = document.getElementById('settingsList');
  if (!container) {
    console.error('settingsList container not found');
    return;
  }
  
  const entries = Object.entries(data || {});
  // Filter out VIP plans, lock pricing, and required channels (handled separately)
  const filteredEntries = entries.filter(([key]) => 
    !key.startsWith('vip_plan_') && 
    !key.startsWith('lock_chat_') && 
    !key.startsWith('required_channel_') &&
    key !== 'vip_plans_config'
  );
  
  container.innerHTML = filteredEntries.map(([key, value]) => settingRow(key, value)).join('');
  filteredEntries.forEach(([key]) => {
    const input = document.querySelector(`[data-setting="${key}"]`);
    if (input) {
      input.addEventListener('change', () => {
        const newValue = input.type === 'checkbox' ? input.checked : input.value;
        updateConfig(key, newValue);
      });
    }
  });
}

function cardTemplate(label, value) {
  return `<div class="p-3 card">
    <div class="text-xs text-slate-400">${label}</div>
    <div class="text-xl font-semibold mt-1">${value ?? '—'}</div>
  </div>`;
}

// Settings descriptions for better UX
const SETTINGS_DESCRIPTIONS = {
  'vip_enabled': 'Enable VIP System - Allow users to purchase VIP subscriptions',
  'lock_chat_enabled': 'Enable Lock Chat - Allow users to lock chats with Stars',
  'referral_enabled': 'Enable Referral System - Allow users to refer others and earn rewards',
  'required_channel_enabled': 'Enable Channel Requirement - Users must join channels to use bot'
};

function settingRow(key, value) {
  const isBool = typeof value === 'boolean';
  // Skip VIP plans, lock pricing, and required channels (handled separately)
  if (key.startsWith('vip_plan_') || key.startsWith('lock_chat_') || key.startsWith('required_channel_')) {
    return '';
  }
  const description = SETTINGS_DESCRIPTIONS[key] || (isBool ? 'Toggle this setting' : 'Configure this value');
  const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return `<div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
    <div class="flex-1">
      <div class="text-sm font-semibold">${displayKey}</div>
      <div class="text-xs text-slate-500">${description}</div>
    </div>
    <div>
      ${isBool
        ? `<input data-setting="${key}" type="checkbox" ${value ? 'checked' : ''} class="w-5 h-5" />`
        : `<input data-setting="${key}" value="${value}" class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm w-32" />`
      }
    </div>
  </div>`;
}

// Dynamic VIP Plans Management
let currentVipPlans = [];

async function loadVipPlans() {
  const container = document.getElementById('vipPlansList');
  if (!container) {
    console.error('❌ vipPlansList container not found');
    return;
  }
  
  // Show loading state
  container.innerHTML = '<div class="text-sm text-slate-400">Loading VIP plans...</div>';
  
  try {
    console.log('📡 Fetching VIP plans from API...');
    const res = await api.get('/admin/api/vip-plans');
    console.log('📦 VIP plans API response:', res);
    
    if (res && res.success && res.plans && res.plans.length > 0) {
      console.log(`✅ Loaded ${res.plans.length} VIP plans`);
      currentVipPlans = res.plans;
      renderVipPlans(res.plans);
      return;
    }
  } catch (err) {
    console.error('❌ Load VIP plans error:', err);
  }
  
  // Fallback: Try to get from settings API
  try {
    console.log('🔄 Trying fallback: settings API...');
    const settingsRes = await api.get('/admin/api/settings');
    console.log('📦 Settings API response:', settingsRes);
    
    if (settingsRes && settingsRes.success && settingsRes.data) {
      console.log('✅ Using legacy VIP plans from settings');
      renderVipPlansLegacy(settingsRes.data);
      return;
    }
  } catch (e) {
    console.error('❌ Fallback VIP plans load error:', e);
  }
  
  // Last resort: Show default plans
  console.log('⚠️ No VIP plans found, showing defaults');
  const defaultPlans = [
    { id: 'basic', name: 'BASIC', stars: 100, days: 4, enabled: true },
    { id: 'plus', name: 'PLUS', stars: 200, days: 7, enabled: true },
    { id: 'pro', name: 'PRO', stars: 300, days: 30, enabled: true },
    { id: 'half_year', name: 'HALF_YEAR', stars: 900, days: 182, enabled: true },
    { id: 'yearly', name: 'YEARLY', stars: 1500, days: 365, enabled: true }
  ];
  currentVipPlans = defaultPlans;
  renderVipPlans(defaultPlans);
}

function renderVipPlans(plans) {
  const container = document.getElementById('vipPlansList');
  if (!container) {
    console.error('vipPlansList container not found');
    return;
  }
  
  if (!plans || plans.length === 0) {
    container.innerHTML = '<div class="text-sm text-slate-400">No VIP plans configured</div>';
    return;
  }
  
  const html = plans.map((plan, index) => {
    const displayName = plan.name || plan.id.toUpperCase();
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-2">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold">Plan ${index + 1}</span>
          ${plans.length > 2 ? `<button onclick="deleteVipPlan('${plan.id}')" class="pill bg-red-600 text-white text-xs">Delete</button>` : '<span class="text-xs text-slate-500">Minimum 2 plans required</span>'}
        </div>
        <div class="mb-2">
          <label class="text-xs text-slate-400 block mb-1">Plan ID (unique)</label>
          <input data-plan-id="${plan.id}" data-plan-field="id" value="${plan.id}" type="text" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
        </div>
        <div class="mb-2">
          <label class="text-xs text-slate-400 block mb-1">Plan Name (can be empty)</label>
          <input data-plan-id="${plan.id}" data-plan-field="name" value="${plan.name || ''}" type="text" placeholder="${plan.id.toUpperCase()}" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
        </div>
        <div class="text-xs text-slate-500 mb-2">Display: ${displayName}</div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-slate-400">Stars</label>
            <input data-plan-id="${plan.id}" data-plan-field="stars" value="${plan.stars || 0}" type="number" min="0" max="10000" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm mt-1" />
          </div>
          <div>
            <label class="text-xs text-slate-400">Days</label>
            <input data-plan-id="${plan.id}" data-plan-field="days" value="${plan.days || 0}" type="number" min="1" max="365" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm mt-1" />
          </div>
        </div>
        <div class="mt-2">
          <label class="text-xs text-slate-400 flex items-center gap-2">
            <input data-plan-id="${plan.id}" data-plan-field="enabled" type="checkbox" ${plan.enabled !== false ? 'checked' : ''} class="w-4 h-4" />
            Enabled
          </label>
        </div>
      </div>
    `;
  }).join('');
  
  html += `
    <div class="mt-3">
      ${plans.length < 8 ? `<button onclick="addVipPlan()" class="pill bg-green-600 text-white text-sm">+ Add Plan</button>` : '<span class="text-xs text-slate-500">Maximum 8 plans</span>'}
      <button onclick="saveVipPlans()" class="pill bg-indigo-600 text-white text-sm ml-2">💾 Save All Plans</button>
    </div>
  `;
  
  document.getElementById('vipPlansList').innerHTML = html;
  attachVipPlanListeners();
}

function attachVipPlanListeners() {
  document.querySelectorAll('[data-plan-id]').forEach(input => {
    if (!input.hasAttribute('data-listener-attached')) {
      input.setAttribute('data-listener-attached', 'true');
      input.addEventListener('change', () => {
        const planId = input.getAttribute('data-plan-id');
        const field = input.getAttribute('data-plan-field');
        const value = input.type === 'checkbox' ? input.checked : (input.type === 'number' ? parseInt(input.value) || 0 : input.value);
        
        const plan = currentVipPlans.find(p => p.id === planId);
        if (plan) {
          plan[field] = value;
        }
      });
    }
  });
}

async function addVipPlan() {
  const newId = prompt('Enter unique plan ID (e.g., premium, ultimate):', 'plan_' + (currentVipPlans.length + 1));
  if (!newId || newId.trim() === '') {
    alert('Plan ID is required');
    return;
  }
  
  if (currentVipPlans.find(p => p.id === newId.trim())) {
    alert('Plan ID already exists');
    return;
  }
  
  currentVipPlans.push({
    id: newId.trim(),
    name: '',
    stars: 100,
    days: 7,
    enabled: true
  });
  
  renderVipPlans(currentVipPlans);
}

async function deleteVipPlan(planId) {
  if (!confirm(`Delete plan "${planId}"?`)) return;
  
  if (currentVipPlans.length <= 2) {
    alert('Must have at least 2 plans');
    return;
  }
  
  try {
    const res = await fetch(`/admin/api/vip-plans/${planId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data && data.success) {
      currentVipPlans = data.plans;
      renderVipPlans(currentVipPlans);
      alert('Plan deleted');
    } else {
      alert('Failed to delete plan: ' + (data?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Delete VIP plan error:', err);
    // Fallback: remove from local array
    currentVipPlans = currentVipPlans.filter(p => p.id !== planId);
    renderVipPlans(currentVipPlans);
    await saveVipPlans();
  }
}

async function saveVipPlans() {
  try {
    const res = await api.post('/admin/api/vip-plans', { plans: currentVipPlans });
    if (res && res.success) {
      alert('✅ VIP plans saved successfully!');
      currentVipPlans = res.plans;
      renderVipPlans(currentVipPlans);
    } else {
      alert('Failed to save plans: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Save VIP plans error:', err);
    alert('Failed to save plans: ' + (err.message || 'Unknown error'));
  }
}

// Legacy rendering (fallback)
function renderVipPlansLegacy(data = {}) {
  console.log('🔄 Rendering legacy VIP plans from settings');
  
  const plans = [
    { id: 'basic', defaultName: 'BASIC', starsKey: 'vip_plan_basic_stars', daysKey: 'vip_plan_basic_days', nameKey: 'vip_plan_basic_name' },
    { id: 'plus', defaultName: 'PLUS', starsKey: 'vip_plan_plus_stars', daysKey: 'vip_plan_plus_days', nameKey: 'vip_plan_plus_name' },
    { id: 'pro', defaultName: 'PRO', starsKey: 'vip_plan_pro_stars', daysKey: 'vip_plan_pro_days', nameKey: 'vip_plan_pro_name' },
    { id: 'half_year', defaultName: 'HALF_YEAR', starsKey: 'vip_plan_half_year_stars', daysKey: 'vip_plan_half_year_days', nameKey: 'vip_plan_half_year_name' },
    { id: 'yearly', defaultName: 'YEARLY', starsKey: 'vip_plan_yearly_stars', daysKey: 'vip_plan_yearly_days', nameKey: 'vip_plan_yearly_name' }
  ];
  
  const container = document.getElementById('vipPlansList');
  if (!container) {
    console.error('❌ vipPlansList container not found');
    return;
  }
  
  // Convert legacy format to dynamic format
  const dynamicPlans = plans.map(plan => ({
    id: plan.id,
    name: data[plan.nameKey] || plan.defaultName,
    stars: parseInt(data[plan.starsKey]) || 0,
    days: parseInt(data[plan.daysKey]) || 0,
    enabled: true
  }));
  
  console.log('✅ Converted legacy plans to dynamic format:', dynamicPlans);
  currentVipPlans = dynamicPlans;
  renderVipPlans(dynamicPlans);
}

function renderLockPricing(data = {}) {
  const container = document.getElementById('lockPricingList');
  if (!container) {
    console.error('❌ lockPricingList container not found');
    return;
  }
  
  console.log('🔒 Rendering lock chat pricing:', data);
  
  const enabled = data.lock_chat_enabled !== false;
  const durations = [
    { min: 5, key: 'lock_chat_5min_price', label: '5 Minutes' },
    { min: 10, key: 'lock_chat_10min_price', label: '10 Minutes' },
    { min: 15, key: 'lock_chat_15min_price', label: '15 Minutes' }
  ];
  
  let html = `
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-3">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold">Enable Lock Chat</div>
          <div class="text-xs text-slate-500">Allow users to lock chats with Stars</div>
        </div>
        <input data-setting="lock_chat_enabled" type="checkbox" ${enabled ? 'checked' : ''} class="w-5 h-5" />
      </div>
    </div>
  `;
  
  html += durations.map(d => {
    const price = data[d.key] || 0;
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-2">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <div class="text-sm font-semibold">${d.label}</div>
            <div class="text-xs text-slate-500">Price in Stars</div>
          </div>
          <div class="w-32">
            <input data-setting="${d.key}" value="${price}" type="number" min="0" max="1000" step="1" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
  attachConfigListeners();
}

function renderRequiredChannels(data = {}) {
  const container = document.getElementById('requiredChannelsList');
  if (!container) {
    console.error('❌ requiredChannelsList container not found');
    return;
  }
  
  console.log('📢 Rendering required channels:', data);
  
  const enabled = data.required_channel_enabled || false;
  const ch1 = data.required_channel_1 || '';
  const ch2 = data.required_channel_2 || '';
  
  const html = `
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-3">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-sm font-semibold">Enable Channel Requirement</div>
          <div class="text-xs text-slate-500">Users must join channels to use bot (revenue source)</div>
        </div>
        <input data-setting="required_channel_enabled" type="checkbox" ${enabled ? 'checked' : ''} class="w-5 h-5" />
      </div>
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-2">
      <label class="text-xs text-slate-400 block mb-1">Required Channel 1</label>
      <input data-setting="required_channel_1" value="${ch1}" type="text" placeholder="@channel1 or -100XXXXX" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
      <div class="text-xs text-slate-500 mt-1">Enter @username or numeric ID (e.g., -1001234567890)</div>
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <label class="text-xs text-slate-400 block mb-1">Required Channel 2 (Optional)</label>
      <input data-setting="required_channel_2" value="${ch2}" type="text" placeholder="@channel2 or -100XXXXX" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
      <div class="text-xs text-slate-500 mt-1">Optional second channel for promotion</div>
    </div>
  `;
  
  container.innerHTML = html;
  attachConfigListeners();
}

function renderBots(bots) {
  if (!bots || bots.length === 0) {
    document.getElementById('botsList').innerHTML = '<div class="text-sm text-slate-400">No bots configured</div>';
    return;
  }
  
  const html = bots.map((bot, idx) => `
    <div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <div>
        <div class="text-sm font-semibold">${bot.id}</div>
        <div class="text-xs text-slate-500">${bot.token}</div>
      </div>
      <button onclick="removeBot(${idx})" class="pill bg-red-600 text-white border-red-500 text-xs">Remove</button>
    </div>
  `).join('');
  
  document.getElementById('botsList').innerHTML = html;
}

// Recommendations Panel
function renderRecommendations(recs) {
  const container = document.getElementById('recommendationsPanel');
  if (!container) return;
  if (!recs || recs.length === 0) {
    container.innerHTML = '<div class="text-sm text-slate-400">No recommendations at this time</div>';
    return;
  }
  const colors = { high: 'red', medium: 'yellow', low: 'blue' };
  const html = recs.map(r => `
    <div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <div>
        <div class="text-sm font-semibold">${r.title}</div>
        <div class="text-xs text-slate-500">${r.reason}</div>
      </div>
      <button onclick="handleRecommendationAction('${r.action}')" class="pill bg-${colors[r.severity] || 'indigo'}-600 text-white border-${colors[r.severity] || 'indigo'}-500 text-xs">Apply</button>
    </div>
  `).join('');
  container.innerHTML = html;
}

async function handleRecommendationAction(action) {
  switch (action) {
    case 'enable-vip':
      await updateConfig('vip_enabled', true);
      break;
    case 'review-vip-plans':
      document.getElementById('vipPlansList')?.scrollIntoView({ behavior: 'smooth' });
      break;
    case 'toggle-referral':
      await toggleReferralEnabled(true);
      break;
    case 'open-channels':
      document.getElementById('requiredChannelsList')?.scrollIntoView({ behavior: 'smooth' });
      break;
    case 'toggle-lock':
      await updateConfig('lock_chat_enabled', true);
      break;
    case 'check-health':
      document.getElementById('systemHealth')?.scrollIntoView({ behavior: 'smooth' });
      break;
    case 'open-broadcast':
      document.getElementById('broadcastMessage')?.focus();
      break;
    default:
      break;
  }
  loadAll();
}

async function addBot() {
  const tokenInput = document.getElementById('newBotToken');
  const token = tokenInput.value.trim();
  
  if (!token || token.length < 20) {
    alert('Invalid bot token');
    return;
  }
  
  const res = await api.post('/admin/api/bots', { token });
  if (res.success) {
    alert(`✅ Bot added! Total bots: ${res.totalBots}\n\n⚠️ Restart the bot to apply changes:\npm2 restart bot`);
    tokenInput.value = '';
    loadAll();
  } else {
    alert('Failed to add bot: ' + (res.error || 'Unknown error'));
  }
}

async function removeBot(index) {
  if (!confirm(`Remove bot ${index}? You'll need to restart after this.`)) return;
  
  const res = await fetch(`/admin/api/bots/${index}`, {
    method: 'DELETE',
    credentials: 'include'
  }).then(r => r.json());
  
  if (res.success) {
    alert(`✅ Bot removed! Total bots: ${res.totalBots}\n\n⚠️ Restart the bot to apply changes:\npm2 restart bot`);
    loadAll();
  } else {
    alert('Failed to remove bot: ' + (res.error || 'Unknown error'));
  }
}

function attachConfigListeners() {
  document.querySelectorAll('[data-setting]').forEach(input => {
    if (!input.hasAttribute('data-listener-attached')) {
      input.setAttribute('data-listener-attached', 'true');
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-setting');
        const newValue = input.type === 'checkbox' ? input.checked : input.value;
        updateConfig(key, newValue);
      });
    }
  });
}

// Referral Control
async function loadReferrals() {
  try {
    const res = await api.get('/admin/api/referrals');
    if (res.success) {
      renderReferrals(res.data);
      const toggle = document.getElementById('referralToggle');
      if (toggle) {
        toggle.checked = !!res.data.enabled;
        toggle.onchange = () => toggleReferralEnabled(toggle.checked);
      }
    }
  } catch (err) {
    console.error('Load referrals error:', err);
  }
}

function renderReferrals(data) {
  const container = document.getElementById('referralPanel');
  if (!container) return;
  const summary = data.summary || {};
  const top = data.topInviters || [];
  const refs = data.referrals || [];
  const rewards = data.rewards || [];

  const summaryHtml = `
    <div class="grid-auto">
      ${cardTemplate('Total Referrals', summary.total || 0)}
      ${cardTemplate('Pending', summary.pending || 0)}
      ${cardTemplate('Accepted', summary.accepted || 0)}
      ${cardTemplate('Invalid', summary.invalid || 0)}
      ${cardTemplate('VIP Days Rewarded', summary.rewardsVipDays || 0)}
    </div>`;

  const topHtml = top.length > 0 ? `
    <div class="mt-3">
      <div class="text-sm font-semibold mb-2">Top Inviters</div>
      <div class="space-y-2">
        ${top.map(t => `<div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"><span>${t.inviterId}</span><span class="text-xs text-slate-500">${t.count} invites</span></div>`).join('')}
      </div>
    </div>` : '';

  const listHtml = refs.length > 0 ? `
    <div class="mt-3">
      <div class="text-sm font-semibold mb-2">Recent Referrals</div>
      <div class="space-y-2">
        ${refs.map(r => `<div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"><span>${r.inviterId} → ${r.invitedId}</span><span class="text-xs text-slate-500">${r.status}</span></div>`).join('')}
      </div>
    </div>` : '';

  const rewardsHtml = rewards.length > 0 ? `
    <div class="mt-3">
      <div class="text-sm font-semibold mb-2">Recent Rewards</div>
      <div class="space-y-2">
        ${rewards.map(w => `<div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2"><span>${w.userId}</span><span class="text-xs text-slate-500">${w.vipDaysGranted} days • ${w.source}</span></div>`).join('')}
      </div>
    </div>` : '';

  container.innerHTML = summaryHtml + topHtml + listHtml + rewardsHtml;
}

async function toggleReferralEnabled(enabled) {
  try {
    await api.post('/admin/api/referrals/toggle', { enabled });
    loadReferrals();
  } catch (err) {
    console.error('Toggle referral error:', err);
  }
}

// User Management Functions
let currentUserPage = 1;
let currentUserQuery = '';
let currentUserFilter = '';

async function searchUsers(page = 1) {
  const query = document.getElementById('userSearch')?.value.trim() || '';
  const filter = document.getElementById('userFilter')?.value || '';
  currentUserPage = page;
  currentUserQuery = query;
  currentUserFilter = filter;
  
  const params = new URLSearchParams({ page, limit: 20 });
  if (query) params.append('q', query);
  if (filter) params.append('banned', filter);
  
  try {
    const res = await api.get(`/admin/api/users/search?${params}`);
    if (res.success) {
      renderUserSearchResults(res.data, res.pagination);
    }
  } catch (err) {
    console.error('Search users error:', err);
  }
}

function renderUserSearchResults(users, pagination) {
  const container = document.getElementById('userSearchResults');
  if (!container) return;
  if (!users || users.length === 0) {
    container.innerHTML = '<div class="text-sm text-slate-400">No users found</div>';
    return;
  }
  
  const html = users.map(user => `
    <div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <div>
        <div class="text-sm font-semibold">ID: ${user.telegramId}</div>
        <div class="text-xs text-slate-500">${user.gender || 'N/A'} • ${user.age || 'N/A'} • Chats: ${user.totalChats || 0}</div>
      </div>
      <div class="flex gap-2">
        <button onclick="viewUserDetails(${user.userId})" class="pill bg-blue-600 text-white border-blue-500 text-xs">Details</button>
        ${user.banned ? 
          `<button onclick="unbanUser(${user.userId})" class="pill bg-green-600 text-white text-xs">Unban</button>` :
          `<button onclick="banUser(${user.userId})" class="pill bg-red-600 text-white text-xs">Ban</button>`
        }
      </div>
    </div>
  `).join('');
  
  container.innerHTML = html;
  
  const paginationEl = document.getElementById('userPagination');
  if (paginationEl) {
    paginationEl.innerHTML = `
      <div class="flex items-center justify-between">
        <span>Page ${pagination.page} of ${pagination.pages} (${pagination.total} total)</span>
        <div class="flex gap-2">
          ${pagination.page > 1 ? `<button onclick="searchUsers(${pagination.page - 1})" class="pill text-xs">Previous</button>` : ''}
          ${pagination.page < pagination.pages ? `<button onclick="searchUsers(${pagination.page + 1})" class="pill text-xs">Next</button>` : ''}
        </div>
      </div>
    `;
  }
}

async function viewUserDetails(userId) {
  try {
    const res = await api.get(`/admin/api/users/${userId}/details`);
    if (res && res.success && res.data) {
      const data = res.data;
      const modal = `
        <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div class="bg-slate-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold">User Details</h3>
              <button onclick="closeModal()" class="text-slate-400 hover:text-white">✕</button>
            </div>
            <div class="space-y-3 text-sm">
              <div><strong>User ID:</strong> ${data.user.userId}</div>
              <div><strong>Telegram ID:</strong> ${data.user.telegramId}</div>
              <div><strong>Gender:</strong> ${data.user.gender || 'N/A'}</div>
              <div><strong>Age:</strong> ${data.user.age || 'N/A'}</div>
              <div><strong>Total Chats:</strong> ${data.user.totalChats || 0}</div>
              <div><strong>Active Chats:</strong> ${data.activeChats || 0}</div>
              <div><strong>Banned:</strong> ${data.user.banned ? 'Yes' : 'No'}</div>
              ${data.vip ? `<div><strong>VIP:</strong> Expires ${new Date(data.vip.expiresAt).toLocaleDateString()} ${data.vip.isActive ? '(Active)' : '(Expired)'}</div>` : '<div><strong>VIP:</strong> No VIP subscription</div>'}
              <div><strong>Registered:</strong> ${new Date(data.user.createdAt).toLocaleDateString()}</div>
              ${data.recentTransactions && data.recentTransactions.length > 0 ? `
                <div><strong>Recent Transactions:</strong>
                  <ul class="list-disc list-inside mt-1">
                    ${data.recentTransactions.map(t => `<li>${t.amount}⭐ - ${new Date(t.date).toLocaleDateString()}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            </div>
            <div class="flex gap-2 mt-4">
              ${data.user.banned ? 
                `<button onclick="unbanUser(${data.user.userId})" class="pill bg-green-600 text-white text-sm">Unban</button>` :
                `<button onclick="banUser(${data.user.userId})" class="pill bg-red-600 text-white text-sm">Ban</button>`
              }
              <button onclick="grantVipToUser(${data.user.userId})" class="pill bg-purple-600 text-white text-sm">Grant VIP</button>
              <button onclick="closeModal()" class="pill text-sm">Close</button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modal);
    } else {
      alert('Failed to load user details: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('View user details error:', err);
    alert('Failed to load user details: ' + (err.message || 'Unknown error'));
  }
}

function closeModal() {
  const modal = document.querySelector('.fixed.inset-0');
  if (modal) modal.remove();
}

async function banUser(userId) {
  if (!confirm('Are you sure you want to ban this user?')) return;
  
  try {
    const res = await api.post(`/admin/api/user/${userId}/ban`, { banned: true });
    if (res && res.success) {
      alert(res.message || 'User banned successfully');
      closeModal();
      if (currentUserQuery || currentUserFilter) {
        searchUsers(currentUserPage);
      } else {
        loadAll();
      }
    } else {
      alert('Failed to ban user: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Ban user error:', err);
    alert('Failed to ban user: ' + (err.message || 'Unknown error'));
  }
}

async function unbanUser(userId) {
  if (!confirm('Are you sure you want to unban this user?')) return;
  
  try {
    const res = await api.post(`/admin/api/user/${userId}/ban`, { banned: false });
    if (res && res.success) {
      alert(res.message || 'User unbanned successfully');
      closeModal();
      if (currentUserQuery || currentUserFilter) {
        searchUsers(currentUserPage);
      } else {
        loadAll();
      }
    } else {
      alert('Failed to unban user: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Unban user error:', err);
    alert('Failed to unban user: ' + (err.message || 'Unknown error'));
  }
}

// Legacy function for backward compatibility
async function toggleBan(userId, currentlyBanned) {
  if (currentlyBanned) {
    await unbanUser(userId);
  } else {
    await banUser(userId);
  }
}

// Active Chats Functions
async function loadActiveChats() {
  try {
    const res = await api.get('/admin/api/chats/active');
    if (res.success) {
      renderActiveChats(res.data, res.total);
    }
  } catch (err) {
    console.error('Load active chats error:', err);
  }
}

function renderActiveChats(chats, total) {
  const container = document.getElementById('activeChatsList');
  if (!container) return;
  if (!chats || chats.length === 0) {
    container.innerHTML = '<div class="text-sm text-slate-400">No active chats</div>';
    return;
  }
  
  const html = chats.map(chat => `
    <div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <div>
        <div class="text-sm font-semibold">Chat ${chat.chatId}</div>
        <div class="text-xs text-slate-500">Users: ${chat.user1} & ${chat.user2} • Duration: ${chat.duration}</div>
      </div>
      <button onclick="disconnectChat(${chat.chatId})" class="pill bg-red-600 text-white border-red-500 text-xs">Disconnect</button>
    </div>
  `).join('');
  
  container.innerHTML = html + `<div class="text-xs text-slate-400 mt-2">Total: ${total} active chats</div>`;
}

async function disconnectChat(chatId) {
  if (!confirm('Are you sure you want to disconnect this chat?')) return;
  
  try {
    const res = await api.post(`/admin/api/chats/${chatId}/disconnect`, {});
    if (res && res.success) {
      alert(res.message || 'Chat disconnected successfully');
      loadActiveChats();
    } else {
      alert('Failed to disconnect chat: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Disconnect chat error:', err);
    alert('Failed to disconnect chat: ' + (err.message || 'Unknown error'));
  }
}

// Grant VIP to User
async function grantVipToUser(userId) {
  const days = prompt('Enter VIP duration in days:', '30');
  if (!days || isNaN(days) || parseInt(days) <= 0) {
    alert('Invalid number of days');
    return;
  }
  
  try {
    const res = await api.post(`/admin/api/user/${userId}/grant-vip`, { days: parseInt(days) });
    if (res && res.success) {
      alert(res.message || `VIP granted for ${days} days`);
      closeModal();
      viewUserDetails(userId); // Refresh user details
    } else {
      alert('Failed to grant VIP: ' + (res?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Grant VIP error:', err);
    alert('Failed to grant VIP: ' + (err.message || 'Unknown error'));
  }
}

// System Control Functions
async function loadSystemHealth() {
  try {
    const res = await api.get('/admin/api/system/health');
    if (res.success) {
      renderSystemHealth(res.data);
    }
  } catch (err) {
    console.error('Load system health error:', err);
  }
}

function renderSystemHealth(data) {
  const container = document.getElementById('systemHealth');
  if (!container) return;
  const dbStatus = data.database === 'connected' ? '🟢' : '🔴';
  const redisStatus = data.redis === 'connected' ? '🟢' : '🔴';
  const botsStatus = data.bots.map(b => `${b.status === 'online' ? '🟢' : '🔴'} ${b.id}`).join(', ');
  
  container.innerHTML = `
    <div class="grid grid-cols-3 gap-3 mb-3">
      <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
        <div class="text-xs text-slate-400">Database</div>
        <div class="text-sm font-semibold">${dbStatus} ${data.database}</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
        <div class="text-xs text-slate-400">Redis</div>
        <div class="text-sm font-semibold">${redisStatus} ${data.redis}</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
        <div class="text-xs text-slate-400">Bots</div>
        <div class="text-sm font-semibold">${botsStatus}</div>
      </div>
    </div>
  `;
}

async function clearCache() {
  if (!confirm('Clear admin cache? This will refresh all cached data.')) return;
  
  try {
    const res = await api.post('/admin/api/system/emergency', { action: 'clear-cache' });
    if (res.success) {
      alert(res.message);
      loadAll();
    }
  } catch (err) {
    alert('Failed to clear cache: ' + (err.message || 'Unknown error'));
  }
}

async function stopBroadcasts() {
  if (!confirm('Stop all queued broadcasts? This cannot be undone.')) return;
  
  try {
    const res = await api.post('/admin/api/system/emergency', { action: 'stop-broadcasts' });
    if (res.success) {
      alert(res.message);
    }
  } catch (err) {
    alert('Failed to stop broadcasts: ' + (err.message || 'Unknown error'));
  }
}

// Config Presets Functions
async function savePreset() {
  const name = document.getElementById('presetName')?.value.trim();
  if (!name) {
    alert('Please enter a preset name');
    return;
  }
  
  try {
    // Get current config
    const cfgRes = await api.get('/admin/api/config');
    if (cfgRes.success) {
      const payload = cfgRes.config || cfgRes.data || {};
      const res = await api.post('/admin/api/config/preset', { name, config: payload });
      if (res.success) {
        alert('Preset saved!');
        document.getElementById('presetName').value = '';
        loadPresets();
      }
    }
  } catch (err) {
    alert('Failed to save preset: ' + (err.message || 'Unknown error'));
  }
}

async function loadPresets() {
  try {
    const res = await api.get('/admin/api/config/presets');
    if (res.success) {
      const container = document.getElementById('presetsList');
      if (container) {
        if (res.data.length === 0) {
          container.innerHTML = 'No presets saved';
        } else {
          container.innerHTML = res.data.map(p => `
            <button onclick="loadPreset('${p.name}')" class="pill text-xs mr-2 mb-2">
              ${p.name} (${new Date(p.updatedAt).toLocaleDateString()})
            </button>
          `).join('');
        }
      }
    }
  } catch (err) {
    console.error('Load presets error:', err);
  }
}

async function loadPreset(name) {
  if (!confirm(`Load preset "${name}"? This will replace current config.`)) return;
  
  try {
    const res = await api.post('/admin/api/config/preset/load', { name });
    if (res.success) {
      // Apply preset config
      for (const [key, value] of Object.entries(res.data)) {
        await api.post('/admin/api/config', { key, value }).catch(() => {});
      }
      alert('Preset loaded! Refreshing...');
      loadAll();
    }
  } catch (err) {
    alert('Failed to load preset: ' + (err.message || 'Unknown error'));
  }
}

// Monitoring Functions
async function loadMonitoringStats() {
  try {
    const res = await api.get('/admin/api/monitoring/stats');
    if (res.success) {
      renderMonitoringStats(res.data);
    }
  } catch (err) {
    console.error('Load monitoring stats error:', err);
  }
}

function renderMonitoringStats(data) {
  const container = document.getElementById('monitoringStats');
  if (!container) return;
  
  const cards = [
    { label: 'Total Users', value: data.totalUsers || 0 },
    { label: 'Active Chats', value: data.activeChats || 0 },
    { label: 'VIP Active', value: data.vipActive || 0 }
  ];
  
  container.innerHTML = cards.map(c => cardTemplate(c.label, c.value)).join('');
}

async function loadErrorLogs() {
  try {
    const res = await api.get('/admin/api/logs/errors');
    if (res.success) {
      renderErrorLogs(res.data);
    }
  } catch (err) {
    console.error('Load error logs error:', err);
  }
}

function renderErrorLogs(errors) {
  const container = document.getElementById('errorLogs');
  if (!container) return;
  
  if (!errors || errors.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400">No errors found</div>';
    return;
  }
  
  const html = errors.slice(0, 20).map(err => {
    const date = err.ts ? new Date(err.ts).toLocaleString() : 'Unknown';
    const message = err.message || 'Unknown error';
    return `
      <div class="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs">
        <div class="text-red-400">${message}</div>
        <div class="text-slate-500">${date}</div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

// Initialize event listeners when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEventListeners);
} else {
  initEventListeners();
  makeFunctionsGlobal(); // Also make global on load
}

// Make functions global immediately if DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', makeFunctionsGlobal);
} else {
  makeFunctionsGlobal();
}

function initEventListeners() {
  const searchBtn = document.getElementById('searchUsersBtn');
  const userSearch = document.getElementById('userSearch');
  const refreshChatsBtn = document.getElementById('refreshChatsBtn');
  const refreshSystemBtn = document.getElementById('refreshSystemBtn');
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  const stopBroadcastsBtn = document.getElementById('stopBroadcastsBtn');
  const checkBroadcastStatusBtn = document.getElementById('checkBroadcastStatusBtn');
  const refreshMonitoringBtn = document.getElementById('refreshMonitoringBtn');
  const refreshReferralsBtn = document.getElementById('refreshReferralsBtn');
  const refreshRecsBtn = document.getElementById('refreshRecsBtn');
  
  // Make all functions globally accessible for onclick handlers
  makeFunctionsGlobal();
  
  if (searchBtn) searchBtn.onclick = () => searchUsers(1);
  if (userSearch) {
    userSearch.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchUsers(1);
    });
  }
  if (refreshChatsBtn) refreshChatsBtn.onclick = loadActiveChats;
  if (refreshSystemBtn) refreshSystemBtn.onclick = loadSystemHealth;
  if (clearCacheBtn) clearCacheBtn.onclick = clearCache;
  if (stopBroadcastsBtn) stopBroadcastsBtn.onclick = stopBroadcasts;
  if (checkBroadcastStatusBtn) checkBroadcastStatusBtn.onclick = checkBroadcastStatus;
  if (refreshMonitoringBtn) refreshMonitoringBtn.onclick = () => {
    loadMonitoringStats();
    loadErrorLogs();
  };
  if (refreshReferralsBtn) refreshReferralsBtn.onclick = loadReferrals;
  if (refreshRecsBtn) refreshRecsBtn.onclick = async () => {
    try {
      const res = await api.get('/admin/api/recommendations');
      renderRecommendations(res?.data || []);
    } catch (e) {
      console.error('Refresh recs error:', e);
    }
  };
}

// Initialize everything when DOM is ready
function initializeAdminPanel() {
  console.log('🚀 Initializing admin panel...');
  
  // Verify containers exist
  const containers = {
    vipPlansList: document.getElementById('vipPlansList'),
    lockPricingList: document.getElementById('lockPricingList'),
    requiredChannelsList: document.getElementById('requiredChannelsList'),
    overviewCards: document.getElementById('overviewCards'),
    userCards: document.getElementById('userCards'),
    settingsList: document.getElementById('settingsList')
  };
  
  const missingContainers = Object.entries(containers)
    .filter(([name, el]) => !el)
    .map(([name]) => name);
  
  if (missingContainers.length > 0) {
    console.error('❌ Missing containers:', missingContainers);
  } else {
    console.log('✅ All containers found');
  }
  
  // Initialize buttons and forms
  initButtonsAndForms();
  initEventListeners();
  makeFunctionsGlobal();
  
  // Load all data immediately
  console.log('📊 Loading admin panel data...');
  loadAll();
  loadActiveChats();
  loadSystemHealth();
  loadPresets();
  loadMonitoringStats();
  loadErrorLogs();
  loadReferrals();
  try { const res = await api.get('/admin/api/recommendations'); renderRecommendations(res?.data || []); } catch (_) {}
}

// Initialize when DOM is ready (only once)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAdminPanel, { once: true });
} else {
  // DOM already loaded, initialize immediately
  initializeAdminPanel();
}

// Ensure onclick handlers work by exporting to window
function makeFunctionsGlobal() {
  window.addBot = addBot;
  window.removeBot = removeBot;
  window.searchUsers = searchUsers;
  window.viewUserDetails = viewUserDetails;
  window.banUser = banUser;
  window.unbanUser = unbanUser;
  window.disconnectChat = disconnectChat;
  window.grantVipToUser = grantVipToUser;
  window.clearCache = clearCache;
  window.stopBroadcasts = stopBroadcasts;
  window.addVipPlan = addVipPlan;
  window.deleteVipPlan = deleteVipPlan;
  window.saveVipPlans = saveVipPlans;
  window.handleRecommendationAction = handleRecommendationAction;
}