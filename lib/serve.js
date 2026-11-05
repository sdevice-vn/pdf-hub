'use strict';

/**
 * Phân tích header "Range" của HTTP để phát video/âm thanh theo từng đoạn.
 * Trả về:
 *   null              -> không có Range (hoặc không hỗ trợ): gửi toàn bộ tệp
 *   { invalid: true } -> Range nằm ngoài tệp (HTTP 416)
 *   { start, end }    -> khoảng byte (đã bao gồm hai đầu)
 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;

  let start;
  let end;
  if (m[1] === '') {
    const n = parseInt(m[2], 10); // "-500": 500 byte cuối
    if (!n || size === 0) return { invalid: true };
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (start >= size || start > end) return { invalid: true };
  return { start, end };
}

module.exports = { parseRange };
