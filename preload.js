'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

contextBridge.exposeInMainWorld('pdfHub', {
  loadLibrary: () => call('lib:load'),
  chooseFolder: () => call('lib:choose'),
  openLibraryFolder: () => call('lib:open-folder'),

  saveFile: (payload) => call('file:save', payload),
  readFile: (id) => call('file:read', id),
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
