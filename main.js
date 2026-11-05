'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { Library } = require('./lib/library');
const { mimeOf, isRisky, extOf } = require('./lib/kinds');
const { parseRange } = require('./lib/serve');

// Giao thức riêng để trình phát video/âm thanh/ảnh đọc trực tiếp tệp trong thư viện (có hỗ trợ tua)
protocol.registerSchemesAsPrivileged([
  { scheme: 'dochub', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

let mainWindow = null;
let library = null;
let settings = { libraryPath: null, dark: null };

// ---------- Cài đặt (đường dẫn thư viện, giao diện sáng/tối) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Chuyển cài đặt từ bản PDF Hub cũ (thư mục dữ liệu mang tên cũ) sang Documents Hub
function migrateLegacySettings() {
  try {
    if (fs.existsSync(settingsFile())) return;
    const base = app.getPath('appData');
    for (const dir of ['PDF Hub', 'pdf-hub']) {
      const old = path.join(base, dir, 'settings.json');
      if (fs.existsSync(old)) {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
        fs.copyFileSync(old, settingsFile());
        return;
      }
    }
  } catch {
    /* bỏ qua: người dùng chọn lại thư mục */
  }
}

function loadSettings() {
  migrateLegacySettings();
  try {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    /* lần chạy đầu tiên */
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
}

// ---------- Giao diện sáng/tối cho thanh tiêu đề ----------
const THEME_COLORS = {
  light: { color: '#E9ECE9', symbolColor: '#16201B' },
  dark: { color: '#0E1311', symbolColor: '#E6ECE8' }
};
const TITLEBAR_HEIGHT = 52;

function isDark() {
  return typeof settings.dark === 'boolean' ? settings.dark : nativeTheme.shouldUseDarkColors;
}

function applyTheme(win) {
  if (!win || win.isDestroyed()) return;
  const t = isDark() ? THEME_COLORS.dark : THEME_COLORS.light;
  win.setBackgroundColor(t.color);
  if (process.platform === 'win32') {
    win.setTitleBarOverlay({ color: t.color, symbolColor: t.symbolColor, height: TITLEBAR_HEIGHT });
  }
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function need() {
  if (!library) throw new Error('Chưa chọn thư mục lưu trữ');
  return library;
}

// Thực hiện thao tác thay đổi rồi trả về trạng thái mới của thư viện
function mutate(fn) {
  return async (...args) => {
    const lib = need();
    await fn(lib, ...args);
    return lib.snapshot();
  };
}

function friendlyError(err) {
  switch (err && err.code) {
    case 'ENOENT': return 'Không tìm thấy tệp';
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY': return 'Không đọc được tệp (không đủ quyền hoặc tệp đang được dùng)';
    case 'ENOSPC': return 'Ổ đĩa đã đầy';
    default: return (err && err.message) || String(err);
  }
}

// Chép các tệp vào thư viện, tệp nào lỗi thì báo riêng, không làm hỏng cả lượt
async function importPaths(paths, category) {
  const lib = need();
  let added = 0;
  const failed = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || !p) continue;
    try {
      await lib.importFile(p, category);
      added++;
    } catch (err) {
      failed.push({ name: path.basename(p), error: friendlyError(err) });
    }
  }
  return { snapshot: lib.snapshot(), added, failed };
}

function registerIpc() {
  handle('lib:load', async () => {
    if (!settings.libraryPath) return null;
    library = await Library.open(settings.libraryPath);
    return library.snapshot();
  });

  handle('lib:choose', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục lưu trữ',
      defaultPath: settings.libraryPath || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    const chosen = res.filePaths[0];
    library = await Library.open(chosen);
    settings.libraryPath = chosen;
    saveSettings();
    return library.snapshot();
  });

  handle('lib:open-folder', async () => {
    const err = await shell.openPath(need().root);
    if (err) throw new Error(err);
  });

  // Hộp thoại chọn tệp để thêm (mọi định dạng); việc chép tệp làm ở file:import
  handle('file:choose', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn tệp để thêm',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile', 'multiSelections']
    });
    return res.canceled ? [] : res.filePaths;
  });
  handle('file:import', (paths, category) => importPaths(paths, category));

  handle('file:update-meta', mutate((lib, id, patch) => lib.updateMeta(id, patch)));
  handle('file:trash', mutate((lib, id) => lib.trash(id)));
  handle('file:restore', mutate((lib, id) => lib.restore(id)));
  handle('file:delete', mutate((lib, id) => lib.remove(id)));
  handle('trash:empty', mutate((lib) => lib.emptyTrash()));

  handle('file:read', async (id) => need().readFile(id));
  handle('file:read-text', async (id, maxBytes) =>
    need().readText(id, Math.min(Math.max(Number(maxBytes) || 1048576, 1), 5 * 1048576)));
  handle('thumb:get', async (id) => need().getThumb(id));
  handle('thumb:set', async (id, data) => {
    await need().setThumb(id, data);
  });

  handle('app:get-theme', async () => (typeof settings.dark === 'boolean' ? settings.dark : null));
  handle('app:set-theme', async (dark) => {
    settings.dark = !!dark;
    saveSettings();
    applyTheme(mainWindow);
  });

  handle('file:export', async (id) => {
    const lib = need();
    const f = lib.getFile(id);
    const ext = extOf(f.name);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu bản sao',
      defaultPath: path.join(app.getPath('downloads'), f.name),
      filters: ext
        ? [{ name: `Tệp .${ext}`, extensions: [ext] }, { name: 'Tất cả tệp', extensions: ['*'] }]
        : [{ name: 'Tất cả tệp', extensions: ['*'] }]
    });
    if (res.canceled || !res.filePath) return { saved: false };
    await fs.promises.copyFile(lib.getAbsPath(id), res.filePath);
    return { saved: true, path: res.filePath };
  });

  handle('file:reveal', async (id) => {
    shell.showItemInFolder(need().getAbsPath(id));
  });

  handle('file:open-external', async (id) => {
    const lib = need();
    const f = lib.getFile(id);
    if (isRisky(f.name)) {
      throw new Error('Vì an toàn, Documents Hub không chạy trực tiếp tệp thực thi hoặc script. Hãy dùng "Hiện trong thư mục" để mở thủ công.');
    }
    const err = await shell.openPath(lib.getAbsPath(id));
    if (err) throw new Error(err);
  });

  handle('cat:add', mutate((lib, name) => lib.addCategory(name)));
  handle('cat:rename', mutate((lib, oldName, newName) => lib.renameCategory(oldName, newName)));
  handle('cat:delete', mutate((lib, name) => lib.deleteCategory(name)));
}

