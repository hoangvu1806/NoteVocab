import './styles.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from '@tauri-apps/plugin-autostart';

const icons = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20.4 15.3A8.5 8.5 0 0 1 8.7 3.6 8.5 8.5 0 1 0 20.4 15.3Z"/></svg>',
  volume: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9.5a4 4 0 0 1 0 5M17.8 6.8a8 8 0 0 1 0 10.4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16ZM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2"/></svg>'
};

const el = Object.fromEntries([
  'settingsButton','settingsPanel','closeSettingsButton','translationLanguage','autostartToggle','settingsStatus',
  'themeButton','hideButton','setPicker','setPickerButton','setPickerLabel','setPickerDropdown','newSetButton','setMenuButton','setMenu','renameSetButton','deleteSetButton',
  'addForm','wordInput','addButton','connectionStatus','lookupNote','libraryTitle','wordCount','filterInput','wordList',
  'savedStatus','textDialog','textDialogForm','dialogIcon','dialogTitle','dialogDescription','dialogInput','dialogConfirm',
  'confirmDialog','confirmDescription','toast'
].map(id => [id, document.getElementById(id)]));

const LANGUAGES = [
  ['vi', 'Vietnamese'],
  ['zh-CN', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['th', 'Thai'],
  ['id', 'Indonesian'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German']
];

const DEFAULT_STATE = {
  version: 1,
  theme: 'light',
  translationLanguage: 'vi',
  activeSetId: 'starter',
  sets: [{ id: 'starter', name: 'My first set', createdAt: Date.now(), words: [] }]
};

let state = structuredClone(DEFAULT_STATE);
let saveTimer;
let toastTimer;
let dialogMode = 'create';
let appReady = false;
let activeAudio;
let lookupAvailable = null;

function cleanState(candidate) {
  if (!candidate || !Array.isArray(candidate.sets) || candidate.sets.length === 0) return structuredClone(DEFAULT_STATE);
  candidate.sets = candidate.sets.filter(set => set && typeof set.id === 'string' && typeof set.name === 'string');
  if (!candidate.sets.length) return structuredClone(DEFAULT_STATE);
  candidate.sets.forEach(set => {
    if (!Array.isArray(set.words)) set.words = [];
    set.words.forEach(word => {
      word.translation = cleanTranslation(word.translation || '');
    });
  });
  if (!candidate.sets.some(set => set.id === candidate.activeSetId)) candidate.activeSetId = candidate.sets[0].id;
  candidate.theme = candidate.theme === 'dark' ? 'dark' : 'light';
  if (!LANGUAGES.some(([code]) => code === candidate.translationLanguage)) candidate.translationLanguage = 'vi';
  return candidate;
}

async function loadState() {
  let raw = localStorage.getItem('lexinote-state');
  try {
    const disk = await invoke('load_state');
    if (disk) raw = disk;
  } catch { /* Browser preview or first launch. */ }
  try {
    state = cleanState(raw ? JSON.parse(raw) : null);
    const cleaned = JSON.stringify(state);
    if (raw && cleaned !== raw) {
      localStorage.setItem('lexinote-state', cleaned);
      try { await invoke('save_state', { payload: cleaned }); } catch { /* Browser preview. */ }
    }
  } catch {
    state = structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  clearTimeout(saveTimer);
  el.savedStatus.textContent = 'Saving…';
  const raw = JSON.stringify(state);
  localStorage.setItem('lexinote-state', raw);
  saveTimer = setTimeout(async () => {
    try { await invoke('save_state', { payload: raw }); } catch { /* localStorage remains a safe fallback. */ }
    el.savedStatus.textContent = 'Saved locally';
  }, 180);
}

function activeSet() { return state.sets.find(set => set.id === state.activeSetId) || state.sets[0]; }
function id(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function setTheme(theme, persist = true) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  el.themeButton.innerHTML = theme === 'dark' ? icons.sun : icons.moon;
  el.themeButton.title = theme === 'dark' ? 'Use light theme' : 'Use dark theme';
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#05070a' : '#f5f9ff';
  if (persist) saveState();
}

function renderSetPicker() {
  const current = activeSet();
  el.setPickerLabel.textContent = current.name;
  el.setPickerDropdown.innerHTML = state.sets.map(set => {
    const selected = set.id === state.activeSetId;
    const count = set.words.length;
    return `<button type="button" class="set-picker-option${selected ? ' active' : ''}" data-set-id="${escapeHtml(set.id)}" role="option" aria-selected="${selected}">
      <span class="set-picker-option-name">${escapeHtml(set.name)}</span>
      <span class="set-picker-option-meta">${count} ${count === 1 ? 'word' : 'words'}</span>
    </button>`;
  }).join('');
  el.libraryTitle.textContent = current.name;
  el.deleteSetButton.disabled = state.sets.length === 1;
}

function setSetPickerOpen(open, focusSelected = false) {
  el.setPickerDropdown.hidden = !open;
  el.setPickerButton.setAttribute('aria-expanded', String(open));
  if (open && focusSelected) {
    requestAnimationFrame(() => (el.setPickerDropdown.querySelector('.active') || el.setPickerDropdown.querySelector('button'))?.focus());
  }
}

function renderWords() {
  const set = activeSet();
  const query = el.filterInput.value.trim().toLowerCase();
  const words = [...set.words].filter(item => !query || `${item.word} ${item.translation || ''} ${item.definition || ''}`.toLowerCase().includes(query));
  const total = set.words.length;
  el.wordCount.textContent = `${total} ${total === 1 ? 'word' : 'words'}`;

  if (!words.length) {
    const filtered = query && total;
    el.wordList.innerHTML = `<div class="empty-state"><div><div class="empty-icon">${filtered ? icons.folder : icons.book}</div><strong>${filtered ? 'No matching words' : 'Your set is ready'}</strong><p>${filtered ? 'Try another filter.' : 'Type a word above. Its meaning and translation will appear here.'}</p></div></div>`;
    return;
  }

  el.wordList.innerHTML = words.map((item, index) => `
    <article class="word-card" data-id="${escapeHtml(item.id)}" style="animation-delay:${Math.min(index * 20, 100)}ms">
      <div class="word-top">
        <div class="word-name-row">
          <span class="word-name">${escapeHtml(item.word)}</span>
          ${item.phonetic ? `<span class="phonetic">${escapeHtml(normalizePhonetic(item.phonetic))}</span>` : ''}
        </div>
        <div class="word-tools">
          <button class="mini-button play-audio" title="Play pronunciation" aria-label="Play pronunciation">${icons.volume}</button>
          <button class="mini-button remove-word" title="Remove word" aria-label="Remove word">${icons.trash}</button>
        </div>
      </div>
      ${item.translation ? `<div class="translation">${escapeHtml(item.translation)}</div>` : ''}
      ${item.definition ? `<div class="definition">${item.partOfSpeech ? `<span class="part">${escapeHtml(item.partOfSpeech)}</span>` : ''}${escapeHtml(item.definition)}</div>` : `<div class="offline-word">Dictionary details unavailable. <button type="button" class="retry-lookup">Retry</button></div>`}
      ${item.example ? `<div class="example">“${escapeHtml(item.example)}”</div>` : ''}
    </article>`).join('');
}

function render() {
  renderSetPicker();
  renderWords();
  el.translationLanguage.value = state.translationLanguage;
}

function normalizePhonetic(text) {
  const value = text.replace(/^[/\[]|[/\]]$/g, '');
  return value ? `/${value}/` : '';
}

function showToast(message) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add('show');
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
}

function translationLanguageName() {
  return LANGUAGES.find(([code]) => code === state.translationLanguage)?.[1] || 'Vietnamese';
}

function setLookupBusy(busy) {
  el.addButton.disabled = busy;
  el.wordInput.disabled = busy;
  el.addButton.textContent = busy ? 'Wait' : 'Add';
  el.lookupNote.textContent = busy ? 'Looking up meaning, pronunciation and translation…' : `Meaning, IPA and ${translationLanguageName()} translation are filled in when online.`;
}

function setLookupAvailability(available) {
  lookupAvailable = available;
  updateConnection();
}

async function lookupWord(word, language) {
  try { return await invoke('lookup_word', { word, language }); }
  catch (tauriError) {
    if (window.__TAURI_INTERNALS__) throw tauriError;
    const [dictionaryRequest, translationRequest] = await Promise.allSettled([
      fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&qe=sp&md=dpr&ipa=1&max=1`),
      fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${encodeURIComponent(`en|${language}`)}`)
    ]);
    const dictionaryResponse = dictionaryRequest.status === 'fulfilled' ? dictionaryRequest.value : null;
    const translationResponse = translationRequest.status === 'fulfilled' ? translationRequest.value : null;
    const [dictionary, translation] = await Promise.all([
      dictionaryResponse?.ok ? dictionaryResponse.json().catch(() => []) : [],
      translationResponse?.ok ? translationResponse.json().catch(() => ({})) : {}
    ]);
    const entry = dictionary[0] || {};
    const tags = entry.tags || [];
    const definitionParts = entry.defs?.[0]?.split('\t') || [];
    const part = tags.find(tag => ['n', 'v', 'adj', 'adv'].includes(tag)) || definitionParts[0] || '';
    const partNames = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
    const result = {
      word,
      phonetic: tags.find(tag => tag.startsWith('ipa_pron:'))?.slice(9) || '',
      audio: '',
      partOfSpeech: partNames[part] || '',
      definition: definitionParts.length > 1 ? definitionParts.slice(1).join('\t').trim() : (definitionParts[0] || '').trim(),
      example: '',
      translation: translation.responseData?.translatedText || ''
    };
    if (!result.definition && !result.translation) throw tauriError;
    return result;
  }
}

async function addWord(event) {
  event.preventDefault();
  const word = el.wordInput.value.trim().replace(/\s+/g, ' ');
  if (!word) return el.wordInput.focus();
  const set = activeSet();
  if (set.words.some(item => item.word.toLowerCase() === word.toLowerCase())) {
    showToast('This word is already in the current set.');
    return el.wordInput.select();
  }

  setLookupBusy(true);
  let result = { word };
  try {
    result = await lookupWord(word, state.translationLanguage);
    setLookupAvailability(true);
  } catch (error) {
    console.error('Word lookup failed:', error);
    setLookupAvailability(false);
    showToast('Saved locally. Lookup services are temporarily unavailable.');
  }

  set.words.unshift({
    id: id('word'),
    word: result.word || word,
    phonetic: result.phonetic || '',
    audio: result.audio?.startsWith('//') ? `https:${result.audio}` : (result.audio || ''),
    partOfSpeech: result.partOfSpeech || '',
    definition: result.definition || '',
    example: result.example || '',
    translation: cleanTranslation(result.translation || ''),
    createdAt: Date.now()
  });
  el.wordInput.value = '';
  el.filterInput.value = '';
  saveState();
  renderWords();
  setLookupBusy(false);
  el.wordInput.focus();
}

async function retryWordLookup(item, button) {
  button.disabled = true;
  button.textContent = 'Retrying…';
  try {
    const result = await lookupWord(item.word, state.translationLanguage);
    Object.assign(item, {
      word: result.word || item.word,
      phonetic: result.phonetic || item.phonetic || '',
      audio: result.audio?.startsWith('//') ? `https:${result.audio}` : (result.audio || item.audio || ''),
      partOfSpeech: result.partOfSpeech || item.partOfSpeech || '',
      definition: result.definition || item.definition || '',
      example: result.example || item.example || '',
      translation: cleanTranslation(result.translation || item.translation || '')
    });
    setLookupAvailability(true);
    saveState();
    renderWords();
    showToast(item.definition ? 'Dictionary details updated.' : 'No dictionary details found.');
  } catch (error) {
    console.error('Word lookup retry failed:', error);
    setLookupAvailability(false);
    button.disabled = false;
    button.textContent = 'Retry';
    showToast('Lookup services are temporarily unavailable.');
  }
}

function cleanTranslation(text) {
  const area = document.createElement('textarea');
  area.innerHTML = text;
  const template = document.createElement('template');
  template.innerHTML = area.value;
  return (template.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function playDictionaryAudio(source) {
  return new Promise((resolve, reject) => {
    if (!source) return reject(new Error('No dictionary audio'));
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = undefined;
    }

    const audio = new Audio();
    activeAudio = audio;
    let done = false;
    const finish = (callback) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => finish(() => reject(new Error('Audio timed out'))), 4500);

    audio.preload = 'auto';
    audio.addEventListener('canplay', () => {
      audio.play().then(() => finish(resolve)).catch(() => finish(() => reject(new Error('Audio playback blocked'))));
    }, { once: true });
    audio.addEventListener('error', () => finish(() => reject(new Error('Audio failed to load'))), { once: true });
    audio.src = source;
    audio.load();
  });
}

function speakWithSystemVoice(word) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject(new Error('System voice is unavailable'));
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => /^en-us/i.test(voice.lang)) || voices.find(voice => /^en/i.test(voice.lang)) || null;
    utterance.lang = utterance.voice?.lang || 'en-US';
    utterance.rate = 0.78;
    utterance.pitch = 1;
    utterance.onend = resolve;
    utterance.onerror = event => event.error === 'canceled' ? resolve() : reject(new Error(event.error));
    window.speechSynthesis.speak(utterance);
  });
}

