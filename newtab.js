'use strict';

/* ================= 常量与全局状态 ================= */
const DB_NAME = 'local-image-newtab';
const DB_VERSION = 1;
const STORE = 'kv';

const KEY_HANDLE = 'directoryHandle';
const KEY_RECURSIVE = 'recursive';
const KEY_SHOW_NAME = 'showName';
const KEY_BG_MODE = 'bgMode';
const KEY_USER_NAME = 'userName';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg']);
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git']);
const MAX_FILES = 5000;
const KEY_IMAGE_CACHE = 'imageListCache';
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;  // 图片目录索引缓存 5 分钟
const KEY_LAST_IMAGE = 'lastImageCache';   // 上一张壁纸的缩略图（秒开用）

let currentHandle = null;
let currentObjectUrl = null;
let currentCacheUrl = null;
let captionTimer = null;
let bgMode = null;   // 'folder' | 'fluid' | null
let userName = '';   // 用户称呼（显示在问候语里）

/* ================= DOM ================= */
const img = document.getElementById('bg-image');
const bgCache = document.getElementById('bg-cache');
const caption = document.getElementById('caption');
const firstRun = document.getElementById('first-run');
const permPanel = document.getElementById('perm-panel');
const settingsPanel = document.getElementById('settings-panel');
const gear = document.getElementById('gear');
const statusEl = document.getElementById('status');
const folderName = document.getElementById('folder-name');
const chkRecursive = document.getElementById('chk-recursive');
const chkShowName = document.getElementById('chk-show-name');
const clockTimeEl = document.getElementById('clock-time');
const clockDateEl = document.getElementById('clock-date');
const clockGreetingEl = document.getElementById('clock-greeting');
const todoListEl = document.getElementById('todo-list');
const todoEmpty = document.getElementById('todo-empty');
const todoAdd = document.getElementById('todo-add');
const todoClearDone = document.getElementById('todo-clear-done');
const ritualsListEl = document.getElementById('rituals-list');
const ritualsEmptyEl = document.getElementById('rituals-empty');
const ritualsAddEl = document.getElementById('rituals-add');
const ritualsResetEl = document.getElementById('rituals-reset');
const weatherPanel = document.getElementById('weather-panel');
const sunPanel = document.getElementById('sun-panel');

const btnChooseFolder1 = document.getElementById('choose-folder-1');
const btnChooseFolder2 = document.getElementById('choose-folder-2');
const btnChooseFolder3 = document.getElementById('choose-folder-3');
const btnAuthorize = document.getElementById('authorize');
const btnRandom = document.getElementById('random-btn');
const hideUiBtn = document.getElementById('hide-ui-btn');
const btnCloseSettings = document.getElementById('close-settings');
const chooseFluidBtn = document.getElementById('choose-fluid');
const switchModeBtn = document.getElementById('switch-mode');
const namePromptEl = document.getElementById('name-prompt');
const nameInputEl = document.getElementById('name-input');
const nameSaveBtn = document.getElementById('name-save');
const userNameInputEl = document.getElementById('user-name');

/* ================= IndexedDB ================= */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet(key) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function kvSet(key, value) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* ================= 工具函数 ================= */
function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function hideAllOverlays() {
  firstRun.classList.add('hidden');
  permPanel.classList.add('hidden');
}

function isImage(name) {
  const i = name.lastIndexOf('.');
  if (i <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(i + 1).toLowerCase());
}

function showCaption(name) {
  caption.textContent = name;
  caption.classList.remove('hidden', 'fade');
  if (captionTimer) clearTimeout(captionTimer);
  captionTimer = setTimeout(() => caption.classList.add('fade'), 6000);
}

function hideCaption() {
  caption.classList.add('hidden');
  if (captionTimer) clearTimeout(captionTimer);
}

function toggleHideUi() {
  const hiding = !document.body.classList.contains('ui-hidden');
  document.body.classList.toggle('ui-hidden', hiding);
  if (hiding) {
    settingsPanel.classList.add('hidden');
  }
  hideUiBtn.title = hiding ? 'Show UI' : 'Hide UI';
}

/* ================= 时钟：24 小时制 + 问候语 ================= */
function pad2(n) {
  return String(n).padStart(2, '0');
}

function greetingForHour(hour) {
  const part = hour < 12 ? 'Good morning' : 'Good evening';
  return userName ? part + ', ' + userName + '!' : part + '!';
}

function setUserName(val) {
  userName = val;
  kvSet(KEY_USER_NAME, userName);
  updateClock();
  if (userNameInputEl) userNameInputEl.value = userName;
}

function showNamePrompt() {
  namePromptEl.classList.remove('hidden');
  if (nameInputEl) {
    nameInputEl.value = userName;
    setTimeout(() => nameInputEl.focus(), 0);
  }
}

