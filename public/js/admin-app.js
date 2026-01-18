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

const overviewCards = document.getElementById('overviewCards');
const userCards = document.getElementById('userCards');
const settingsList = document.getElementById('settingsList');
const usersMeta = document.getElementById('usersMeta');
const broadcastMeta = document.getElementById('broadcastMeta');
const broadcastForm = document.getElementById('broadcastForm');
const broadcastMessage = document.getElementById('broadcastMessage');
const broadcastStatus = document.getElementById('broadcastStatus');

document.getElementById('refreshBtn').onclick = loadAll;
document.getElementById('logoutBtn').onclick = async () => {
  await api.post('/admin/api/logout', {});
  window.location.href = '/admin/login';
};

broadcastForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = (broadcastMessage.value || '').trim();
  if (!message) return;
  broadcastStatus.textContent = 'Queueing...';
  const res = await api.post('/admin/api/broadcast', { message });
  if (res && res.success) {
    broadcastStatus.textContent = `Queued (job ${res.jobId}, ${res.impl})`;
    broadcastMessage.value = '';
  } else {
    broadcastStatus.textContent = res.error || 'Failed';
  }
});

async function loadAll() {
  try {
    const [overview, users, settings, bots] = await Promise.all([
      api.get('/admin/api/overview').catch(() => ({ success: false, data: {} })),
      api.get('/admin/api/users').catch(() => ({ success: false, data: {} })),
      api.get('/admin/api/settings').catch(() => ({ success: false, data: {} })),
      api.get('/admin/api/bots').catch(() => ({ success: false, bots: [] }))
    ]);
    renderOverview(overview.data || {});
    renderUsers(users.data || {});
    renderSettings(settings.data || {});
    renderVipPlans(settings.data || {});
    renderLockPricing(settings.data || {});
    renderRequiredChannels(settings.data || {});
    renderBots((bots && bots.bots) ? bots.bots : []);
  } catch (error) {
    if (error.message === 'Unauthorized') {
      // Already redirected
      return;
    }
    console.error('Failed to load dashboard data:', error);
  }
}

function renderOverview(data) {
  const cards = [
    { label: 'Total Users', value: data.totalUsers },
    { label: 'VIP Active', value: data.vipActive },
    { label: 'Active Chats', value: data.activeChats },
    { label: 'Stars Revenue (total)', value: data.totalStars }
  ];
  overviewCards.innerHTML = cards.map(c => cardTemplate(c.label, c.value)).join('');
}

function renderUsers(data) {
  usersMeta.textContent = `${data.total || 0} total | ${data.vip || 0} VIP | ${data.lock || 0} lock credits`;
  const cards = [
    { label: 'Today New', value: data.today || 0 },
    { label: 'VIP Expiring (7d)', value: data.expiring || 0 },
    { label: 'Referrals', value: data.referrals || 0 }
  ];
  userCards.innerHTML = cards.map(c => cardTemplate(c.label, c.value)).join('');
}

