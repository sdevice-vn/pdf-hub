// Kiểm thử đa định dạng: node scripts/test-files.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library, sanitizeName } = require('../lib/library');
const { kindOf, mimeOf, isRisky, extOf } = require('../lib/kinds');
const { parseRange } = require('../lib/serve');

(async () => {
  // ---- Nhận diện loại tệp ----
  assert.strictEqual(kindOf('Clip.MP4'), 'video');
  assert.strictEqual(kindOf('bai-hat.mp3'), 'audio');
  assert.strictEqual(kindOf('anh.JPG'), 'image');
  assert.strictEqual(kindOf('bao-cao.docx'), 'office');
  assert.strictEqual(kindOf('main.ino'), 'text');
  assert.strictEqual(kindOf('du-lieu.zip'), 'archive');
  assert.strictEqual(kindOf('khong-co-duoi'), 'other');
  assert.strictEqual(kindOf('.gitignore'), 'other');
  assert.strictEqual(extOf('a.b.c.PDF'), 'pdf');
  assert.strictEqual(mimeOf('x.mp4'), 'video/mp4');
  assert.strictEqual(mimeOf('x.unknown'), 'application/octet-stream');
  assert.strictEqual(isRisky('Setup.EXE'), true);
  assert.strictEqual(isRisky('run.bat'), true);
  assert.strictEqual(isRisky('anh.png'), false);

  // ---- Range (tua video) ----
  assert.strictEqual(parseRange(null, 100), null);
  assert.strictEqual(parseRange('chunks=1-2', 100), null);
  assert.deepStrictEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepStrictEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=100-120', 100), { invalid: true });
  assert.deepStrictEqual(parseRange('bytes=20-10', 100), { invalid: true });
  assert.deepStrictEqual(parseRange('bytes=0-0', 0), { invalid: true });

  // ---- Tên dài không mất đuôi ----
  const longName = 'a'.repeat(300) + '.mp4';
  const cleaned = sanitizeName(longName);
  assert(cleaned.endsWith('.mp4') && cleaned.length <= 150);

  // ---- Thư viện ----
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dochub-test-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'dochub-src-'));
  const on = (...p) => path.join(root, ...p);
  const put = (name, data) => { const p = path.join(src, name); fs.writeFileSync(p, data); return p; };

  // Thư viện kiểu cũ (PDF Hub): thư mục siêu dữ liệu .pdfhub phải được giữ lại khi mở bằng bản mới
  fs.mkdirSync(on('.pdfhub', 'thumbs'), { recursive: true });
  fs.mkdirSync(on('Hóa đơn'), { recursive: true });
  fs.writeFileSync(on('Hóa đơn', 'cu.pdf'), '%PDF-1.4');
  fs.writeFileSync(on('.pdfhub', 'thumbs', 'pdf_old.jpg'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(on('.pdfhub', 'library.json'), JSON.stringify({
    version: 1,
    categories: ['Hóa đơn', 'Khác'],
    files: [{ id: 'pdf_old', name: 'cu.pdf', size: 8, category: 'Hóa đơn', notes: 'ghi chú cũ', uploadDate: 1, isTrash: false, pageCount: 4, relPath: 'Hóa đơn/cu.pdf' }]
  }));
  // Tệp tự chép vào thư mục: nhận diện mọi loại, bỏ qua tệp ẩn/rác
  fs.mkdirSync(on('Khác'), { recursive: true });
  fs.writeFileSync(on('Khác', 'ghi-chu.txt'), 'xin chào');
  fs.writeFileSync(on('Khác', 'video-tu-chep.mp4'), Buffer.alloc(10));
  fs.writeFileSync(on('Khác', '~$tam.docx'), 'x');
  fs.writeFileSync(on('Khác', '.an'), 'x');
  fs.writeFileSync(on('Khác', 'Thumbs.db'), 'x');

  let lib = await Library.open(root);
  assert(!fs.existsSync(on('.pdfhub')), 'thư mục cũ đã được đổi tên');
  assert(fs.existsSync(on('.dochub', 'library.json')));
  const old = lib.getFile('pdf_old');
  assert.strictEqual(old.notes, 'ghi chú cũ');
  assert.strictEqual(old.pageCount, 4);
  assert.strictEqual(old.kind, 'pdf');
  assert((await lib.getThumb('pdf_old')).equals(Buffer.from([1, 2, 3])), 'ảnh xem trước cũ còn nguyên');

  const names = lib.files.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['cu.pdf', 'ghi-chu.txt', 'video-tu-chep.mp4']);
  assert.strictEqual(lib.getFile(lib.files.find((f) => f.name === 'video-tu-chep.mp4').id).kind, 'video');

  // Nhập tệp lớn theo đường dẫn (video 3 MB giả lập)
  const big = crypto.randomBytes(3 * 1024 * 1024);
  const clip = put('clip.mp4', big);
  const a = await lib.importFile(clip, 'Khác');
  const b = await lib.importFile(clip, 'Khác');
  assert.strictEqual(a.name, 'clip.mp4');
  assert.strictEqual(b.name, 'clip (1).mp4');
  assert.strictEqual(a.kind, 'video');
  assert.strictEqual(a.size, big.length);
  assert(fs.readFileSync(on('Khác', 'clip.mp4')).equals(big), 'nội dung chép đúng từng byte');
  assert(fs.existsSync(clip), 'tệp gốc không bị di chuyển');
  assert(lib.snapshot().files.every((f) => typeof f.kind === 'string'));

  // Nhập nhiều loại, thư mục và tệp không tồn tại
  const docx = await lib.importFile(put('Báo cáo.docx', 'PK'), 'Hóa đơn');
  assert.strictEqual(docx.kind, 'office');
  const noExt = await lib.importFile(put('README', 'hi'), 'Hóa đơn');
  assert.strictEqual(noExt.name, 'README');
  assert.strictEqual(noExt.kind, 'other');
  await assert.rejects(() => lib.importFile(src, 'Khác'), /thư mục/);
  await assert.rejects(() => lib.importFile(path.join(src, 'khong-co.mp4'), 'Khác'), /ENOENT/);
  assert(!fs.readdirSync(on('Khác')).some((n) => n.includes('khong-co')));
  // Phân loại không tồn tại -> rơi về phân loại đầu tiên
  const fallback = await lib.importFile(put('lạc.png', 'x'), 'Không có');
  assert.strictEqual(fallback.category, lib.categories[0]);

  // Siêu dữ liệu thời lượng video
  await lib.updateMeta(a.id, { duration: 123.4 });
  assert.strictEqual(lib.getFile(a.id).duration, 123.4);

  // Đọc văn bản
  const t1 = put('utf8.txt', 'Dòng 1\nTiếng Việt: ăn cơm chưa?\n');
  const ti = await lib.importFile(t1, 'Khác');
  let r = await lib.readText(ti.id);
  assert.strictEqual(r.text, 'Dòng 1\nTiếng Việt: ăn cơm chưa?\n');
  assert.strictEqual(r.truncated, false);

  const bom = await lib.importFile(put('bom.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('có BOM')])), 'Khác');
  assert.strictEqual((await lib.readText(bom.id)).text, 'có BOM');

  const u16 = await lib.importFile(put('u16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Notepad ư', 'utf16le')])), 'Khác');
  assert.strictEqual((await lib.readText(u16.id)).text, 'Notepad ư');

  const bin = await lib.importFile(put('nhi-phan.txt', Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02])), 'Khác');
  await assert.rejects(() => lib.readText(bin.id), /không phải văn bản/);

  const longText = await lib.importFile(put('dai.log', 'x'.repeat(5000)), 'Khác');
  r = await lib.readText(longText.id, 1000);
  assert.strictEqual(r.text.length, 1000);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.size, 5000);

  const empty = await lib.importFile(put('rong.txt', ''), 'Khác');
  assert.deepStrictEqual(await lib.readText(empty.id), { text: '', truncated: false, size: 0 });

  // Đổi tên và chuyển phân loại
  const rn = await lib.importFile(put('goc.txt', 'noi dung'), 'Khác');
  await lib.renameFile(rn.id, 'Tên mới');
  assert.strictEqual(lib.getFile(rn.id).name, 'Tên mới.txt', 'giữ đuôi khi bỏ trống');
  assert(fs.existsSync(on('Khác', 'Tên mới.txt')) && !fs.existsSync(on('Khác', 'goc.txt')));
  await assert.rejects(() => lib.renameFile(rn.id, 'ghi-chu.txt'), /Đã có tệp/);
  await assert.rejects(() => lib.renameFile(rn.id, '../../x'.replace(/[a-z]/g, '') ), /không hợp lệ/);
  await lib.renameFile(rn.id, 'TÊN MỚI.txt');
  assert.strictEqual(lib.getFile(rn.id).name, 'TÊN MỚI.txt', 'đổi hoa/thường');
  await lib.renameFile(rn.id, '../thoat.txt');
  assert(lib.isInside(lib.getAbsPath(rn.id)) && lib.getFile(rn.id).name === 'thoat.txt', 'không thoát khỏi thư mục');
  await lib.importFile(put('thoat.txt', 'khac'), 'Hóa đơn');
  await lib.moveToCategory(rn.id, 'Hóa đơn');
  assert.strictEqual(lib.getFile(rn.id).category, 'Hóa đơn');
  assert.strictEqual(lib.getFile(rn.id).name, 'thoat (1).txt', 'trùng tên khi chuyển thì đánh số');
  assert(fs.existsSync(on('Hóa đơn', 'thoat (1).txt')) && !fs.existsSync(on('Khác', 'thoat.txt')));
  await assert.rejects(() => lib.moveToCategory(rn.id, 'Không có'), /không tồn tại/);
  assert.strictEqual(lib.isInside(on('Khác', 'x')), true);
  assert.strictEqual(lib.isInside(src), false);
  await lib.trash(rn.id);
  await assert.rejects(() => lib.renameFile(rn.id, 'a'), /khôi phục/);
  await lib.restore(rn.id);

  // Thùng rác giữ đúng đuôi tệp; khôi phục về đúng tên
  await lib.trash(a.id);
  assert(fs.existsSync(on('.thung-rac', a.id + '.mp4')));
  assert(!fs.existsSync(on('Khác', 'clip.mp4')));
  await lib.restore(a.id);
  assert(fs.existsSync(on('Khác', 'clip.mp4')));
  assert.strictEqual(lib.getFile(a.id).kind, 'video');

  // Mở lại: mọi thứ còn nguyên
  lib = await Library.open(root);
  assert.strictEqual(lib.getFile(a.id).duration, 123.4);
  assert.strictEqual(lib.getFile('pdf_old').notes, 'ghi chú cũ');


  // ---- Chuyển thư viện sang thư mục mới ----
  const { moveLibraryData, inspectTarget } = require('../lib/migrate');
  const { TRASH_DIR, META_DIR } = require('../lib/library');
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dochub-new-')), 'thu-vien-moi');
  const namesToMove = [...lib.categories, TRASH_DIR, META_DIR];
  const before = lib.files.map((f) => [f.relPath, fs.statSync(lib.getAbsPath(f.id)).size]);
  assert.strictEqual((await inspectTarget(root, path.join(root, 'con'))).ok, false, 'thư mục con');
  assert.strictEqual((await inspectTarget(root, path.dirname(root))).ok, false, 'thư mục cha');
  assert.strictEqual((await inspectTarget(root, root)).ok, false, 'cùng thư mục');
  fs.mkdirSync(path.join(path.dirname(dest), 'khong-trong'));
  fs.writeFileSync(path.join(path.dirname(dest), 'khong-trong', 'x'), '1');
  assert.strictEqual((await inspectTarget(root, path.join(path.dirname(dest), 'khong-trong'))).reason, 'Thư mục mới không trống');

  // Cùng ổ đĩa (rename)
  const n1 = await moveLibraryData(root, dest, namesToMove);
  assert(n1 > 0);
  assert(!fs.existsSync(on('Khác')) && !fs.existsSync(on('.dochub')), 'thư mục cũ đã được dọn');
  let moved = await Library.open(dest);
  assert.strictEqual(moved.files.length, before.length);
  for (const [rel, size] of before) assert.strictEqual(fs.statSync(path.join(dest, rel)).size, size);
  assert.strictEqual(moved.getFile(a.id).duration, 123.4, 'siêu dữ liệu đi cùng');

  // Khác ổ đĩa (EXDEV): chép, đối chiếu, xóa bản cũ
  const dest2 = path.join(path.dirname(dest), 'thu-vien-3');
  const exdev = async () => { const e = new Error('xdev'); e.code = 'EXDEV'; throw e; };
  await moveLibraryData(dest, dest2, namesToMove, { rename: exdev });
  assert(!fs.existsSync(path.join(dest, 'Khác')));
  moved = await Library.open(dest2);
  assert(fs.readFileSync(path.join(dest2, 'Khác', 'clip.mp4')).equals(big), 'chép khác ổ đúng từng byte');

  // Lỗi giữa chừng -> hoàn tác, thư mục cũ nguyên vẹn
  const dest3 = path.join(path.dirname(dest), 'thu-vien-4');
  let calls = 0;
  const flaky = async (s, d) => { if (++calls === 3) { const e = new Error('hỏng đĩa'); e.code = 'EIO'; throw e; } return fs.promises.rename(s, d); };
  await assert.rejects(() => moveLibraryData(dest2, dest3, namesToMove, { rename: flaky }), /giữ nguyên ở thư mục cũ/);
  assert((await Library.open(dest2)).files.length === before.length, 'sau hoàn tác vẫn đủ tệp');
  assert(fs.readFileSync(path.join(dest2, 'Khác', 'clip.mp4')).equals(big));
  fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  lib = null;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(src, { recursive: true, force: true });
  console.log('OK - kiểm thử đa định dạng đạt');
})().catch((e) => {
  console.error('LỖI:', e);
  process.exit(1);
});
