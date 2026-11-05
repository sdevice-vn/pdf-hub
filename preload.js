'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

contextBridge.exposeInMainWorld('docHub', {
  platform: process.platform,

  loadLibrary: () => call('lib:load'),
  chooseFolder: () => call('lib:choose'),
  openLibraryFolder: () => call('lib:open-folder'),

  // Thêm tệp: lấy đường dẫn thật của tệp kéo thả để main chép thẳng từ đĩa (không nạp cả tệp vào bộ nhớ)
  pathsForFiles: (files) => {
    const out = [];
    for (const f of Array.from(files || [])) {
      try {
        const p = webUtils.getPathForFile(f);
        if (p) out.push(p);
      } catch {
        /* bỏ qua mục không phải tệp */
      }
    }
    return out;
  },
  chooseFiles: () => call('file:choose'),
  importPaths: (paths, category) => call('file:import', paths, category),

  readFile: (id) => call('file:read', id),
  readText: (id, maxBytes) => call('file:read-text', id, maxBytes),
  getThumb: (id) => call('thumb:get', id),
  setThumb: (id, data) => call('thumb:set', id, data),
  getTheme: () => call('app:get-theme'),
  setTheme: (dark) => call('app:set-theme', dark),
  updateMeta: (id, patch) => call('file:update-meta', id, patch),
  trashFile: (id) => call('file:trash', id),
  restoreFile: (id) => call('file:restore', id),
  deleteFile: (id) => call('file:delete', id),
  emptyTrash: () => call('trash:empty'),
  exportFile: (id) => call('file:export', id),
  revealFile: (id) => call('file:reveal', id),
  openExternal: (id) => call('file:open-external', id),

  addCategory: (name) => call('cat:add', name),
  renameCategory: (oldName, newName) => call('cat:rename', oldName, newName),
  deleteCategory: (name) => call('cat:delete', name)
});
