// Sao chép thư viện (PDF.js, FontAwesome) từ node_modules vào src/vendor để app chạy offline.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const vendor = path.join(root, 'src', 'vendor');

fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(path.join(vendor, 'fontawesome', 'css'), { recursive: true });

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
console.log('Đã chuẩn bị xong thư viện trong src/vendor');
