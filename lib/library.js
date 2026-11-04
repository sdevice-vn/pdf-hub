'use strict';
/**
 * Library: quản lý thư viện PDF lưu trực tiếp trên ổ đĩa (không phụ thuộc Electron).
 *
 * Cấu trúc thư mục lưu trữ do người dùng chọn:
 *   <root>/<Phân loại>/<tên file>.pdf   -> file thật, mở được bằng mọi trình đọc PDF
 *   <root>/.thung-rac/<id>.pdf           -> file trong thùng rác
 *   <root>/.pdfhub/library.json          -> siêu dữ liệu (phân loại, ghi chú, số trang...)
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CATEGORIES = ['Công việc', 'Học tập', 'Hóa đơn', 'Cá nhân', 'Khác'];
const META_DIR = '.pdfhub';
const META_FILE = 'library.json';
const TRASH_DIR = '.thung-rac';
const PDF_RE = /\.pdf$/i;

function sanitizeName(name) {
  let n = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 100);
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = '_' + n;
  return n;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  let n = 1;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

async function moveFile(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
}

class Library {
  constructor(root) {
    this.root = path.resolve(root);
    this.categories = [];
    this.files = [];
    this._queue = Promise.resolve();
  }

  static async open(root) {
    const lib = new Library(root);
    await lib._load();
    return lib;
  }

  // Chạy tuần tự các thao tác ghi để tránh xung đột
  _run(fn) {
    const p = this._queue.then(fn);
    this._queue = p.catch(() => {});
    return p;
  }

  _abs(rel) {
    const full = path.resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error('Đường dẫn không hợp lệ');
    }
    return full;
  }

  _find(id) {
    const f = this.files.find((x) => x.id === id);
    if (!f) throw new Error('Không tìm thấy tài liệu');
    return f;
  }

  async _load() {
    await fsp.mkdir(this.root, { recursive: true });
    await fsp.mkdir(path.join(this.root, TRASH_DIR), { recursive: true });
    await fsp.mkdir(path.join(this.root, META_DIR), { recursive: true });

    let saved = null;
    try {
      saved = JSON.parse(await fsp.readFile(path.join(this.root, META_DIR, META_FILE), 'utf8'));
    } catch {
      saved = null;
    }

    const savedCats =
      saved && Array.isArray(saved.categories)
        ? saved.categories.filter((c) => typeof c === 'string' && sanitizeName(c))
        : [];
    this.categories = savedCats.length ? savedCats : [...DEFAULT_CATEGORIES];

    // Giữ lại các mục còn tồn tại trên đĩa
    this.files = [];
    const savedFiles = saved && Array.isArray(saved.files) ? saved.files : [];
    for (const f of savedFiles) {
      if (!f || !f.id || !f.relPath) continue;
      try {
        if (await exists(this._abs(f.relPath))) this.files.push(f);
      } catch {
        /* bỏ qua mục lỗi */
      }
    }

    // Nhận diện thư mục con chứa PDF (do người dùng tự thêm vào) như một phân loại
    const entries = await fsp.readdir(this.root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      if (this.categories.some((c) => c.toLowerCase() === e.name.toLowerCase())) continue;
      const inner = await fsp.readdir(path.join(this.root, e.name)).catch(() => []);
      if (inner.some((n) => PDF_RE.test(n))) this.categories.push(e.name);
    }

    // Đảm bảo thư mục phân loại tồn tại và nhập các PDF chưa được ghi nhận
    const known = new Set(this.files.map((f) => f.relPath.toLowerCase()));
    for (const cat of this.categories) {
      const dir = path.join(this.root, cat);
      await fsp.mkdir(dir, { recursive: true });
      const names = await fsp.readdir(dir).catch(() => []);
      for (const n of names) {
        if (!PDF_RE.test(n)) continue;
        const relPath = `${cat}/${n}`;
        if (known.has(relPath.toLowerCase())) continue;
        const st = await fsp.stat(path.join(dir, n)).catch(() => null);
        if (!st || !st.isFile()) continue;
        this.files.push({
          id: 'pdf_' + crypto.randomUUID(),
          name: n,
          size: st.size,
          category: cat,
          notes: '',
          uploadDate: Math.round(st.mtimeMs),
          isTrash: false,
          pageCount: 0,
          relPath
        });
      }
    }

    await this._save();
  }

  async _save() {
    const dir = path.join(this.root, META_DIR);
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, META_FILE);
    const tmp = file + '.tmp';
    await fsp.writeFile(
      tmp,
      JSON.stringify({ version: 1, categories: this.categories, files: this.files }, null, 2),
      'utf8'
    );
    await fsp.rename(tmp, file);
  }

  snapshot() {
    return {
      path: this.root,
      categories: [...this.categories],
      files: this.files.map((f) => ({ ...f }))
    };
  }

  getAbsPath(id) {
    return this._abs(this._find(id).relPath);
  }

  getFile(id) {
    return { ...this._find(id) };
  }

  readFile(id) {
    return fsp.readFile(this.getAbsPath(id));
  }

  // ---------- Ảnh xem trước (trang đầu của PDF) ----------

  _thumbPath(id) {
    this._find(id); // kiểm tra id hợp lệ trước khi ghép đường dẫn
    return path.join(this.root, META_DIR, 'thumbs', `${id}.jpg`);
  }

  async getThumb(id) {
    try {
      return await fsp.readFile(this._thumbPath(id));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async setThumb(id, data) {
    const file = this._thumbPath(id);
    const buf = Buffer.from(data);
    if (!buf.length || buf.length > 2 * 1024 * 1024) throw new Error('Ảnh xem trước không hợp lệ');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, buf);
  }

  async _dropThumb(id) {
    await fsp.unlink(path.join(this.root, META_DIR, 'thumbs', `${id}.jpg`)).catch(() => {});
  }

  // ---------- Tài liệu ----------

  addFile({ name, data, category, pageCount }) {
    return this._run(async () => {
      if (!this.categories.includes(category)) category = this.categories[0];
      let fileName = sanitizeName(name) || 'tai-lieu';
      if (!PDF_RE.test(fileName)) fileName += '.pdf';

      const dir = path.join(this.root, category);
      await fsp.mkdir(dir, { recursive: true });
      const dest = await uniquePath(dir, fileName);
      const buf = Buffer.from(data);
      await fsp.writeFile(dest, buf, { flag: 'wx' });

      const finalName = path.basename(dest);
      const entry = {
        id: 'pdf_' + crypto.randomUUID(),
        name: finalName,
        size: buf.length,
        category,
        notes: '',
        uploadDate: Date.now(),
        isTrash: false,
        pageCount: Number(pageCount) || 0,
        relPath: `${category}/${finalName}`
      };
      this.files.push(entry);
      await this._save();
      return { ...entry };
    });
  }

  updateMeta(id, patch) {
    return this._run(async () => {
      const f = this._find(id);
      if (patch && patch.pageCount != null) f.pageCount = Number(patch.pageCount) || 0;
      if (patch && typeof patch.notes === 'string') f.notes = patch.notes.slice(0, 2000);
      await this._save();
    });
  }

  trash(id) {
    return this._run(async () => {
      const f = this._find(id);
      if (f.isTrash) return;
      const relPath = `${TRASH_DIR}/${f.id}.pdf`;
      await fsp.mkdir(path.join(this.root, TRASH_DIR), { recursive: true });
      await moveFile(this._abs(f.relPath), this._abs(relPath));
      f.relPath = relPath;
      f.isTrash = true;
      f.trashedAt = Date.now();
      await this._save();
    });
  }

  restore(id) {
    return this._run(async () => {
      const f = this._find(id);
      if (!f.isTrash) return;
      if (!this.categories.includes(f.category)) this.categories.push(f.category);
      const dir = path.join(this.root, f.category);
      await fsp.mkdir(dir, { recursive: true });
      const dest = await uniquePath(dir, sanitizeName(f.name) || 'tai-lieu.pdf');
      await moveFile(this._abs(f.relPath), dest);
      f.name = path.basename(dest);
      f.relPath = `${f.category}/${f.name}`;
      f.isTrash = false;
      delete f.trashedAt;
      await this._save();
    });
  }

  remove(id) {
    return this._run(async () => {
      const f = this._find(id);
      await fsp.unlink(this._abs(f.relPath)).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
      this.files = this.files.filter((x) => x.id !== id);
      await this._dropThumb(id);
      await this._save();
    });
  }

  emptyTrash() {
    return this._run(async () => {
      const trashed = this.files.filter((f) => f.isTrash);
      for (const f of trashed) {
        await fsp.unlink(this._abs(f.relPath)).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
      }
      this.files = this.files.filter((f) => !f.isTrash);
      for (const f of trashed) await this._dropThumb(f.id);
      await this._save();
    });
  }

  // ---------- Phân loại ----------

  addCategory(rawName) {
    return this._run(async () => {
      const name = sanitizeName(rawName);
      if (!name) throw new Error('Tên phân loại không hợp lệ');
      if (this.categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
        throw new Error('Tên phân loại này đã tồn tại!');
      }
      await fsp.mkdir(path.join(this.root, name), { recursive: true });
      this.categories.push(name);
      await this._save();
      return name;
    });
  }

  renameCategory(oldName, rawNewName) {
    return this._run(async () => {
      const newName = sanitizeName(rawNewName);
      if (!newName) throw new Error('Tên phân loại không hợp lệ');
      const idx = this.categories.indexOf(oldName);
      if (idx < 0) throw new Error('Không tìm thấy phân loại');
      if (newName === oldName) return;
      if (this.categories.some((c, i) => i !== idx && c.toLowerCase() === newName.toLowerCase())) {
        throw new Error('Tên phân loại này đã tồn tại!');
      }

      const oldDir = path.join(this.root, oldName);
      const newDir = path.join(this.root, newName);
      const sameIgnoringCase = oldName.toLowerCase() === newName.toLowerCase();
      if (!sameIgnoringCase && (await exists(newDir))) {
        throw new Error('Đã có thư mục trùng tên trong thư mục lưu trữ');
      }
      if (await exists(oldDir)) await fsp.rename(oldDir, newDir);
      else await fsp.mkdir(newDir, { recursive: true });

      for (const f of this.files) {
        if (f.category !== oldName) continue;
        f.category = newName;
        if (!f.isTrash) f.relPath = `${newName}/${path.posix.basename(f.relPath)}`;
      }
      this.categories[idx] = newName;
      await this._save();
    });
  }

  deleteCategory(name) {
    return this._run(async () => {
      if (!this.categories.includes(name)) throw new Error('Không tìm thấy phân loại');
      if (this.categories.length <= 1) throw new Error('Bạn phải giữ lại ít nhất 1 phân loại!');
      const fallback = this.categories.find((c) => c !== name);
      const fallbackDir = path.join(this.root, fallback);
      await fsp.mkdir(fallbackDir, { recursive: true });

      for (const f of this.files) {
        if (f.category !== name) continue;
        if (!f.isTrash) {
          const dest = await uniquePath(fallbackDir, path.posix.basename(f.relPath));
          await moveFile(this._abs(f.relPath), dest);
          f.name = path.basename(dest);
          f.relPath = `${fallback}/${f.name}`;
        }
        f.category = fallback;
      }

      this.categories = this.categories.filter((c) => c !== name);
      await fsp.rmdir(path.join(this.root, name)).catch(() => {}); // chỉ xóa nếu thư mục rỗng
      await this._save();
    });
  }
}

module.exports = { Library, sanitizeName, DEFAULT_CATEGORIES, META_DIR, TRASH_DIR };
