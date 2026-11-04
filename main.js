'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Library } = require('./lib/library');

let mainWindow = null;
let library = null;
let settings = { libraryPath: null };

// ---------- Cài đặt (lưu đường dẫn thư mục thư viện) ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
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

function registerIpc() {
  handle('lib:load', async () => {
    if (!settings.libraryPath) return null;
    library = await Library.open(settings.libraryPath);
    return library.snapshot();
  });

  handle('lib:choose', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục lưu trữ tài liệu PDF',
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

  handle('file:save', mutate((lib, payload) => lib.addFile(payload)));
  handle('file:update-meta', mutate((lib, id, patch) => lib.updateMeta(id, patch)));
  handle('file:trash', mutate((lib, id) => lib.trash(id)));
  handle('file:restore', mutate((lib, id) => lib.restore(id)));
  handle('file:delete', mutate((lib, id) => lib.remove(id)));
  handle('trash:empty', mutate((lib) => lib.emptyTrash()));

  handle('file:read', async (id) => need().readFile(id));

  handle('file:export', async (id) => {
    const lib = need();
    const f = lib.getFile(id);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu bản sao PDF',
      defaultPath: path.join(app.getPath('downloads'), f.name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return { saved: false };
    await fs.promises.copyFile(lib.getAbsPath(id), res.filePath);
    return { saved: true, path: res.filePath };
  });

  handle('file:reveal', async (id) => {
    shell.showItemInFolder(need().getAbsPath(id));
  });

  handle('file:open-external', async (id) => {
    const err = await shell.openPath(need().getAbsPath(id));
    if (err) throw new Error(err);
  });

  handle('cat:add', mutate((lib, name) => lib.addCategory(name)));
  handle('cat:rename', mutate((lib, oldName, newName) => lib.renameCategory(oldName, newName)));
  handle('cat:delete', mutate((lib, name) => lib.deleteCategory(name)));
}

// ---------- Cửa sổ ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'PDF Hub',
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Không cho trang điều hướng đi nơi khác (ví dụ khi thả file PDF vào cửa sổ)
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
    app.setAppUserModelId('vn.sdevice.pdfhub');
    Menu.setApplicationMenu(null);
    loadSettings();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
