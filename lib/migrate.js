'use strict';
// Chuyển toàn bộ dữ liệu thư viện sang thư mục mới (cắt/dán an toàn).
const fsp = require('fs/promises');
const path = require('path');

const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

function relation(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 'same';
  if (y.startsWith(x + path.sep)) return 'inside'; // b nằm trong a
  if (x.startsWith(y + path.sep)) return 'contains'; // b chứa a
  return 'none';
}

// Kiểm tra thư mục đích: trả về { ok, reason, empty }
async function inspectTarget(oldRoot, newRoot) {
  const rel = relation(oldRoot, newRoot);
  if (rel === 'same') return { ok: false, reason: 'Đây chính là thư mục đang dùng', empty: false };
  if (rel === 'inside') return { ok: false, reason: 'Thư mục mới nằm bên trong thư mục hiện tại', empty: false };
  if (rel === 'contains') return { ok: false, reason: 'Thư mục mới chứa thư mục hiện tại', empty: false };
  let names = [];
  try {
    names = await fsp.readdir(newRoot);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (names.length) return { ok: false, reason: 'Thư mục mới không trống', empty: false };
  return { ok: true, reason: '', empty: true };
}

// Tổng dung lượng và số tệp của một cây thư mục
async function walk(dir) {
  let files = 0;
  let bytes = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = await walk(full);
      files += r.files;
      bytes += r.bytes;
    } else if (e.isFile()) {
      files++;
      bytes += (await fsp.stat(full)).size;
    }
  }
  return { files, bytes };
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

// Chuyển một mục. Cùng ổ đĩa: đổi tên (tức thì). Khác ổ: chép, đối chiếu rồi mới xóa bản cũ.
async function moveEntry(src, dest, rename) {
  try {
    await rename(src, dest);
    return;
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
  }
  const st = await fsp.stat(src);
  try {
    if (st.isDirectory()) {
      await fsp.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
      const a = await walk(src);
      const b = await walk(dest);
      if (a.files !== b.files || a.bytes !== b.bytes) throw new Error('Bản sao không khớp với bản gốc');
    } else {
      await fsp.copyFile(src, dest);
      if ((await fsp.stat(dest)).size !== st.size) throw new Error('Bản sao không khớp với bản gốc');
    }
  } catch (err) {
    await fsp.rm(dest, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  await fsp.rm(src, { recursive: true, force: true });
}

/**
 * Chuyển các mục `names` (tên thư mục/tệp ở gốc thư viện) từ oldRoot sang newRoot.
 * Lỗi giữa chừng thì hoàn tác các mục đã chuyển. Trả về số mục đã chuyển.
 */
async function moveLibraryData(oldRoot, newRoot, names, { rename = fsp.rename, onProgress } = {}) {
  const check = await inspectTarget(oldRoot, newRoot);
  if (!check.ok) throw new Error(check.reason);
  await fsp.mkdir(newRoot, { recursive: true });

  const todo = [];
  for (const n of names) if (await exists(path.join(oldRoot, n))) todo.push(n);

  const done = [];
  try {
    for (const n of todo) {
      if (onProgress) onProgress(n, done.length, todo.length);
      await moveEntry(path.join(oldRoot, n), path.join(newRoot, n), rename);
      done.push(n);
    }
  } catch (err) {
    for (const n of done.reverse()) {
      try { await moveEntry(path.join(newRoot, n), path.join(oldRoot, n), rename); } catch { /* cố hết sức */ }
    }
    const e = new Error(`Không chuyển được dữ liệu, mọi thứ được giữ nguyên ở thư mục cũ. Chi tiết: ${err.message}`);
    e.code = err.code;
    throw e;
  }
  return done.length;
}

module.exports = { moveLibraryData, inspectTarget, relation };