function saveName() {
  setUserName((nameInputEl.value || '').trim());
  namePromptEl.classList.add('hidden');
  if (bgMode === null) {
    firstRun.classList.remove('hidden');
  }
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function gmtOffsetLabel(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return 'GMT' + sign + h + (m ? ':' + String(m).padStart(2, '0') : '');
}

function updateClock() {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  clockTimeEl.textContent = pad2(h) + ':' + pad2(m);
  clockDateEl.textContent = formatDate(now) + ' (' + gmtOffsetLabel(now) + ')';
  clockGreetingEl.textContent = greetingForHour(h);
}

function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

/* ================= TODO List ================= */
const KEY_TODO = 'todoList';

let todoItems = [];
let dragId = null;

function todoSave() {
  kvSet(KEY_TODO, todoItems);
}

function updateTodoEmpty() {
  const empty = todoItems.length === 0;
  todoListEl.classList.toggle('hidden', empty);
  todoEmpty.classList.toggle('hidden', !empty);
}

function createTodoItemEl(item) {
  const li = document.createElement('li');
  li.className = 'todo-item' + (item.done ? ' done' : '');
  li.dataset.id = item.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'todo-check';
  check.title = item.done ? 'Undo complete' : 'Mark complete';
  check.addEventListener('click', () => toggleTodo(item.id));

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'todo-text';
  text.value = item.text;
  text.placeholder = 'Add a todo…';
  text.addEventListener('input', () => {
    item.text = text.value;
    todoSave();
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      text.blur();
      addTodo();
    } else if (e.key === 'Escape') {
      text.blur();
    }
  });

  const drag = document.createElement('span');
  drag.className = 'todo-drag';
  drag.title = 'Drag to reorder';
  drag.textContent = '⠿';
  drag.draggable = true;
  drag.addEventListener('dragstart', (e) => onDragStart(e, item.id));
  drag.addEventListener('dragend', onDragEnd);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'todo-del';
  del.title = 'Delete';
  del.textContent = '×';
  del.addEventListener('click', () => deleteTodo(item.id));

  li.addEventListener('dragover', (e) => onDragOver(e, item.id));
  li.addEventListener('dragleave', (e) => onDragLeave(e, item.id));
  li.addEventListener('drop', (e) => onDrop(e, item.id));

  li.appendChild(check);
  li.appendChild(text);
  li.appendChild(drag);
  li.appendChild(del);
  return li;
}

function renderTodo() {
  todoListEl.innerHTML = '';
  for (const item of todoItems) {
    todoListEl.appendChild(createTodoItemEl(item));
  }
  updateTodoEmpty();
}

function clearCompletedTodos() {
  const remaining = todoItems.filter((it) => !it.done);
  if (remaining.length === todoItems.length) {
    setStatus('No completed items to clear');
    return;
  }
  todoItems = remaining;
  todoSave();
  renderTodo();
}

function addTodo() {
  const item = {
    id: 't' + Date.now() + Math.random().toString(36).slice(2, 7),
    text: '',
    done: false
  };
  todoItems.push(item);
  todoSave();
  const el = createTodoItemEl(item);
  todoListEl.appendChild(el);
  updateTodoEmpty();
  const input = el.querySelector('.todo-text');
  input.focus();
  todoListEl.scrollTop = todoListEl.scrollHeight;
}

function toggleTodo(id) {
  const item = todoItems.find((it) => it.id === id);
  if (!item) return;
  item.done = !item.done;
  todoSave();
  const li = todoListEl.querySelector(`.todo-item[data-id="${id}"]`);
  if (li) {
    li.classList.toggle('done', item.done);
    li.querySelector('.todo-check').title = item.done ? 'Undo complete' : 'Mark complete';
  }
}

function deleteTodo(id) {
  todoItems = todoItems.filter((it) => it.id !== id);
  todoSave();
  const li = todoListEl.querySelector(`.todo-item[data-id="${id}"]`);
  if (li) li.remove();
  updateTodoEmpty();
}

function getTodoLi(id) {
  return todoListEl.querySelector(`.todo-item[data-id="${id}"]`);
}

function clearDragUI() {
  todoListEl.querySelectorAll('.todo-item').forEach((li) => {
    li.classList.remove('dragging', 'drag-before', 'drag-after');
  });
}

function onDragStart(e, id) {
  dragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  const li = getTodoLi(id);
  if (li) li.classList.add('dragging');
}

function onDragOver(e, id) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const li = getTodoLi(id);
  if (!li) return;
  const rect = li.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  li.classList.toggle('drag-before', before);
  li.classList.toggle('drag-after', !before);
}

function onDragLeave(e, id) {
  const li = getTodoLi(id);
  if (li) li.classList.remove('drag-before', 'drag-after');
}

function onDrop(e, id) {
  e.preventDefault();
  const fromId = dragId || e.dataTransfer.getData('text/plain');
  dragId = null;
  if (!fromId || fromId === id) {
    clearDragUI();
    return;
  }
  const li = getTodoLi(id);
  if (!li) {
    clearDragUI();
    return;
  }
  const rect = li.getBoundingClientRect();
  const before = e.clientY < rect.top + rect.height / 2;
  reorderTodo(fromId, id, before);
}

function onDragEnd() {
  dragId = null;
  clearDragUI();
}