function renderSettings(data) {
  const entries = Object.entries(data || {});
  settingsList.innerHTML = entries.map(([key, value]) => settingRow(key, value)).join('');
  entries.forEach(([key]) => {
    const input = document.querySelector(`[data-setting="${key}"]`);
    if (input) {
      input.addEventListener('change', async () => {
        const newValue = input.type === 'checkbox' ? input.checked : input.value;
        const res = await api.post('/admin/api/config', { key, value: newValue });
        input.classList.toggle('border-green-500', !!res.success);
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

function settingRow(key, value) {
  const isBool = typeof value === 'boolean';
  // Skip VIP plans, lock pricing, and required channels (handled separately)
  if (key.startsWith('vip_plan_') || key.startsWith('lock_chat_') || key.startsWith('required_channel_')) {
    return '';
  }
  return `<div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
    <div>
      <div class="text-sm font-semibold">${key}</div>
      <div class="text-xs text-slate-500">${isBool ? 'boolean' : 'value'}</div>
    </div>
    <div>
      ${isBool
        ? `<input data-setting="${key}" type="checkbox" ${value ? 'checked' : ''} class="w-5 h-5" />`
        : `<input data-setting="${key}" value="${value}" class="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />`
      }
    </div>
  </div>`;
}

function renderVipPlans(data) {
  const plans = [
    { id: 'basic', name: 'BASIC', starsKey: 'vip_plan_basic_stars', daysKey: 'vip_plan_basic_days' },
    { id: 'plus', name: 'PLUS', starsKey: 'vip_plan_plus_stars', daysKey: 'vip_plan_plus_days' },
    { id: 'pro', name: 'PRO', starsKey: 'vip_plan_pro_stars', daysKey: 'vip_plan_pro_days' },
    { id: 'half_year', name: 'HALF_YEAR (6 months)', starsKey: 'vip_plan_half_year_stars', daysKey: 'vip_plan_half_year_days' },
    { id: 'yearly', name: 'YEARLY', starsKey: 'vip_plan_yearly_stars', daysKey: 'vip_plan_yearly_days' }
  ];
  
  const html = plans.map(plan => {
    const stars = data[plan.starsKey] || 0;
    const days = data[plan.daysKey] || 0;
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
        <div class="text-sm font-semibold mb-2">${plan.name}</div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="text-xs text-slate-400">Stars</label>
            <input data-setting="${plan.starsKey}" value="${stars}" type="number" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm mt-1" />
          </div>
          <div>
            <label class="text-xs text-slate-400">Days</label>
            <input data-setting="${plan.daysKey}" value="${days}" type="number" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm mt-1" />
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  document.getElementById('vipPlansList').innerHTML = html;
  attachConfigListeners();
}

function renderLockPricing(data) {
  const durations = [
    { min: 5, key: 'lock_chat_5min_price' },
    { min: 10, key: 'lock_chat_10min_price' },
    { min: 15, key: 'lock_chat_15min_price' }
  ];
  
  const html = durations.map(d => {
    const price = data[d.key] || 0;
    return `
      <div class="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
        <div>
          <div class="text-sm font-semibold">${d.min} Minutes</div>
          <div class="text-xs text-slate-500">Lock chat duration</div>
        </div>
        <div class="w-32">
          <input data-setting="${d.key}" value="${price}" type="number" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
        </div>
      </div>
    `;
  }).join('');
  
  document.getElementById('lockPricingList').innerHTML = html;
  attachConfigListeners();
}

function renderRequiredChannels(data) {
  const enabled = data.required_channel_enabled || false;
  const ch1 = data.required_channel_1 || '';
  const ch2 = data.required_channel_2 || '';
  
  const html = `
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-3">
      <div class="flex items-center justify-between mb-3">
        <div class="text-sm font-semibold">Enable Channel Requirement</div>
        <input data-setting="required_channel_enabled" type="checkbox" ${enabled ? 'checked' : ''} class="w-5 h-5" />
      </div>
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 mb-2">
      <label class="text-xs text-slate-400 block mb-1">Required Channel 1</label>
      <input data-setting="required_channel_1" value="${ch1}" type="text" placeholder="@channel1 or -100XXXXX" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
    </div>
    <div class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
      <label class="text-xs text-slate-400 block mb-1">Required Channel 2</label>
      <input data-setting="required_channel_2" value="${ch2}" type="text" placeholder="@channel2 or -100XXXXX" class="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm" />
    </div>
  `;
  
  document.getElementById('requiredChannelsList').innerHTML = html;
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
      input.addEventListener('change', async () => {
        const key = input.getAttribute('data-setting');
        const newValue = input.type === 'checkbox' ? input.checked : input.value;
        const res = await api.post('/admin/api/config', { key, value: newValue });
        input.classList.toggle('border-green-500', !!res.success);
        if (res.success) {
          setTimeout(() => input.classList.remove('border-green-500'), 2000);
        }
      });
    }
  });
}

loadAll();
