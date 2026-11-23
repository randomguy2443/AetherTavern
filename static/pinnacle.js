/* Command palette, session mark, and the empty-chat reading room.
 *
 * The rest of the client already owns chats, contacts, generation, and
 * settings. This module is the layer on top: one key to reach any of
 * that, and a first paint that can actually open a chat.
 */

import { api } from './api.js';
import { state, setState, subscribe } from './state.js';
import { el } from './util.js';
import { toast } from './ui.js';
import { THEMES } from './constants.js';
import { openNewChatWizard } from './views/new_chat_wizard.js';


const TOKEN_SET = '__present__';
const IS_MAC = /mac/i.test(navigator.platform || navigator.userAgent || '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

let _installed = false;
let _open = false;
let _items = [];
let _active = 0;
let _laying = false;


export function installPinnacle() {
  if (_installed) return;
  _installed = true;
  mountMark();
  mountPalette();
  document.addEventListener('keydown', onKey, true);
  subscribe(paintStatus);
  paintStatus();
}


/* ---------- Session ---------- */

export function sessionSnapshot(settings) {
  if (!settings) {
    return { mode: 'Loading', model: '', ready: false, detail: 'Reading settings' };
  }
  if (settings.provider_mode === 'generic') {
    const generic = settings.generic || {};
    const kind = generic.provider || '';
    let model = '';
    let ready = false;
    if (kind === 'openai_compatible') {
      const cfg = generic.openai_compatible || {};
      const active = (cfg.custom_providers || []).find(p => p.id === cfg.active_id);
      model = (active && active.model_id) || '';
      ready = !!(active && active.api_token_indicator === TOKEN_SET);
    } else if (kind && generic[kind] && typeof generic[kind] === 'object') {
      model = generic[kind].model_id || '';
      ready = generic[kind].api_token_indicator === TOKEN_SET;
    }
    return {
      mode: 'Generic',
      model: model || 'No model selected',
      ready,
      detail: ready ? 'Key saved' : 'Key missing',
    };
  }
  const ready = settings.api_token_indicator === TOKEN_SET;
  return {
    mode: 'AetherRoom',
    model: settings.default_model || 'Default model',
    ready,
    detail: ready ? 'Token saved' : 'Token missing',
  };
}

function paintStatus() {
  const snap = sessionSnapshot(state.settings);
  const pip = document.getElementById('pinnacle-pip');
  if (pip) {
    pip.dataset.ready = snap.ready ? '1' : '0';
  }
  const mark = document.getElementById('pinnacle-mark');
  if (mark) {
    mark.title = `Command palette (${MOD_LABEL}+K) · ${snap.mode} · ${snap.model} · ${snap.detail}`;
  }
  const chip = document.getElementById('pinnacle-room-status');
  if (chip) fillStatusChip(chip, snap);
}

function fillStatusChip(chip, snap) {
  chip.replaceChildren(
    el('span', { class: `reading-pip${snap.ready ? ' ready' : ''}` }),
    el('span', { class: 'reading-status-mode' }, snap.mode),
    el('span', { class: 'reading-status-dot' }, '·'),
    el('span', {}, snap.model),
    el('span', { class: 'reading-status-dot' }, '·'),
    el('span', {}, snap.detail),
  );
}


/* ---------- Rail mark ---------- */

function mountMark() {
  const rail = document.getElementById('rail');
  if (!rail || document.getElementById('pinnacle-mark')) return;
  const mark = el('button', {
    type: 'button',
    id: 'pinnacle-mark',
    class: 'rail-mark',
    'aria-label': 'Open command palette',
    onClick: () => openPalette(),
  }, 'Æ');
  mark.append(el('span', { class: 'rail-pip', id: 'pinnacle-pip' }));
  rail.prepend(mark);
}


/* ---------- Reading room (empty chat pane) ---------- */

function needsTable() {
  return (state.contacts || []).length === 0 || (state.users || []).length === 0;
}

export function readingRoomPreface() {
  const snap = sessionSnapshot(state.settings);
  const chip = el('div', {
    class: 'reading-status',
    id: 'pinnacle-room-status',
  });
  fillStatusChip(chip, snap);

  const actions = [];
  if (needsTable()) {
    actions.push(el('button', {
      type: 'button',
      class: 'btn primary',
      onClick: () => { layTheTable(); },
    }, 'Lay the first table'));
  } else {
    actions.push(el('button', {
      type: 'button',
      class: 'btn primary',
      onClick: () => openNewChatWizard(),
    }, 'New chat'));
  }
  actions.push(el('button', {
    type: 'button',
    class: 'btn',
    onClick: () => openPalette(),
  }, 'Command palette'));
  if (!snap.ready) {
    actions.push(el('button', {
      type: 'button',
      class: 'btn ghost',
      onClick: () => goToToken(),
    }, snap.mode === 'Generic' ? 'Add an API key' : 'Add an API token'));
  }

  return [
    el('div', { class: 'reading-kicker' }, 'AetherTavern'),
    chip,
    el('div', { class: 'reading-actions' }, ...actions),
  ];
}


/* ---------- First night ---------- */

async function layTheTable() {
  if (_laying) return;
  _laying = true;
  closePalette();
  try {
    let contact = (state.contacts || [])[0] || null;
    let user = (state.users || [])[0] || null;
    let scenario = (state.scenarios || [])[0] || null;

    if (!contact) {
      contact = await api.createContact({
        name: 'Mara Vale',
        description: 'Keeps the night shift at Aether Tavern.',
        species: 'human',
        gender: 'woman',
        pronouns: 'she/her',
        persona:
          'Mara is the tavern keeper on the late shift. Dry humor, steady ' +
          'attention, and no patience for people who talk over the rain. She ' +
          'treats every guest as a story that has not decided its ending.',
        appearance:
          'Dark coat, sleeves rolled, a kettle always just off the boil. ' +
          'Lamp-warm light, rain on the glass behind her.',
        greeting:
          '*Rain ticks the windows. The taproom is down to one lamp.*\n\n' +
          'You\'re early, {{user}}, or I\'m late. Either way the kettle is on. ' +
          'Sit. Tell me what kind of night you came in for.',
      });
    }
    if (!user) {
      user = await api.createUser({
        name: 'Traveler',
        description: 'Just came in from the rain.',
        pronouns: 'they/them',
        persona:
          'A guest who pushed the tavern door open and has not decided ' +
          'whether to stay. Curious, a little guarded, here to talk.',
      });
    }
    if (!scenario) {
      scenario = await api.createScenario({
        name: 'The taproom',
        description: 'A quiet night in the tavern, before anyone else arrives.',
        environment:
          'A low-ceilinged taproom. Rain on the windows, one lamp, the smell ' +
          'of tea and wet wool. The rest of the tables are empty.',
        scene:
          'Mara is behind the bar wiping a cup she has already wiped. The ' +
          'door has just shut behind the guest.',
      });
    }

    const chat = await api.createChat({
      contact_id: contact.id,
      user_id: user.id,
      scenario_id: scenario.id,
      title: `Chat with ${contact.name || 'Mara Vale'}`,
    });
    const [contacts, users, scenarios, chats] = await Promise.all([
      api.listContacts(),
      api.listUsers(),
      api.listScenarios(),
      api.listChats(),
    ]);
    setState({
      contacts,
      users,
      scenarios,
      chats,
      activeTab: 'chats',
      activeChatId: chat.id,
      sidebarCollapsed: false,
    });
    try { localStorage.setItem('sidebarCollapsed', '0'); } catch { /* private mode */ }
    toast(`Opened “${chat.title || 'a new chat'}”`, 'success');
  } catch (e) {
    toast(`Could not lay the table: ${e.message}`, 'error');
  } finally {
    _laying = false;
  }
}


/* ---------- Navigation helpers ---------- */

function goTab(tab) {
  const patch = { activeTab: tab };
  if (tab !== 'settings') {
    patch.sidebarCollapsed = false;
    try { localStorage.setItem('sidebarCollapsed', '0'); } catch { /* ignore */ }
  }
  setState(patch);
}

function goToToken() {
  goTab('settings');
  const token = document.querySelector('input[placeholder="Bearer token"]');
  if (token) token.focus();
}

function focusChatSearch() {
  goTab('chats');
  const input = document.querySelector('#main .list-search');
  if (input) input.focus();
}

function toggleSidebar() {
  const next = !state.sidebarCollapsed;
  setState({ sidebarCollapsed: next });
  try { localStorage.setItem('sidebarCollapsed', next ? '1' : '0'); } catch { /* ignore */ }
}

async function applyTheme(id) {
  document.documentElement.dataset.theme = id;
  const updated = await api.putSettings({ theme: id });
  setState({ settings: updated });
}


/* ---------- Palette ---------- */

function catalog() {
  const items = [];
  const push = (item) => items.push(item);

  push({
    kind: 'command', group: 'Go', label: 'Chats', hint: 'Open the list',
    keywords: 'home conversations', run: () => goTab('chats'),
  });
  push({
    kind: 'command', group: 'Go', label: 'Contacts', hint: 'Characters',
    keywords: 'characters people', run: () => goTab('contacts'),
  });
  push({
    kind: 'command', group: 'Go', label: 'User personas', hint: 'Who you are in the chat',
    keywords: 'user persona self', run: () => goTab('users'),
  });
  push({
    kind: 'command', group: 'Go', label: 'Scenarios', hint: 'Places and scenes',
    keywords: 'scene place world', run: () => goTab('scenarios'),
  });
  push({
    kind: 'command', group: 'Go', label: 'Brain libraries', hint: 'Lore blocks',
    keywords: 'lore brains library', run: () => goTab('libraries'),
  });
  if ((state.settings && state.settings.provider_mode) === 'generic') {
    push({
      kind: 'command', group: 'Go', label: 'Context presets', hint: 'Generic mode prompts',
      keywords: 'prompt preset system', run: () => goTab('contextPresets'),
    });
  }
  push({
    kind: 'command', group: 'Go', label: 'Settings', hint: 'Provider, theme, token',
    keywords: 'preferences config token key', run: () => goTab('settings'),
  });

  push({
    kind: 'command', group: 'Do', label: 'New chat', hint: 'Pick contact, persona, scenario',
    keywords: 'create start conversation',
    run: () => openNewChatWizard(),
  });
  if (needsTable() || (state.chats || []).length === 0) {
    push({
      kind: 'command', group: 'Do', label: 'Lay the first table',
      hint: 'Create a keeper, a guest, a taproom, and open the chat',
      keywords: 'starter onboarding sample first night',
      run: () => layTheTable(),
    });
  }
  push({
    kind: 'command', group: 'Do', label: 'Search chats', hint: 'Focus the chat list',
    keywords: 'find filter', run: () => focusChatSearch(),
  });
  push({
    kind: 'command', group: 'Do',
    label: state.sidebarCollapsed ? 'Show the sidebar' : 'Hide the sidebar',
    hint: 'Give the chat the full room',
    keywords: 'collapse expand list pane',
    run: () => toggleSidebar(),
  });
  const snap = sessionSnapshot(state.settings);
  if (!snap.ready) {
    push({
      kind: 'command', group: 'Do',
      label: snap.mode === 'Generic' ? 'Add an API key' : 'Add an API token',
      hint: 'Opens Settings on the token field',
      keywords: 'novelai bearer key login',
      run: () => goToToken(),
    });
  }

  const currentTheme = (state.settings && state.settings.theme) || 'dark';
  for (const theme of THEMES) {
    push({
      kind: 'theme', group: 'Appearance',
      label: `Theme · ${theme.name}`,
      hint: theme.id === currentTheme ? 'Current' : 'Switch theme',
      keywords: `theme ${theme.name} ${theme.id} appearance`,
      run: () => applyTheme(theme.id),
    });
  }

  (state.chats || []).forEach((chat, index) => {
    const contact = (state.contacts || []).find(c => c.id === chat.contact_id);
    push({
      kind: 'chat', group: 'Chats', rank: index,
      label: chat.title || 'Untitled chat',
      hint: contact ? contact.name : 'Open chat',
      keywords: `${chat.title || ''} ${contact ? contact.name : ''}`,
      run: () => {
        goTab('chats');
        setState({ activeTab: 'chats', activeChatId: chat.id, sidebarCollapsed: false });
        try { localStorage.setItem('sidebarCollapsed', '0'); } catch { /* ignore */ }
      },
    });
  });

  for (const contact of state.contacts || []) {
    push({
      kind: 'entity', group: 'Contacts',
      label: contact.name || 'Untitled contact',
      hint: 'Edit contact',
      keywords: `contact character ${contact.name || ''} ${contact.tags || ''}`,
      run: () => setState({ activeTab: 'contacts', activeContactId: contact.id, sidebarCollapsed: false }),
    });
  }
  for (const user of state.users || []) {
    push({
      kind: 'entity', group: 'Personas',
      label: user.name || 'Untitled persona',
      hint: 'Edit persona',
      keywords: `user persona ${user.name || ''}`,
      run: () => setState({ activeTab: 'users', activeUserId: user.id, sidebarCollapsed: false }),
    });
  }
  for (const scenario of state.scenarios || []) {
    push({
      kind: 'entity', group: 'Scenarios',
      label: scenario.name || 'Untitled scenario',
      hint: 'Edit scenario',
      keywords: `scenario scene ${scenario.name || ''}`,
      run: () => setState({ activeTab: 'scenarios', activeScenarioId: scenario.id, sidebarCollapsed: false }),
    });
  }

  return items;
}

function visibleItems(query) {
  const all = catalog();
  const q = query.trim().toLowerCase();
  if (!q) {
    return all.filter(item =>
      item.kind === 'command'
      || item.kind === 'theme'
      || (item.kind === 'chat' && item.rank < 5)
    );
  }
  const tokens = q.split(/\s+/).filter(Boolean);
  return all.filter(item => {
    const hay = `${item.label} ${item.hint || ''} ${item.keywords || ''}`.toLowerCase();
    return tokens.every(token => hay.includes(token));
  });
}

function mountPalette() {
  if (document.getElementById('pinnacle-palette')) return;
  const root = el('div', {
    id: 'pinnacle-palette',
    class: 'pinnacle-palette',
    hidden: true,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Command palette',
  });
  const panel = el('div', { class: 'pinnacle-panel' });
  const input = el('input', {
    id: 'pinnacle-palette-input',
    class: 'pinnacle-input',
    type: 'text',
    placeholder: 'Jump, create, or change…',
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'pinnacle-palette-list',
    'aria-autocomplete': 'list',
  });
  input.addEventListener('input', () => renderList(input.value));
  const list = el('div', {
    id: 'pinnacle-palette-list',
    class: 'pinnacle-list',
    role: 'listbox',
  });
  const foot = el('div', { class: 'pinnacle-foot' },
    el('span', {}, '↑↓ select'),
    el('span', {}, 'Enter run'),
    el('span', {}, 'Esc close'),
    el('span', {}, `${MOD_LABEL}+K`),
  );
  panel.append(input, list, foot);
  root.append(panel);
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) closePalette();
  });
  document.body.append(root);
}