function reorderTodo(fromId, targetId, before) {
  const fromIndex = todoItems.findIndex((it) => it.id === fromId);
  if (fromIndex < 0) return;
  const [moved] = todoItems.splice(fromIndex, 1);
  const targetIndex = todoItems.findIndex((it) => it.id === targetId);
  if (targetIndex < 0) {
    todoItems.push(moved);
  } else {
    const insertAt = before ? targetIndex : targetIndex + 1;
    todoItems.splice(insertAt, 0, moved);
  }
  todoSave();
  renderTodo();
}

/* ================= Rituals（每周例行清单） ================= */
const KEY_RITUALS = 'rituals';
const KEY_RITUALS_WEEK = 'ritualsWeek';

let ritualItems = [];

function ritualsSave() {
  kvSet(KEY_RITUALS, ritualItems);
}

function updateRitualsEmpty() {
  const empty = ritualItems.length === 0;
  ritualsListEl.classList.toggle('hidden', empty);
  ritualsEmptyEl.classList.toggle('hidden', !empty);
}

function createRitualItemEl(item) {
  const li = document.createElement('li');
  li.className = 'todo-item' + (item.done ? ' done' : '');
  li.dataset.id = item.id;

  const check = document.createElement('button');
  check.type = 'button';
  check.className = 'todo-check';
  check.title = item.done ? 'Undo complete' : 'Mark complete';
  check.addEventListener('click', () => toggleRitual(item.id));

  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'todo-text';
  text.value = item.text;
  text.placeholder = 'Recurring task…';
  text.addEventListener('input', () => {
    item.text = text.value;
    ritualsSave();
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      text.blur();
      addRitual();
    } else if (e.key === 'Escape') {
      text.blur();
    }
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'todo-del';
  del.title = 'Delete';
  del.textContent = '×';
  del.addEventListener('click', () => deleteRitual(item.id));

  li.appendChild(check);
  li.appendChild(text);
  li.appendChild(del);
  return li;
}

function renderRituals() {
  ritualsListEl.innerHTML = '';
  for (const item of ritualItems) {
    ritualsListEl.appendChild(createRitualItemEl(item));
  }
  updateRitualsEmpty();
}

function addRitual() {
  const item = { id: 'r' + Date.now() + Math.random().toString(36).slice(2, 7), text: '', done: false };
  ritualItems.push(item);
  ritualsSave();
  const el = createRitualItemEl(item);
  ritualsListEl.appendChild(el);
  updateRitualsEmpty();
  el.querySelector('.todo-text').focus();
  ritualsListEl.scrollTop = ritualsListEl.scrollHeight;
}

function toggleRitual(id) {
  const item = ritualItems.find((it) => it.id === id);
  if (!item) return;
  item.done = !item.done;
  ritualsSave();
  const li = ritualsListEl.querySelector(`.todo-item[data-id="${id}"]`);
  if (li) {
    li.classList.toggle('done', item.done);
    li.querySelector('.todo-check').title = item.done ? 'Undo complete' : 'Mark complete';
  }
}

function deleteRitual(id) {
  ritualItems = ritualItems.filter((it) => it.id !== id);
  ritualsSave();
  const li = ritualsListEl.querySelector(`.todo-item[data-id="${id}"]`);
  if (li) li.remove();
  updateRitualsEmpty();
}

function resetRituals() {
  if (ritualItems.length === 0) {
    setStatus('No recurring tasks to reset');
    return;
  }
  if (!confirm('Reset all recurring tasks for the new week?')) return;
  for (const item of ritualItems) item.done = false;
  ritualsSave();
  renderRituals();
}

async function initRituals() {
  // 每周一自动取消勾选（新的一周重新开始）
  const currentWeekKey = oaDateKey(oaMonday(Date.now()).getTime());
  const storedWeekKey = await kvGet(KEY_RITUALS_WEEK);
  const stored = await kvGet(KEY_RITUALS);
  ritualItems = Array.isArray(stored) ? stored : [];

  if (storedWeekKey !== currentWeekKey) {
    for (const item of ritualItems) item.done = false;
    await kvSet(KEY_RITUALS, ritualItems);
    await kvSet(KEY_RITUALS_WEEK, currentWeekKey);
  }

  renderRituals();
  ritualsAddEl.addEventListener('click', addRitual);
  ritualsResetEl.addEventListener('click', resetRituals);
}

/* ================= 目录扫描 ================= */
async function collectImages(dirHandle, out, recursive) {
  if (out.length >= MAX_FILES) return;
  for await (const [name, handle] of dirHandle.entries()) {
    if (out.length >= MAX_FILES) return;
    try {
      if (handle.kind === 'file') {
        if (isImage(name)) out.push({ handle, name });
      } else if (handle.kind === 'directory') {
        if (SKIP_DIRS.has(name.toLowerCase())) continue;
        if (recursive) await collectImages(handle, out, recursive);
      }
    } catch (err) {
      /* 跳过无法访问的条目 */
    }
  }
}

/* ================= 核心：随机显示图片 ================= */
async function displayImage(pick) {
  const file = await pick.handle.getFile();
  const url = URL.createObjectURL(file);
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = url;
  img.style.opacity = '0';
  img.src = url;
  img.alt = pick.name;
  try {
    if (img.decode) await img.decode();
  } catch (err) {
    /* 忽略解码错误 */
  }
  img.style.opacity = '1';
  cacheThumbnail(pick.name);
}

function showCachedWallpaper() {
  return kvGet(KEY_LAST_IMAGE)
    .then((cache) => {
      if (cache && cache.blob) {
        const url = URL.createObjectURL(cache.blob);
        if (currentCacheUrl) URL.revokeObjectURL(currentCacheUrl);
        currentCacheUrl = url;
        bgCache.style.opacity = '0';
        bgCache.src = url;
        bgCache.alt = cache.name || '';
        const fadeIn = () => { bgCache.style.opacity = '1'; };
        if (bgCache.decode) {
          bgCache.decode().then(fadeIn).catch(fadeIn);
        } else {
          bgCache.onload = fadeIn;
        }
      }
    })
    .catch((err) => {
      console.warn('读取壁纸缓存失败：', err);
    });
}

async function cacheThumbnail(name) {
  try {
    const bitmap = await createImageBitmap(img, { resizeWidth: 1920, resizeQuality: 'high' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.8);
    });
    await kvSet(KEY_LAST_IMAGE, { blob, name });
  } catch (err) {
    console.warn('壁纸缩略图缓存失败：', err);
  }
}

