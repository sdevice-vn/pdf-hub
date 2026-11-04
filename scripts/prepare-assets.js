// Sao chép thư viện (PDF.js, FontAwesome, font Be Vietnam Pro) từ node_modules vào src/vendor để app chạy offline.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const vendor = path.join(root, 'src', 'vendor');

fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(path.join(vendor, 'fontawesome', 'css'), { recursive: true });
fs.mkdirSync(path.join(vendor, 'fonts', 'files'), { recursive: true });

fs.copyFileSync(nm('pdfjs-dist', 'build', 'pdf.min.js'), path.join(vendor, 'pdf.min.js'));
fs.copyFileSync(nm('pdfjs-dist', 'build', 'pdf.worker.min.js'), path.join(vendor, 'pdf.worker.min.js'));
fs.copyFileSync(
  nm('@fortawesome', 'fontawesome-free', 'css', 'all.min.css'),
  path.join(vendor, 'fontawesome', 'css', 'all.min.css')
);
fs.cpSync(
  nm('@fortawesome', 'fontawesome-free', 'webfonts'),
  path.join(vendor, 'fontawesome', 'webfonts'),
  { recursive: true }
);

// Font Be Vietnam Pro: chỉ lấy các độ đậm 400/500/600/700 (kiểu thường)
const fontDir = nm('@fontsource', 'be-vietnam-pro');
for (const w of [400, 500, 600, 700]) {
  fs.copyFileSync(path.join(fontDir, `${w}.css`), path.join(vendor, 'fonts', `${w}.css`));
}
for (const f of fs.readdirSync(path.join(fontDir, 'files'))) {
  if (/-(400|500|600|700)-normal\.(woff2?)$/.test(f)) {
    fs.copyFileSync(path.join(fontDir, 'files', f), path.join(vendor, 'fonts', 'files', f));
  }
}
// Phông chữ Be Vietnam Pro (thiết kế cho tiếng Việt), chỉ lấy các cỡ chữ đang dùng
const fontSrc = nm('@fontsource', 'be-vietnam-pro');
const fontDst = path.join(vendor, 'fonts');
fs.mkdirSync(path.join(fontDst, 'files'), { recursive: true });
for (const w of [400, 500, 600, 700]) {
  fs.copyFileSync(path.join(fontSrc, `${w}.css`), path.join(fontDst, `${w}.css`));
  for (const subset of ['latin', 'latin-ext', 'vietnamese']) {
    const name = `be-vietnam-pro-${subset}-${w}-normal.woff2`;
    fs.copyFileSync(path.join(fontSrc, 'files', name), path.join(fontDst, 'files', name));
  }
}
console.log('Đã chuẩn bị xong thư viện trong src/vendor');
