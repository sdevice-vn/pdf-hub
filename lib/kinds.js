'use strict';
/**
 * Nhận diện loại tệp theo đuôi file (không phụ thuộc Electron).
 * kind: pdf | image | video | audio | text | office | archive | other
 */
const GROUPS = {
  pdf: ['pdf'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ogv'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus', 'wma'],
  text: [
    'txt', 'md', 'markdown', 'log', 'json', 'csv', 'tsv', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'conf',
    'toml', 'properties', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'c', 'h', 'cpp',
    'hpp', 'cc', 'ino', 'java', 'kt', 'kts', 'gradle', 'go', 'rs', 'sh', 'bat', 'cmd', 'ps1', 'sql',
    'php', 'rb', 'lua', 'tex', 'srt', 'vtt'
  ],
  office: [
    'doc', 'docx', 'dot', 'dotx', 'odt', 'rtf', 'xls', 'xlsx', 'xlsm', 'ods', 'ppt', 'pptx', 'pps',
    'ppsx', 'odp', 'pages', 'numbers', 'key'
  ],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'iso']
};

const KIND_BY_EXT = {};
for (const [kind, exts] of Object.entries(GROUPS)) for (const e of exts) KIND_BY_EXT[e] = kind;

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', '3gp': 'video/3gpp', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4',
  flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/ogg', wma: 'audio/x-ms-wma'
};

// Tệp thực thi / script: không bao giờ được mở trực tiếp bằng ứng dụng mặc định của hệ điều hành
const RISKY = new Set([
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'hta', 'jar', 'lnk', 'reg', 'cpl', 'dll', 'sys', 'appx', 'msix', 'application', 'gadget'
]);

function extOf(name) {
  const base = String(name || '');
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

const kindOf = (name) => KIND_BY_EXT[extOf(name)] || 'other';
const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
const isRisky = (name) => RISKY.has(extOf(name));

module.exports = { kindOf, mimeOf, isRisky, extOf, GROUPS };
