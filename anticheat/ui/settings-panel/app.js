(() => {
  const resourceName = (typeof GetParentResourceName === 'function') ? GetParentResourceName() : 'anticheat';

  const CATEGORIES = [
    { key: 'movement', label: 'Movement', protections: ['noclip', 'fly', 'freecam', 'teleport', 'speedhack', 'superJump', 'infiniteStamina', 'gravity'] },
    { key: 'player', label: 'Player', protections: ['godmode'] },
    { key: 'combat', label: 'Combat', protections: ['aimbot'] },
    { key: 'weapons', label: 'Weapons', protections: ['weapon'] },
    { key: 'vehicles', label: 'Vehicles', protections: ['vehicleGodmode', 'vehicleSpeed', 'vehicleThrow', 'vehicleSpawn'] },
    { key: 'entities', label: 'Entities', protections: ['entitySpam'] },
    { key: 'explosions', label: 'Explosions', protections: ['explosionSpam'] },
    { key: 'events', label: 'Events', protections: ['eventValidation'] },
    { key: 'integrity', label: 'Integrity', protections: ['integrity'] },
    { key: 'performance', label: 'Performance', protections: [] },
  ];

  const ACTIONS = ['log', 'warn', 'freeze', 'kick', 'tempban', 'ban'];
  const LEVELS = [1, 2, 3];

  let state = {
    config: null,
    workingConfig: null,
    perf: {},
    network: {},
    activeCategory: 'movement',
    activeStep: 1,
  };

  const el = (sel) => document.querySelector(sel);

  function post(name, body) {
    return fetch(`https://${resourceName}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body || {}),
    }).catch(() => {});
  }

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (data.type === 'open') {
      state.config = data.config;
      state.workingConfig = JSON.parse(JSON.stringify(data.config));
      state.perf = data.perf || {};
      el('#app').classList.remove('hidden');
      render();
    } else if (data.type === 'close') {
      el('#app').classList.add('hidden');
    } else if (data.type === 'perf') {
      state.perf = data.perf || {};
      state.network = data.network || {};
      if (state.activeCategory === 'performance' && state.activeStep === 1) renderStep1();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  function closePanel() {
    post('close');
    el('#app').classList.add('hidden');
  }

  function impactClass(ms) {
    if (ms > 0.5) return 'impact-bad';
    if (ms > 0.15) return 'impact-warn';
    return 'impact-good';
  }

  function fieldRow(label, inputHtml, extraClass) {
    return `<div class="field ${extraClass || ''}"><label>${label}</label>${inputHtml}</div>`;
  }

  function renderProtectionCard(protKey) {
    const p = state.workingConfig.Protections[protKey];
    if (!p) return '';
    const perf = state.perf[protKey] || { avgMs: 0, peakMs: 0 };

    const actionsOptions = ACTIONS.map(a => `<option value="${a}" ${p.action === a ? 'selected' : ''}>${a}</option>`).join('');
    const levelOptions = LEVELS.map(l => `<option value="${l}" ${p.level === l ? 'selected' : ''}>Level ${l}</option>`).join('');
    const whitelist = (p.whitelist || []).join(', ');

    return `
      <div class="protection-card" data-key="${protKey}">
        <div class="card-top">
          <span class="protection-name">${protKey}</span>
          <label class="switch">
            <input type="checkbox" data-field="enabled" ${p.enabled ? 'checked' : ''} />
            <span class="slider-toggle"></span>
          </label>
        </div>
        <div class="field-grid">
          ${fieldRow('Detection Level', `<select data-field="level">${levelOptions}</select>`)}
          ${fieldRow('Action', `<select data-field="action">${actionsOptions}</select>`)}
          ${fieldRow('Cooldown (ms)', `<input type="number" min="0" step="100" data-field="cooldown" value="${p.cooldown}" />`)}
          ${fieldRow(`Sensitivity <span class="range-value">${Number(p.sensitivity).toFixed(2)}</span>`,
            `<input type="range" min="0.1" max="2" step="0.05" data-field="sensitivity" value="${p.sensitivity}" />`)}
          ${fieldRow('Whitelist (comma separated)', `<input type="text" data-field="whitelist" value="${whitelist}" />`, 'whitelist-input')}
        </div>
        <div class="stats-row">
          <span>Performance Impact: <b class="${impactClass(perf.avgMs)}">${(perf.avgMs || 0).toFixed(3)}ms</b> avg / ${(perf.peakMs || 0).toFixed(3)}ms peak</span>
          <span>Detection Count: <b>${(state.detections && state.detections[protKey]) || 0}</b></span>
          <span>False Positive Count: <b>${(state.falsePositives && state.falsePositives[protKey]) || 0}</b></span>
        </div>
      </div>`;
  }

  function renderPerformanceDashboard() {
    const perf = state.perf || {};
    const keys = Object.keys(perf);
    const totalAvg = keys.reduce((s, k) => s + (perf[k].avgMs || 0), 0);
    const active = Object.values(state.workingConfig.Protections).filter(p => p.enabled).length;
    const disabled = Object.values(state.workingConfig.Protections).length - active;
    const net = state.network || {};

    const rows = keys
      .sort((a, b) => (perf[b].avgMs || 0) - (perf[a].avgMs || 0))
      .map(k => {
        const p = perf[k];
        const pct = Math.min(100, (p.avgMs / 0.6) * 100);
        return `<tr>
          <td>${k}</td>
          <td>${p.category || ''}</td>
          <td class="${impactClass(p.avgMs)}">${p.avgMs.toFixed(3)}ms</td>
          <td>${p.peakMs.toFixed(3)}ms</td>
          <td><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td>
        </tr>`;
      }).join('');

    return `
      <h2 class="section-title">Performance Dashboard</h2>
      <p class="section-sub">Measured live from this client - not estimated.</p>
      <div class="dash-grid">
        <div class="dash-tile"><div class="label">Combined Avg CPU / tick</div><div class="value">${totalAvg.toFixed(3)}ms</div></div>
        <div class="dash-tile"><div class="label">Active Checks</div><div class="value">${active}</div></div>
        <div class="dash-tile"><div class="label">Disabled Checks</div><div class="value">${disabled}</div></div>
        <div class="dash-tile"><div class="label">Network Usage</div><div class="value">${(net.bytesPerMin || 0)} B/min</div></div>
      </div>
      <table class="perf-table">
        <thead><tr><th>Protection</th><th>Category</th><th>Avg</th><th>Peak</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">No samples yet.</td></tr>'}</tbody>
      </table>`;
  }

  function renderStep1() {
    const nav = CATEGORIES.map(c => `
      <div class="category-item ${state.activeCategory === c.key ? 'active' : ''}" data-cat="${c.key}">
        <span>${c.label}</span>
        ${c.protections.length ? `<span class="count">${c.protections.length}</span>` : ''}
      </div>`).join('');
    el('#categoryNav').innerHTML = nav;

    const cat = CATEGORIES.find(c => c.key === state.activeCategory);
    const content = el('#step1Content');
    if (cat.key === 'performance') {
      content.innerHTML = renderPerformanceDashboard();
    } else {
      content.innerHTML = cat.protections.map(renderProtectionCard).join('');
      content.querySelectorAll('.protection-card').forEach(card => {
        const key = card.dataset.key;
        card.querySelectorAll('[data-field]').forEach(input => {
          input.addEventListener('input', () => updateProtectionField(key, input));
        });
      });
    }

    document.querySelectorAll('.category-item').forEach(item => {
      item.addEventListener('click', () => {
        state.activeCategory = item.dataset.cat;
        renderStep1();
      });
    });
  }

  function updateProtectionField(key, input) {
    const p = state.workingConfig.Protections[key];
    const field = input.dataset.field;
    if (field === 'enabled') p.enabled = input.checked;
    else if (field === 'level') p.level = parseInt(input.value, 10);
    else if (field === 'action') p.action = input.value;
    else if (field === 'cooldown') p.cooldown = parseInt(input.value, 10) || 0;
    else if (field === 'sensitivity') {
      p.sensitivity = parseFloat(input.value);
      input.previousElementSibling && null;
      const label = input.closest('.field').querySelector('.range-value');
      if (label) label.textContent = Number(p.sensitivity).toFixed(2);
    } else if (field === 'whitelist') {
      p.whitelist = input.value.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  function advField(label, path, value, type, extra) {
    const id = `adv_${path.replace(/\./g, '_')}`;
    let input;
    if (type === 'toggle') {
      input = `<label class="switch"><input type="checkbox" id="${id}" data-path="${path}" ${value ? 'checked' : ''} /><span class="slider-toggle"></span></label>`;
    } else if (type === 'select') {
      input = `<select id="${id}" data-path="${path}">${extra.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    } else {
      input = `<input type="${type}" id="${id}" data-path="${path}" value="${value}" ${extra ? extra : ''} />`;
    }
    return `<div class="field"><label>${label}</label>${input}</div>`;
  }

  function renderStep2() {
    const adv = state.workingConfig.Advanced;
    const perf = state.workingConfig.Performance;
    const wl = state.workingConfig.Whitelist;

    el('#step2Content').innerHTML = `
      <h2 class="section-title">Advanced Settings</h2>

      <div class="adv-group">
        <div class="adv-grid">
          ${advField('Detection Sensitivity', 'Advanced.detectionSensitivity', adv.detectionSensitivity, 'number', 'step="0.05" min="0.1" max="3"')}
          ${advField('Confidence Threshold', 'Advanced.confidenceThreshold', adv.confidenceThreshold, 'number', 'min="0" max="100"')}
          ${advField('Punishment Threshold', 'Advanced.punishmentThreshold', adv.punishmentThreshold, 'number', 'min="10" max="999"')}
          ${advField('Scan Interval (ms)', 'Advanced.scanIntervalMs', adv.scanIntervalMs, 'number', 'min="100" max="5000"')}
          ${advField('Detection Cooldown (ms)', 'Advanced.detectionCooldownMs', adv.detectionCooldownMs, 'number', 'min="500" max="30000"')}
          ${advField('Server Validation', 'Advanced.serverValidation', adv.serverValidation, 'toggle')}
          ${advField('Debug Mode', 'Advanced.debug', adv.debug, 'toggle')}
          ${advField('Admin Bypass', 'Advanced.adminBypass', adv.adminBypass, 'toggle')}
        </div>
      </div>

      <div class="adv-group">
        <div class="adv-grid">
          ${advField('Performance Mode', 'Performance.mode', perf.mode, 'select', ['adaptive', 'performance', 'quality'])}
          ${advField('Low-End Mode', 'Performance.lowEndMode', perf.lowEndMode, 'toggle')}
          ${advField('Profiling', 'Performance.profiling', perf.profiling, 'toggle')}
          ${advField('Auto Low-End Threshold (ms)', 'Performance.autoLowEndThresholdMs', perf.autoLowEndThresholdMs, 'number', 'step="0.5" min="4" max="30"')}
          ${advField('Max Budget / Tick (ms)', 'Performance.maxBudgetMsPerTick', perf.maxBudgetMsPerTick, 'number', 'step="0.05" min="0.1" max="5"')}
        </div>
      </div>

      <div class="adv-group">
        <div class="adv-grid">
          ${advField('Logging Enabled', 'Advanced.logging.enabled', adv.logging.enabled, 'toggle')}
          ${advField('Console Logging', 'Advanced.logging.console', adv.logging.console, 'toggle')}
          ${advField('File Logging', 'Advanced.logging.file', adv.logging.file, 'toggle')}
          ${advField('Webhook Min Confidence', 'Advanced.logging.webhookMinConfidence', adv.logging.webhookMinConfidence, 'number', 'min="0" max="100"')}
          <div class="field full">
            <label>Webhook URL</label>
            <input type="url" id="adv_Advanced_logging_webhook" data-path="Advanced.logging.webhook" value="${adv.logging.webhook || ''}" placeholder="https://discord.com/api/webhooks/..." />
          </div>
        </div>
      </div>

      <div class="adv-group">
        <div class="adv-grid">
          ${advField('Score Decay / sec', 'Advanced.scoreDecay.perSecond', adv.scoreDecay.perSecond, 'number', 'step="0.1" min="0" max="20"')}
          ${advField('Decay Grace (ms)', 'Advanced.scoreDecay.graceMs', adv.scoreDecay.graceMs, 'number', 'step="500" min="0" max="60000"')}
          <div class="field full">
            <label>Bypass Permission Groups (comma separated)</label>
            <input type="text" id="adv_bypassGroups" data-path="Advanced.permissionGroups.bypass" value="${(adv.permissionGroups.bypass || []).join(', ')}" />
          </div>
        </div>
      </div>

      <div class="adv-group">
        <div class="adv-grid">
          <div class="field full">
            <label>Weapon Whitelist (comma separated)</label>
            <input type="text" id="adv_weaponWl" data-path="Whitelist.weapons" value="${(wl.weapons || []).join(', ')}" />
          </div>
          <div class="field full">
            <label>Vehicle Model Whitelist (comma separated)</label>
            <input type="text" id="adv_vehicleWl" data-path="Whitelist.vehicles" value="${(wl.vehicles || []).join(', ')}" />
          </div>
        </div>
      </div>
    `;

    el('#step2Content').querySelectorAll('[data-path]').forEach(input => {
      input.addEventListener('input', () => updateAdvancedField(input));
    });
  }

  function setDeep(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
  }

  function updateAdvancedField(input) {
    const path = input.dataset.path;
    let value;
    if (input.type === 'checkbox') value = input.checked;
    else if (input.type === 'number') value = parseFloat(input.value);
    else if (path.endsWith('weapons') || path.endsWith('vehicles') || path.endsWith('bypass')) {
      value = input.value.split(',').map(s => s.trim()).filter(Boolean);
    } else value = input.value;

    setDeep(state.workingConfig, path, value);
  }

  function switchStep(step) {
    state.activeStep = step;
    document.querySelectorAll('.step-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.step, 10) === step));
    el('#step1').classList.toggle('hidden', step !== 1);
    el('#step2').classList.toggle('hidden', step !== 2);
    if (step === 1) renderStep1(); else renderStep2();
  }

  function render() {
    switchStep(state.activeStep);
  }

  el('#closeBtn').addEventListener('click', closePanel);
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => switchStep(parseInt(btn.dataset.step, 10)));
  });

  el('#resetBtn').addEventListener('click', () => {
    state.workingConfig = JSON.parse(JSON.stringify(state.config));
    render();
    el('#footerStatus').textContent = 'Changes discarded';
  });

  el('#saveBtn').addEventListener('click', async () => {
    el('#footerStatus').textContent = 'Saving...';
    await post('updateConfig', {
      Protections: state.workingConfig.Protections,
      Advanced: state.workingConfig.Advanced,
      Performance: state.workingConfig.Performance,
      Whitelist: state.workingConfig.Whitelist,
    });
    state.config = JSON.parse(JSON.stringify(state.workingConfig));
    el('#footerStatus').textContent = 'Saved & applied to all players';
  });
})();