async function getImageList(handle) {
  const cache = await kvGet(KEY_IMAGE_CACHE);
  // 缓存里有索引就直接用（秒选），过期则后台重新扫描刷新索引
  if (cache && Array.isArray(cache.files) && cache.files.length) {
    if (Date.now() - (cache.scannedAt || 0) > IMAGE_CACHE_TTL_MS) {
      rescanAndCache(handle);
    }
    return cache.files;
  }
  // 无缓存 → 同步扫描一次并缓存
  const files = [];
  await collectImages(handle, files, chkRecursive.checked);
  await kvSet(KEY_IMAGE_CACHE, { files, scannedAt: Date.now() });
  return files;
}

async function rescanAndCache(handle) {
  try {
    const files = [];
    await collectImages(handle, files, chkRecursive.checked);
    if (files.length) {
      await kvSet(KEY_IMAGE_CACHE, { files, scannedAt: Date.now() });
    }
  } catch (err) {
    console.warn('后台刷新图片索引失败：', err);
  }
}

function showEmptyMessage() {
  firstRun.classList.remove('hidden');
  setStatus('No images found in this folder');
}

async function showRandomImage() {
  hideAllOverlays();
  setStatus('');
  try {
    if (!window.showDirectoryPicker) {
      firstRun.classList.remove('hidden');
      setStatus('Folder access is not supported in this browser. Please use the latest Microsoft Edge');
      return;
    }

    const handle = currentHandle || (await kvGet(KEY_HANDLE)) || null;
    currentHandle = handle;
    if (handle) folderName.textContent = handle.name;

    if (!handle) {
      firstRun.classList.remove('hidden');
      setStatus('Please choose an image folder first');
      return;
    }

    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      permPanel.classList.remove('hidden');
      setStatus('Authorization is needed to read the image folder');
      return;
    }

    const files = await getImageList(handle);

    if (!files.length) {
      showEmptyMessage();
      return;
    }

    // 随机挑一张显示；若文件已失效（被删除等）换个再试，最多试 3 次
    let displayed = false;
    const pool = files.slice();
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      const pick = pool.splice(idx, 1)[0];
      try {
        await displayImage(pick);
        displayed = true;
        if (chkShowName.checked) showCaption(pick.name);
        else hideCaption();
        break;
      } catch (err) {
        console.warn('图片加载失败，换一张：', pick && pick.name, err);
      }
    }

    // 缓存的索引可能已过期，重新扫描一次兜底
    if (!displayed) {
      const fresh = [];
      await collectImages(handle, fresh, chkRecursive.checked);
      await kvSet(KEY_IMAGE_CACHE, { files: fresh, scannedAt: Date.now() });
      if (fresh.length) {
        const pick = fresh[Math.floor(Math.random() * fresh.length)];
        await displayImage(pick);
        if (chkShowName.checked) showCaption(pick.name);
        else hideCaption();
      } else {
        showEmptyMessage();
      }
    }
  } catch (err) {
    console.error(err);
    setStatus('Failed to load: ' + (err && err.message ? err.message : err));
    permPanel.classList.remove('hidden');
  }
}

/* ================= 选择 / 授权文件夹 ================= */
async function chooseFolder() {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    await kvSet(KEY_HANDLE, handle);
    await kvSet(KEY_IMAGE_CACHE, null); // 更换目录后清空旧索引
    currentHandle = handle;
    folderName.textContent = handle.name;
    setStatus('Folder selected: ' + handle.name);
    await showRandomImage();
  } catch (err) {
    if (err && err.name === 'AbortError') return; // 用户取消
    console.error(err);
    setStatus('Cannot access folder: ' + (err && err.message ? err.message : err));
  }
}

