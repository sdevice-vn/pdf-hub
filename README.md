# PDF Hub (bản chạy trên PC)

Ứng dụng quản lý và đọc file PDF. File được lưu **trực tiếp thành file PDF thật** trong thư mục bạn chọn trên ổ đĩa.

## Cách lưu trữ
```
<Thư mục bạn chọn>/
├── Công việc/        <- mỗi phân loại là một thư mục con
│   └── bao-cao.pdf
├── Học tập/
├── .thung-rac/       <- file trong thùng rác
└── .pdfhub/library.json   <- ghi chú, số trang, danh sách phân loại
```
- Lần đầu mở app sẽ yêu cầu chọn thư mục lưu trữ; có thể đổi trong nút **Thư mục lưu trữ** trên thanh đầu.
- File PDF bạn tự chép vào các thư mục phân loại sẽ được app nhận diện ở lần mở sau.
- Đổi tên/xóa phân loại sẽ đổi tên/di chuyển thư mục tương ứng trên đĩa.

## Chạy thử (cần Node.js 18+)
```bash
npm install
npm start
```

## Đóng gói file cài đặt .exe (Windows)
```bash
npm run dist
```
Kết quả nằm trong thư mục `dist/` (bản cài đặt NSIS và bản portable).
Nếu không có máy Windows: đẩy dự án lên GitHub rồi chạy workflow **Build Windows app** (Actions), tải file .exe ở mục Artifacts.

## Kiểm thử logic lưu trữ
```bash
npm test
```
