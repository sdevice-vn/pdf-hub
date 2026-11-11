# Documents Hub

Ứng dụng Windows quản lý và xem tài liệu. Nhận **mọi định dạng tệp**; tệp được lưu thành tệp thật trong thư mục bạn chọn.

## Xem trực tiếp trong app
| Loại | Định dạng |
|---|---|
| PDF | pdf |
| Hình ảnh | png, jpg, gif, webp, bmp, svg, avif… |
| Video | mp4 (H.264), webm, mov, m4v, ogv… (có tua) |
| Âm thanh | mp3, wav, ogg, m4a, flac, aac, opus |
| Văn bản / mã nguồn | txt, md, json, csv, log, ino, c, py, js… |
| Khác (docx, xlsx, zip, mkv, avi…) | lưu trữ, xem ảnh biểu tượng; mở bằng ứng dụng mặc định của máy |

Vì lý do an toàn, app không chạy trực tiếp tệp thực thi/script (exe, bat, msi, ps1…); các tệp này vẫn lưu và quản lý được.

## Cách lưu trữ
```
<Thư mục bạn chọn>/
├── Công việc/             <- mỗi phân loại là một thư mục con
├── Học tập/
├── .thung-rac/            <- thùng rác
└── .dochub/library.json   <- ghi chú, số trang, thời lượng, ảnh xem trước
```
- Đổi tên và chuyển phân loại: nút bút chì trên mỗi tệp (hoặc trong trình xem).
- Hộp thoại **Thêm tệp** có tùy chọn xóa tệp gốc sau khi chép xong (chuyển vào Thùng rác của Windows); kéo thả vào cửa sổ chính thì chỉ sao chép.
- Nút **Đổi thư mục**: chọn chuyển toàn bộ phân loại, tệp, thùng rác sang thư mục mới (cắt) hoặc chỉ mở thư mục mới.
- Thư viện PDF Hub cũ (`.pdfhub`) được tự động nhận lại.
- Tệp bạn tự chép vào thư mục phân loại sẽ được nhận diện ở lần mở sau.
- Thêm tệp bằng nút **Thêm tệp** hoặc kéo thả vào cửa sổ; tệp được chép thẳng từ ổ đĩa, không nạp cả vào bộ nhớ nên video lớn vẫn ổn.

## Chạy thử (Node.js 18+)
```bash
npm install
npm start
```

## Đóng gói .exe
```bash
npm run dist
```
Hoặc đẩy lên GitHub và chạy workflow **Build Windows app**, tải ở mục Artifacts (`Documents-Hub-windows`).

## Kiểm thử
```bash
npm test
```