async function authorize() {
  try {
    const handle = currentHandle || (await kvGet(KEY_HANDLE));
    if (!handle) {
      firstRun.classList.remove('hidden');
      return;
    }
    const perm = await handle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      await showRandomImage();
    } else {
      setStatus('Authorization denied, cannot read the folder');
    }
  } catch (err) {
    console.error(err);
    setStatus('Authorization failed: ' + (err && err.message ? err.message : err));
  }
}

/* ================= 天气组件 ================= */
const WEATHERAPI_KEY = window.TABHAVEN_WEATHER_API_KEY || 'YOUR_API_KEY';
const WEATHER_API = 'https://api.weatherapi.com/v1/forecast.json';
const GEOLOCATE_TIMEOUT_MS = 10000;
const WEATHER_CACHE_KEY = 'weatherCache2';
const WEATHER_TTL_MS = 15 * 60 * 1000;   // 天气数据缓存 15 分钟
const LOCATION_TTL_MS = 60 * 60 * 1000;  // 定位缓存 60 分钟

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function weatherIcon(code, isDay) {
  const c = Number(code);
  if (c === 1000) return isDay ? '☀️' : '🌙';
  if (c === 1003) return isDay ? '⛅' : '🌙';
  if (c === 1006 || c === 1009) return '☁️';
  if (c === 1030 || c === 1135 || c === 1147) return '🌫️';
  if ([1063, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1192, 1195, 1198, 1201, 1240, 1243, 1246].includes(c)) return '🌧️';
  if ([1066, 1114, 1117, 1210, 1213, 1216, 1219, 1222, 1225, 1237, 1255, 1258, 1261, 1264].includes(c)) return '🌨️';
  if ([1069, 1072, 1204, 1207, 1249, 1252].includes(c)) return '🌧️';
  if ([1087, 1273, 1276, 1279, 1282].includes(c)) return '⛈️';
  return '🌡️';
}

function getPhysicalLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude
      }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: GEOLOCATE_TIMEOUT_MS, maximumAge: 300000 }
    );
  });
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    key: WEATHERAPI_KEY,
    q: `${lat},${lon}`,
    days: '2',
    aqi: 'no',
    alerts: 'no',
    lang: 'en'
  });
  const res = await fetch(`${WEATHER_API}?${params.toString()}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'WeatherAPI error');
  return data;
}

function renderWeatherLoading() {
  weatherPanel.innerHTML = '<div class="weather-status">Loading weather…</div>';
  sunPanel.classList.add('hidden');
}

function renderWeatherError(msg) {
  weatherPanel.innerHTML = `
    <div class="weather-status">${escapeHtml(msg)}</div>
    <button id="weather-retry" type="button">Retry</button>
  `;
  document.getElementById('weather-retry').addEventListener('click', initWeather);
  sunPanel.classList.add('hidden');
}

function parseTime12(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function formatMinutes(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function parseLocalTime(t) {
  if (!t) return null;
  const timePart = String(t).trim().split(/[\sT]/).pop();
  const m = timePart && timePart.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function formatIn(minutes) {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${Math.round(minutes)} min`;
  const h = Math.round(minutes / 60);
  return `in ${h} hour${h > 1 ? 's' : ''}`;
}

function renderSun(data) {
  const loc = data.location || {};
  const days = data.forecast && data.forecast.forecastday;
  if (!days || !days.length) {
    sunPanel.classList.add('hidden');
    return;
  }

  const todayAstro = (days[0] && days[0].astro) || {};
  const tomorrowAstro = days[1] ? days[1].astro : null;

  const nowMin = parseLocalTime(loc.localtime);
  const sunriseMin = parseTime12(todayAstro.sunrise);
  const sunsetMin = parseTime12(todayAstro.sunset);

  if (nowMin === null || sunriseMin === null || sunsetMin === null) {
    sunPanel.classList.add('hidden');
    return;
  }

  let label, icon, targetMin;
  if (nowMin < sunriseMin) {
    // 凌晨：今天的日出
    label = 'Sunrise';
    icon = '🌅';
    targetMin = sunriseMin;
  } else if (nowMin < sunsetMin) {
    // 白天：今天的日落
    label = 'Sunset';
    icon = '🌇';
    targetMin = sunsetMin;
  } else {
    // 夜晚：明天的日出
    label = 'Sunrise';
    icon = '🌅';
    const nextSunrise = tomorrowAstro ? parseTime12(tomorrowAstro.sunrise) : null;
    targetMin = (nextSunrise === null ? sunriseMin : nextSunrise) + 1440;
  }

  const diff = targetMin - nowMin;

  sunPanel.innerHTML = `
    <div id="sun-icon">${icon}</div>
    <div id="sun-text">
      ${label} ${formatIn(diff)}
      <span class="sun-time">at ${formatMinutes(targetMin)}</span>
    </div>
  `;
  sunPanel.classList.remove('hidden');
}