async function playPronunciation(item, button) {
  button.disabled = true;
  try {
    await playDictionaryAudio(item.audio);
  } catch {
    try {
      await speakWithSystemVoice(item.word);
      showToast('Using your system English voice.');
    } catch {
      showToast('No pronunciation source is available on this device.');
    }
  } finally {
    button.disabled = false;
  }
}

async function hideWindow() {
  try { await invoke('hide_window'); } catch { /* Browser preview. */ }
}

function openTextDialog(mode) {
  dialogMode = mode;
  const creating = mode === 'create';
  el.dialogIcon.innerHTML = creating ? icons.folder : icons.book;
  el.dialogTitle.textContent = creating ? 'Create a new set' : 'Rename this set';
  el.dialogDescription.textContent = creating ? 'Keep related vocabulary together.' : 'Choose a short, memorable name.';
  el.dialogConfirm.textContent = creating ? 'Create set' : 'Save name';
  el.dialogInput.value = creating ? '' : activeSet().name;
  el.textDialog.showModal();
  setTimeout(() => creating ? el.dialogInput.focus() : el.dialogInput.select(), 30);
}

function updateConnection() {
  const online = navigator.onLine;
  const available = online && lookupAvailable !== false;
  el.connectionStatus.classList.toggle('offline', !available);
  el.connectionStatus.querySelector('span').textContent = !online
    ? 'Offline · saves locally'
    : lookupAvailable === false
      ? 'Lookup unavailable'
      : 'Online lookup';
}

