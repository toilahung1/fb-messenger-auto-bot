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

## Chrome Extension (mới)
- [x] manifest.json v3 với quyền tabs, scripting, tabCapture, storage
- [x] background.js: kết nối WebSocket tới server, nhận lệnh từ website
- [x] content.js: inject vào tab Messenger, tự động gửi tin nhắn qua DOM
- [x] popup.html: hiển thị trạng thái kết nối, nút connect/disconnect
- [x] Tab capture: stream màn hình tab Messenger về server qua WebSocket
- [x] Đóng gói extension thành file .zip để cài đặt

## Backend WebSocket (mới)
- [x] Socket.IO server nhận stream frame từ extension
- [x] Relay stream frame tới website client
- [x] Nhận lệnh từ website, forward tới extension
- [x] Quản lý trạng thái kết nối extension (online/offline)

## Frontend Bot Control (mới)
- [x] Trang Bot Control với live screen stream (canvas/img)
- [x] Hiển thị trạng thái extension (connected/disconnected)
- [x] Nút Start/Stop bot, chọn chiến dịch để chạy
- [x] Hiển thị tiến độ real-time khi bot đang gửi
- [x] Hướng dẫn cài extension ngay trên trang

## Tự động lấy cookies Facebook (mới)
- [x] Backend: Puppeteer mở URL Facebook, chờ trang load, trích xuất cookies
- [x] Backend: tRPC procedure `botSession.extractCookies` nhận URL, trả về cookies
- [x] Frontend: Form nhập URL Facebook trong trang Cài đặt
- [x] Frontend: Nút "Ự động lấy cookies" với loading state và preview kết quả
- [x] Frontend: Hiển thị trạng thái tiến trình (đang mở trang, đang lấy cookies, hoàn thành)

## Chống Checkpoint Facebook (mới)
- [x] Anti-Checkpoint Engine: random delay, human-like typing, mouse movement simulation
- [x] Smart Rate Limiter: giới hạn số tin/giờ, nghỉ ngơi tự động theo session
- [x] Phát hiện checkpoint tự động: theo dõi URL, DOM alert, captcha detection
- [x] Xử lý checkpoint: tự động dừng campaign, thông báo người dùng
- [x] Warm-up mode: gửi từ từ tăng dần để tránh bị phát hiện tài khoản mới
- [x] Fingerprint protection: random viewport, user-agent rotation, timezone spoof
- [x] Session health monitor: kiểm tra định kỳ session còn sống không
- [x] Cấu hình bảo vệ trong UI: chọn mức độ an toàn (Thấp/Trung bình/Cao/Cực cao)
- [x] Hiển thị Risk Score và cảnh báo trước khi chạy campaign
- [x] Lịch sử checkpoint: ghi lại khi nào bị checkpoint, bao nhiêu tin đã gửi

## Sửa lỗi lấy cookies Facebook (bug fix)
- [x] Extension: thêm lệnh `get_cookies` - lấy cookies từ tab facebook.com/messenger.com đang mở
- [x] Extension: gửi cookies về server qua WebSocket socket event `cookies_result`
- [x] Backend: lắng nghe event `cookies_result` từ extension, lưu vào database
- [x] Backend: thêm tRPC procedure `botSession.requestCookiesFromExtension` 
- [x] Frontend Settings: thay nút "Tự động lấy cookies" bằng nút "Lấy từ Extension" (yêu cầu extension đang kết nối)
- [x] Frontend Settings: hiển thị hướng dẫn rõ ràng: cần cài extension và mở tab Facebook trước
- [x] Đóng gói lại extension .zip với tính năng mới

## Sửa lỗi popup extension mất thông tin (bug fix)
- [x] popup.js: lưu serverUrl và token vào chrome.storage.local ngay khi người dùng gõ (oninput)
- [x] popup.js: tự động load lại thông tin từ storage khi popup mở
- [x] popup.js: hiển thị trạng thái kết nối ngay khi mở (đã kết nối / chưa kết nối)
- [x] Đóng gói lại extension .zip và upload CDN

## Bỏ Extension - Tích hợp hết vào Website
- [ ] Puppeteer Screen Stream Service: chụp screenshot liên tục (5fps), gửi qua Socket.IO
- [ ] Trang "Đăng nhập Facebook": hiển thị live view Puppeteer, người dùng đăng nhập thật
- [ ] Phát hiện đăng nhập thành công, tự động lưu cookies vào database
- [ ] Cập nhật Bot Control: hiển thị stream màn hình Puppeteer real-time
- [ ] Xóa toàn bộ code liên quan đến extension (ws.service extension token, BotControl extension UI)
- [ ] Cập nhật Settings: bỏ tab extension, chỉ giữ đăng nhập qua Puppeteer và dán thủ công
- [ ] Kiểm tra toàn bộ luồng end-to-end
- [ ] Tạo checkpoint và xuất bản website