function renderWeather(data) {
  const current = data.current || {};
  const nowTemp = Math.round(Number(current.temp_c));
  const isDay = current.is_day !== 0;
  const nowCode = Number(current.condition && current.condition.code);
  const nowDesc = (current.condition && current.condition.text) || '';
  const nowIcon = weatherIcon(nowCode, isDay);

  const loc = data.location || {};
  const place = loc.name || loc.region || '';

  const localtime = loc.localtime || '';
  const currentHour = localtime.length >= 13 ? parseInt(localtime.slice(11, 13), 10) : -1;

  const day = data.forecast && data.forecast.forecastday && data.forecast.forecastday[0];
  const hours = (day && day.hour) || [];

  const cells = [];
  for (const h of hours) {
    const hh = parseInt(h.time.slice(11, 13), 10);
    if (currentHour >= 0 && hh < currentHour) continue;
    const code = Number(h.condition && h.condition.code);
    cells.push({ hour: hh, icon: weatherIcon(code, hh >= 6 && hh < 18), temp: Math.round(Number(h.temp_c)) });
  }

  const locationHtml = place ? `<div id="weather-location">${escapeHtml(place)}</div>` : '<div id="weather-location"></div>';
  const hourCellsHtml = cells.map((c) => `
    <div class="hour-cell">
      <div class="hour-time">${String(c.hour).padStart(2, '0')}:00</div>
      <div class="hour-icon">${c.icon}</div>
      <div class="hour-temp">${c.temp}°</div>
    </div>
  `).join('');

  weatherPanel.innerHTML = `
    <div id="weather-header">
      ${locationHtml}
      <button id="weather-refresh" type="button" title="Refresh">↻</button>
    </div>
    <div id="weather-now">
      <div id="weather-now-icon">${nowIcon}</div>
      <div>
        <div id="weather-now-temp">${nowTemp}°</div>
        <div id="weather-now-desc">${escapeHtml(nowDesc)}</div>
      </div>
    </div>
    <div id="weather-today-label">Today</div>
    <div id="weather-hourly">${hourCellsHtml || '<div class="weather-status">No hourly data</div>'}</div>
  `;

  document.getElementById('weather-refresh').addEventListener('click', forceRefreshWeather);
  renderSun(data);
}

async function initWeather() {
  const cache = await kvGet(WEATHER_CACHE_KEY);
  if (cache && cache.data) {
    renderWeather(cache.data);
  } else {
    renderWeatherLoading();
  }
  refreshWeather(cache);
}

async function refreshWeather(cache, force = false) {
  if (!WEATHERAPI_KEY || WEATHERAPI_KEY === 'YOUR_API_KEY') {
    renderWeatherError('Please set your WeatherAPI key in config.js (copy config.example.js).');
    return;
  }

  const now = Date.now();

  // 天气缓存足够新（且非强制）→ 直接用缓存，不发任何请求
  if (!force && cache && cache.data && cache.fetchedAt && (now - cache.fetchedAt < WEATHER_TTL_MS)) {
    return;
  }

  let lat = cache && typeof cache.latitude === 'number' ? cache.latitude : null;
  let lon = cache && typeof cache.longitude === 'number' ? cache.longitude : null;
  let locatedAt = cache && cache.locatedAt ? cache.locatedAt : 0;

  const hasLoc = lat !== null && lon !== null;
  const locFresh = hasLoc && (now - locatedAt < LOCATION_TTL_MS);

  // 坐标过期才重新定位；定位失败则回退旧坐标
  if (!locFresh) {
    try {
      const pos = await getPhysicalLocation();
      lat = pos.latitude;
      lon = pos.longitude;
      locatedAt = now;
    } catch (err) {
      console.warn('定位失败：', err && err.message ? err.message : err);
      if (!hasLoc) {
        renderWeatherError('Location access is needed to show your local weather. Please allow location permission and retry.');
        return;
      }
    }
  }

  try {
    const weather = await fetchWeather(lat, lon);
    await kvSet(WEATHER_CACHE_KEY, {
      latitude: lat,
      longitude: lon,
      data: weather,
      fetchedAt: now,
      locatedAt
    });
    renderWeather(weather);
  } catch (err) {
    console.error('天气刷新失败：', err);
    // 有缓存则静默保留缓存显示，无缓存才报错
    if (!cache || !cache.data) {
      renderWeatherError('Failed to load weather. Please check your connection and retry.');
    }
  }
}

async function forceRefreshWeather() {
  const cache = await kvGet(WEATHER_CACHE_KEY);
  await refreshWeather(cache, true);
}

/* ================= 事件绑定 ================= */
btnChooseFolder1.addEventListener('click', chooseFolderAndSetMode);
btnChooseFolder2.addEventListener('click', chooseFolderAndSetMode);
btnChooseFolder3.addEventListener('click', chooseFolderAndSetMode);
btnAuthorize.addEventListener('click', authorize);
btnRandom.addEventListener('click', randomizeBackground);
btnCloseSettings.addEventListener('click', () => settingsPanel.classList.add('hidden'));
gear.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
hideUiBtn.addEventListener('click', toggleHideUi);
todoAdd.addEventListener('click', addTodo);
todoClearDone.addEventListener('click', clearCompletedTodos);
chooseFluidBtn.addEventListener('click', enterFluidMode);
switchModeBtn.addEventListener('click', switchBgMode);
nameSaveBtn.addEventListener('click', saveName);
nameInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveName();
});
userNameInputEl.addEventListener('change', () => setUserName(userNameInputEl.value.trim()));
clockGreetingEl.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
  if (userNameInputEl) userNameInputEl.focus();
});