el.themeButton.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
el.settingsButton.addEventListener('click', event => {
  event.stopPropagation();
  el.setMenu.hidden = true;
  el.settingsPanel.hidden = !el.settingsPanel.hidden;
});
el.closeSettingsButton.addEventListener('click', () => { el.settingsPanel.hidden = true; });
el.translationLanguage.addEventListener('change', () => {
  state.translationLanguage = el.translationLanguage.value;
  saveState();
  const label = translationLanguageName();
  setLookupBusy(false);
  el.settingsStatus.textContent = `New words will be translated to ${label}.`;
  showToast(`Translation language: ${label}`);
});
el.autostartToggle.addEventListener('change', async () => {
  const requested = el.autostartToggle.checked;
  el.autostartToggle.disabled = true;
  el.settingsStatus.textContent = requested ? 'Enabling Windows startup…' : 'Disabling Windows startup…';
  try {
    if (requested) await enableAutostart(); else await disableAutostart();
    el.autostartToggle.checked = await isAutostartEnabled();
    el.settingsStatus.textContent = el.autostartToggle.checked ? 'LexiNote will start quietly with Windows.' : 'Windows startup is turned off.';
  } catch {
    el.autostartToggle.checked = !requested;
    el.settingsStatus.textContent = 'Could not change the Windows startup setting.';
    showToast('Windows startup setting could not be changed.');
  } finally {
    el.autostartToggle.disabled = false;
  }
});
el.hideButton.addEventListener('click', hideWindow);
el.addForm.addEventListener('submit', addWord);
el.filterInput.addEventListener('input', renderWords);
el.setPickerButton.addEventListener('click', event => {
  event.stopPropagation();
  el.setMenu.hidden = true;
  el.settingsPanel.hidden = true;
  setSetPickerOpen(el.setPickerDropdown.hidden);
});
el.setPickerButton.addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    setSetPickerOpen(true, true);
  }
});
el.setPickerDropdown.addEventListener('click', event => {
  const option = event.target.closest('.set-picker-option');
  if (!option) return;
  state.activeSetId = option.dataset.setId;
  el.filterInput.value = '';
  setSetPickerOpen(false);
  saveState(); render(); el.wordInput.focus();
});
el.setPickerDropdown.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const options = [...el.setPickerDropdown.querySelectorAll('.set-picker-option')];
  const currentIndex = options.indexOf(document.activeElement);
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  options[(currentIndex + direction + options.length) % options.length]?.focus();
});
el.newSetButton.addEventListener('click', () => openTextDialog('create'));
el.setMenuButton.addEventListener('click', event => {
  event.stopPropagation();
  el.setMenu.hidden = !el.setMenu.hidden;
});
el.renameSetButton.addEventListener('click', () => { el.setMenu.hidden = true; openTextDialog('rename'); });
el.deleteSetButton.addEventListener('click', () => {
  if (state.sets.length === 1) return;
  el.setMenu.hidden = true;
  const set = activeSet();
  el.confirmDescription.textContent = `“${set.name}” and its ${set.words.length} saved ${set.words.length === 1 ? 'word' : 'words'} will be removed.`;
  el.confirmDialog.showModal();
});
el.textDialogForm.addEventListener('submit', event => {
  if (event.submitter?.value !== 'confirm') return;
  event.preventDefault();
  const name = el.dialogInput.value.trim();
  if (!name) return el.dialogInput.focus();
  if (dialogMode === 'create') {
    const newSet = { id: id('set'), name, createdAt: Date.now(), words: [] };
    state.sets.push(newSet);
    state.activeSetId = newSet.id;
    showToast('New set created.');
  } else {
    activeSet().name = name;
    showToast('Set renamed.');
  }
  el.textDialog.close();
  el.filterInput.value = '';
  saveState(); render(); el.wordInput.focus();
});
el.dialogInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    el.dialogConfirm.click();
  }
});
el.confirmDialog.addEventListener('close', () => {
  if (el.confirmDialog.returnValue !== 'confirm') return;
  const index = state.sets.findIndex(set => set.id === state.activeSetId);
  state.sets.splice(index, 1);
  state.activeSetId = state.sets[Math.max(0, index - 1)].id;
  el.filterInput.value = '';
  saveState(); render(); showToast('Set deleted.'); el.wordInput.focus();
});
el.wordList.addEventListener('click', async event => {
  const card = event.target.closest('.word-card');
  if (!card) return;
  const item = activeSet().words.find(word => word.id === card.dataset.id);
  const retryButton = event.target.closest('.retry-lookup');
  if (retryButton && item) {
    await retryWordLookup(item, retryButton);
    return;
  }
  if (event.target.closest('.remove-word')) {
    activeSet().words = activeSet().words.filter(word => word.id !== card.dataset.id);
    saveState(); renderWords();
  }
  const audioButton = event.target.closest('.play-audio');
  if (audioButton && item) {
    playPronunciation(item, audioButton);
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('#setMenu') && !event.target.closest('#setMenuButton')) el.setMenu.hidden = true;
  if (!event.target.closest('#settingsPanel') && !event.target.closest('#settingsButton')) el.settingsPanel.hidden = true;
  if (!event.target.closest('#setPicker')) setSetPickerOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el.setPickerDropdown.hidden) {
    event.preventDefault();
    setSetPickerOpen(false);
    return el.setPickerButton.focus();
  }
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) hideWindow();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); el.filterInput.focus(); }
});
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);

async function init() {
  await loadState();
  setTheme(state.theme, false);
  el.translationLanguage.innerHTML = LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
  render();
  setLookupBusy(false);
  updateConnection();
  try {
    await invoke('position_window');
    await listen('quick-focus', () => setTimeout(() => el.wordInput.focus(), 50));
    el.autostartToggle.checked = await isAutostartEnabled();
  } catch { /* Running as a browser preview. */ }
  appReady = true;
  requestAnimationFrame(() => el.wordInput.focus());
}

init();
