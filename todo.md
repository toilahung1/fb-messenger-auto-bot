# Facebook Messenger Auto Bot - TODO

## Database & Schema
- [x] Bảng campaigns (chiến dịch gửi tin nhắn)
- [x] Bảng recipients (người nhận)
- [x] Bảng message_logs (lịch sử gửi tin nhắn)
- [x] Bảng bot_sessions (phiên đăng nhập Facebook)
- [x] Push migration lên database

## Backend API
- [x] CRUD campaigns (tạo, sửa, xóa, lấy danh sách chiến dịch)
- [x] CRUD recipients (thêm, xóa, import CSV)
- [x] Puppeteer automation service (gửi tin nhắn qua DOM)
- [x] Bot control: start/stop campaign
- [x] Retry logic khi gửi thất bại
- [x] Quản lý delay giữa các tin nhắn
- [x] Xử lý biến động trong nội dung tin nhắn (tên, thời gian)
- [x] Upload CSV lên S3 và parse danh sách người nhận
- [x] Lưu logs chiến dịch lên S3
- [x] Thông báo in-app khi hoàn thành/lỗi

## Frontend
- [x] Dashboard tổng quan (thống kê, biểu đồ)
- [x] Trang quản lý chiến dịch (danh sách, tạo mới, chi tiết)
- [x] Trang quản lý người nhận (thêm thủ công, import CSV)
- [x] Cấu hình nội dung tin nhắn với preview biến động
- [x] Điều khiển bot (nút Start/Stop, trạng thái real-time)
- [x] Lịch sử gửi tin nhắn (bảng chi tiết, filter, export)
- [x] Cài đặt: delay, retry, Facebook session
- [x] Thông báo in-app (bell icon, danh sách thông báo)
- [x] Responsive design

## Tích hợp
- [x] S3: upload CSV import
- [x] S3: lưu logs chiến dịch
- [x] Puppeteer: đăng nhập Facebook
- [x] Puppeteer: tìm kiếm và gửi tin nhắn Messenger
- [x] Puppeteer: xử lý lỗi và retry

## Tests
- [x] Test API campaigns
- [x] Test API recipients
- [x] Test bot control logic
- [x] Test import CSV
