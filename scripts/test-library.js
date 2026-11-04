// Kiểm thử logic lưu trữ trên đĩa: node scripts/test-library.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../lib/library');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfhub-test-'));
  const pdf = Buffer.from('%PDF-1.4\n%test\n');
  const on = (...p) => path.join(root, ...p);

  let lib = await Library.open(root);
  assert.deepStrictEqual(lib.categories, ['Công việc', 'Học tập', 'Hóa đơn', 'Cá nhân', 'Khác']);
  assert(fs.existsSync(on('Công việc')), 'thư mục phân loại được tạo');

  // Lưu file thật vào ổ đĩa, trùng tên thì tự đánh số
  const a = await lib.addFile({ name: 'bao cao.pdf', data: pdf, category: 'Công việc', pageCount: 3 });
  const b = await lib.addFile({ name: 'bao cao.pdf', data: pdf, category: 'Công việc', pageCount: 3 });
  assert.strictEqual(a.name, 'bao cao.pdf');
  assert.strictEqual(b.name, 'bao cao (1).pdf');
  assert(fs.readFileSync(on('Công việc', 'bao cao.pdf')).equals(pdf));

  // Tên nguy hiểm bị làm sạch, không thoát khỏi thư mục lưu trữ
  const c = await lib.addFile({ name: '../../evil:name?.pdf', data: pdf, category: 'Khác' });
  assert(path.resolve(lib.getAbsPath(c.id)).startsWith(root + path.sep));
  assert(!c.name.includes('/') && !c.name.includes(':'));

  // Ảnh xem trước: lưu, đọc lại, bị xóa cùng tài liệu
  assert.strictEqual(await lib.getThumb(a.id), null);
  await lib.setThumb(a.id, Buffer.from([0xff, 0xd8, 0xff]));
  assert((await lib.getThumb(a.id)).equals(Buffer.from([0xff, 0xd8, 0xff])));
  await assert.rejects(() => lib.getThumb('../../etc/passwd'), /Không tìm thấy/);

  // Phân loại: thêm / đổi tên / xóa
  await lib.addCategory('Hợp đồng');
  assert(fs.existsSync(on('Hợp đồng')));
  await assert.rejects(() => lib.addCategory('hợp đồng'), /đã tồn tại/);
  await lib.renameCategory('Công việc', 'Dự án');
  assert(fs.existsSync(on('Dự án', 'bao cao.pdf')));
  assert.strictEqual(lib.getFile(a.id).category, 'Dự án');
  assert.strictEqual(lib.getFile(a.id).relPath, 'Dự án/bao cao.pdf');

  // Thùng rác: chuyển vào, khôi phục, xóa vĩnh viễn
  await lib.trash(a.id);
  assert(!fs.existsSync(on('Dự án', 'bao cao.pdf')));
  assert(fs.existsSync(on('.thung-rac', a.id + '.pdf')));
  assert(lib.getFile(a.id).isTrash);
  await lib.restore(a.id);
  assert(fs.existsSync(on('Dự án', 'bao cao.pdf')));
  await lib.setThumb(b.id, Buffer.from([1, 2, 3]));
  await lib.trash(b.id);
  await lib.remove(b.id);
  assert(!fs.existsSync(on('.pdfhub', 'thumbs', b.id + '.jpg')), 'thumbnail bị xóa cùng tài liệu');
  assert(!fs.existsSync(on('.thung-rac', b.id + '.pdf')));
  assert.strictEqual(lib.files.some((f) => f.id === b.id), false);

  // Xóa phân loại: file chuyển sang phân loại còn lại
  await lib.deleteCategory('Dự án');
  const moved = lib.getFile(a.id);
  assert.notStrictEqual(moved.category, 'Dự án');
  assert(fs.existsSync(lib.getAbsPath(a.id)));
  assert(!fs.existsSync(on('Dự án')));

  // Mở lại thư viện: dữ liệu còn nguyên; PDF chép tay vào thư mục được nhận diện
  fs.writeFileSync(on('Học tập', 'tu-chep.pdf'), pdf);
  fs.rmSync(lib.getAbsPath(c.id)); // file bị xóa ngoài app -> tự loại khỏi danh sách
  lib = await Library.open(root);
  assert(lib.files.some((f) => f.id === a.id));
  assert(lib.files.some((f) => f.name === 'tu-chep.pdf' && f.category === 'Học tập'));
  assert.strictEqual(lib.files.some((f) => f.id === c.id), false);

  // Ảnh xem trước: lưu, đọc lại, bị xóa cùng file
  const t = await lib.addFile({ name: 'thumb.pdf', data: pdf, category: 'Khác' });
  assert.strictEqual(await lib.getThumb(t.id), null);
  await lib.setThumb(t.id, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.deepStrictEqual([...(await lib.getThumb(t.id))], [0xff, 0xd8, 0xff, 0xd9]);
  await assert.rejects(() => lib.setThumb('khong-ton-tai', Buffer.from([1])), /Không tìm thấy/);
  await lib.trash(t.id);
  await lib.remove(t.id);
  assert.strictEqual(fs.existsSync(on('.pdfhub', 'thumbs', t.id + '.jpg')), false);

  // Dọn thùng rác
  const d = await lib.addFile({ name: 'x.pdf', data: pdf, category: 'Khác' });
  await lib.setThumb(d.id, Buffer.from([1, 2, 3]));
  await lib.trash(d.id);
  await lib.emptyTrash();
  assert.strictEqual(fs.existsSync(on('.pdfhub', 'thumbs', d.id + '.jpg')), false);
  assert.strictEqual(lib.files.some((f) => f.isTrash), false);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('OK - tất cả kiểm thử đạt');
})().catch((e) => {
  console.error('LỖI:', e);
  process.exit(1);
});