export function openPalette() {
  const root = document.getElementById('pinnacle-palette');
  if (!root) return;
  _open = true;
  root.hidden = false;
  const input = document.getElementById('pinnacle-palette-input');
  if (input) {
    input.value = '';
    renderList('');
    input.focus();
  }
}

export function closePalette() {
  const root = document.getElementById('pinnacle-palette');
  _open = false;
  if (root) root.hidden = true;
  _items = [];
  _active = 0;
}

function renderList(query) {
  const list = document.getElementById('pinnacle-palette-list');
  const input = document.getElementById('pinnacle-palette-input');
  if (!list) return;
  _items = visibleItems(query);
  _active = Math.min(_active, Math.max(_items.length - 1, 0));
  if (!_items.length) {
    list.replaceChildren(el('div', { class: 'pinnacle-empty' }, 'Nothing matches.'));
    if (input) input.removeAttribute('aria-activedescendant');
    return;
  }
  let lastGroup = null;
  const nodes = [];
  _items.forEach((item, index) => {
    if (item.group !== lastGroup) {
      lastGroup = item.group;
      nodes.push(el('div', { class: 'pinnacle-group' }, item.group));
    }
    const id = `pinnacle-opt-${index}`;
    const row = el('button', {
      type: 'button',
      id,
      class: `pinnacle-option${index === _active ? ' active' : ''}`,
      role: 'option',
      'aria-selected': index === _active ? 'true' : 'false',
      onMouseMove: () => {
        if (_active !== index) {
          _active = index;
          paintActive();
        }
      },
      onClick: () => runIndex(index),
    },
      el('span', { class: 'pinnacle-option-label' }, item.label),
      item.hint ? el('span', { class: 'pinnacle-option-hint' }, item.hint) : null,
    );
    nodes.push(row);
  });
  list.replaceChildren(...nodes);
  if (input) input.setAttribute('aria-activedescendant', `pinnacle-opt-${_active}`);
  const activeEl = document.getElementById(`pinnacle-opt-${_active}`);
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function paintActive() {
  const list = document.getElementById('pinnacle-palette-list');
  const input = document.getElementById('pinnacle-palette-input');
  if (!list) return;
  const options = list.querySelectorAll('.pinnacle-option');
  options.forEach((node, index) => {
    const on = index === _active;
    node.classList.toggle('active', on);
    node.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (input && _items.length) {
    input.setAttribute('aria-activedescendant', `pinnacle-opt-${_active}`);
  }
  const activeEl = document.getElementById(`pinnacle-opt-${_active}`);
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function move(delta) {
  if (!_items.length) return;
  _active = (_active + delta + _items.length) % _items.length;
  paintActive();
}

function runIndex(index) {
  const item = _items[index];
  if (!item) return;
  closePalette();
  Promise.resolve(item.run()).catch(e => {
    toast(e && e.message ? e.message : 'That command failed', 'error');
  });
}

function onKey(e) {
  const key = e.key;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key.toLowerCase() === 'k') {
    const modal = document.getElementById('modal-root');
    if (!_open && modal && !modal.classList.contains('hidden')) return;
    e.preventDefault();
    e.stopPropagation();
    if (_open) closePalette();
    else openPalette();
    return;
  }
  if (!_open) return;
  if (key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closePalette();
    return;
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    move(key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    runIndex(_active);
  }
}