chkRecursive.addEventListener('change', () => {
  kvSet(KEY_RECURSIVE, chkRecursive.checked);
  kvSet(KEY_IMAGE_CACHE, null); // 递归设置变化，重建索引
  showRandomImage();
});
chkShowName.addEventListener('change', () => {
  kvSet(KEY_SHOW_NAME, chkShowName.checked);
  showRandomImage();
});

// 按 R 键随机换一张（避免在输入框中触发）
window.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'r' || e.key === 'R') randomizeBackground();
});

/* ================= 随机渐变背景（工作机版，流动动画） ================= */
let gradientStyleInjected = false;

function ensureGradientStyle() {
  if (gradientStyleInjected) return;
  gradientStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes gradient-flow {
      0% { background-position: 0% 0%; }
      50% { background-position: 100% 100%; }
      100% { background-position: 0% 0%; }
    }
    body.gradient-flow {
      background-size: 300% 300%;
      animation: gradient-flow 20s ease infinite;
    }
  `;
  document.head.appendChild(style);
}

function randomGradient() {
  const h1 = Math.floor(Math.random() * 360);
  const h2 = (h1 + 60) % 360;
  const h3 = (h1 + 120) % 360;
  const h4 = (h1 + 180) % 360;
  const s = 45 + Math.floor(Math.random() * 25);
  const l = 30 + Math.floor(Math.random() * 15);
  const c1 = `hsl(${h1}, ${s}%, ${l}%)`;
  const c2 = `hsl(${h2}, ${s}%, ${Math.min(l + 10, 60)}%)`;
  const c3 = `hsl(${h3}, ${s}%, ${Math.max(l - 6, 15)}%)`;
  const c4 = `hsl(${h4}, ${s}%, ${Math.min(l + 4, 60)}%)`;
  return `linear-gradient(120deg, ${c1} 0%, ${c2} 30%, ${c3} 60%, ${c4} 100%)`;
}

function applyRandomGradient() {
  ensureGradientStyle();
  document.body.style.backgroundImage = randomGradient();
  document.body.classList.add('gradient-flow');
  // 隐藏本地图片层，避免黑色占位遮住渐变
  img.style.display = 'none';
  bgCache.style.display = 'none';
}

function updateModeUI() {
  const folderSettings = document.getElementById('folder-settings');
  const switchBtn = document.getElementById('switch-mode');
  if (folderSettings) folderSettings.style.display = (bgMode === 'folder') ? '' : 'none';
  if (switchBtn) switchBtn.textContent = (bgMode === 'fluid') ? 'Switch to Folder' : 'Switch to Fluid Color';
}

function setBgMode(mode) {
  bgMode = mode;
  kvSet(KEY_BG_MODE, mode);
  updateModeUI();
}

function enterFluidMode() {
  setBgMode('fluid');
  hideAllOverlays();
  applyRandomGradient();
}

function enterFolderMode() {
  setBgMode('folder');
  img.style.display = '';
  bgCache.style.display = '';
  showCachedWallpaper();
  showRandomImage();
}

function switchBgMode() {
  if (bgMode === 'fluid') {
    enterFolderMode();
  } else {
    enterFluidMode();
  }
}

function randomizeBackground() {
  if (bgMode === 'fluid') {
    applyRandomGradient();
  } else {
    showRandomImage();
  }
}

function chooseFolderAndSetMode() {
  setBgMode('folder');
  chooseFolder();
}

/* ================= Personal OA（工作时间统计，gradient 版专用） ================= */
const OA_KEY = 'oaData';
const OA_WORK_START = 8 * 60;        // 08:00 前不算
const OA_WORK_END = 21 * 60 + 30;    // 21:30 后不算
const OA_LUNCH_START = 12 * 60;      // 12:00
const OA_LUNCH_END = 13 * 60;        // 13:00

let oaData = { days: {} };
let oaStartEl = null;
let oaEndEl = null;
let oaDailyEl = null;
let oaWeeklyEl = null;
let oaSignoffEl = null;
let oaClearDayEl = null;
let oaClearWeekEl = null;

function oaDateKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function oaTimeToMin(t) {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function oaDailyMin(startStr, endStr) {
  const s = oaTimeToMin(startStr);
  const e = oaTimeToMin(endStr);
  if (s === null || e === null) return 0;
  const start = Math.max(s, OA_WORK_START);
  const end = Math.min(e, OA_WORK_END);
  if (end <= start) return 0;
  const overlap = Math.min(end, OA_LUNCH_END) - Math.max(start, OA_LUNCH_START);
  const deduct = Math.max(0, overlap);   // 与 12:00-13:00 的重叠（最多 60 分钟）
  return Math.max(0, (end - start) - deduct);
}

function oaMonday(ts) {
  const d = new Date(ts);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function oaWeekMin(days, now) {
  const monday = oaMonday(now);
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const rec = days[oaDateKey(d.getTime())];
    if (rec && rec.signed && rec.start && rec.end) total += oaDailyMin(rec.start, rec.end);
  }
  return total;
}

function oaFmt(min) {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? h + 'h ' + mm + 'm' : mm + 'm';
}

function oaRender() {
  const today = oaDateKey(Date.now());
  const rec = oaData.days[today] || {};
  const daily = oaDailyMin(rec.start, rec.end);
  const weekly = oaWeekMin(oaData.days, Date.now());
  oaDailyEl.textContent = 'Daily Hours: ' + oaFmt(daily);
  oaWeeklyEl.textContent = 'Weekly Hours: ' + oaFmt(weekly);
  const signed = !!(rec.signed && rec.start && rec.end);
  oaSignoffEl.textContent = signed ? 'Signed ✓' : 'Sign-off';
  oaSignoffEl.classList.toggle('signed', signed);
}

function oaOnChange() {
  const today = oaDateKey(Date.now());
  oaData.days[today] = { start: oaStartEl.value, end: oaEndEl.value, signed: false };
  kvSet(OA_KEY, oaData);
  oaRender();
}

function oaSignOff() {
  const today = oaDateKey(Date.now());
  const start = oaStartEl.value;
  const end = oaEndEl.value;
  if (!start || !end) {
    setStatus('Please enter Arrive and Leave times');
    return;
  }
  oaData.days[today] = { start, end, signed: true };
  kvSet(OA_KEY, oaData);
  oaRender();
  setStatus("Signed off — today's hours added to this week");
}

function oaClearDay() {
  if (!confirm("Clear today's record?")) return;
  delete oaData.days[oaDateKey(Date.now())];
  kvSet(OA_KEY, oaData);
  oaStartEl.value = '';
  oaEndEl.value = '';
  oaRender();
}

function oaClearWeek() {
  if (!confirm("Clear all records for this week?")) return;
  const monday = oaMonday(Date.now());
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    delete oaData.days[oaDateKey(d.getTime())];
  }
  kvSet(OA_KEY, oaData);
  oaStartEl.value = '';
  oaEndEl.value = '';
  oaRender();
}

async function initOa() {
  const panel = document.getElementById('oa-panel');
  oaStartEl = document.getElementById('oa-start');
  oaEndEl = document.getElementById('oa-end');
  oaDailyEl = document.getElementById('oa-daily');
  oaWeeklyEl = document.getElementById('oa-weekly');
  oaSignoffEl = document.getElementById('oa-signoff');
  oaClearDayEl = document.getElementById('oa-clear-day');
  oaClearWeekEl = document.getElementById('oa-clear-week');
  if (!panel || !oaStartEl || !oaEndEl || !oaDailyEl || !oaWeeklyEl || !oaSignoffEl || !oaClearDayEl || !oaClearWeekEl) return;
  panel.classList.remove('hidden');

  const stored = await kvGet(OA_KEY);
  if (stored && stored.days) oaData = { days: stored.days };
  else oaData = { days: {} };
  const rec = oaData.days[oaDateKey(Date.now())];
  if (rec) {
    oaStartEl.value = rec.start || '';
    oaEndEl.value = rec.end || '';
  }
  oaRender();
  oaStartEl.addEventListener('change', oaOnChange);
  oaEndEl.addEventListener('change', oaOnChange);
  oaSignoffEl.addEventListener('click', oaSignOff);
  oaClearDayEl.addEventListener('click', oaClearDay);
  oaClearWeekEl.addEventListener('click', oaClearWeek);
}

/* ================= 初始化 ================= */
async function init() {
  bgMode = (await kvGet(KEY_BG_MODE)) || null;

  // 加载用户称呼
  const storedName = await kvGet(KEY_USER_NAME);
  const namePromptNeeded = (storedName === undefined || storedName === null);
  userName = namePromptNeeded ? '' : String(storedName);
  if (userNameInputEl) userNameInputEl.value = userName;

  // 加载文件夹相关偏好
  const recursive = await kvGet(KEY_RECURSIVE);
  const showName = await kvGet(KEY_SHOW_NAME);
  chkRecursive.checked = recursive === undefined ? true : !!recursive;
  chkShowName.checked = showName === undefined ? false : !!showName;

  // TODO List：加载已保存的条目
  const storedTodo = await kvGet(KEY_TODO);
  todoItems = Array.isArray(storedTodo) ? storedTodo : [];
  renderTodo();

  // 时钟：直接使用本机时间
  startClock();

  // 天气：设备定位 + WeatherAPI.com
  initWeather();

  // Personal OA：工作时间统计
  initOa();

  // Rituals：每周例行清单
  initRituals();

  // 首次使用：询问名字
  if (namePromptNeeded) {
    showNamePrompt();
  }

  // 背景：按模式加载（folder / fluid / 首次选择）
  if (bgMode === 'fluid') {
    applyRandomGradient();
  } else if (bgMode === 'folder') {
    showCachedWallpaper();
    await showRandomImage();
  } else if (!namePromptNeeded) {
    firstRun.classList.remove('hidden');
  }

  updateModeUI();
}

init();