// ---------- Giao thức dochub://file/<id>: phát video, âm thanh, ảnh trực tiếp từ đĩa ----------
function registerMediaProtocol() {
  protocol.handle('dochub', async (request) => {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    try {
      const url = new URL(request.url);
      const id = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const lib = need();
      const file = lib.getFile(id);
      const abs = lib.getAbsPath(id);
      const stat = await fs.promises.stat(abs);

      const range = parseRange(request.headers.get('range'), stat.size);
      if (range && range.invalid) {
        return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${stat.size}` } });
      }
      const start = range ? range.start : 0;
      const end = range ? range.end : stat.size - 1;

      const headers = {
        ...cors,
        'Content-Type': mimeOf(file.name),
        'Accept-Ranges': 'bytes',
        'Content-Length': String(stat.size === 0 ? 0 : end - start + 1),
        'Cache-Control': 'no-store'
      };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      if (stat.size === 0) return new Response(null, { status: 200, headers });

      const body = Readable.toWeb(fs.createReadStream(abs, { start, end }));
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch {
      return new Response('Not found', { status: 404, headers: cors });
    }
  });
}

// ---------- Cửa sổ ----------
function createWindow() {
  const t = isDark() ? THEME_COLORS.dark : THEME_COLORS.light;
  // Thanh tiêu đề tùy biến (nút thu nhỏ/phóng to/đóng vẽ đè lên giao diện) chỉ dùng trên Windows
  const customTitleBar = process.platform === 'win32'
    ? { titleBarStyle: 'hidden', titleBarOverlay: { ...t, height: TITLEBAR_HEIGHT } }
    : {};

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    title: 'Documents Hub',
    show: false,
    backgroundColor: t.color,
    autoHideMenuBar: true,
    ...customTitleBar,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Không cho trang điều hướng đi nơi khác (ví dụ khi thả tệp vào cửa sổ)
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('vn.sdevice.documentshub');
    Menu.setApplicationMenu(null);
    loadSettings();
    registerIpc();
    registerMediaProtocol();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
