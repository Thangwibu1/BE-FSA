# Movie Theater API — Fastify + MongoDB

Backend cho ứng dụng Movie Theater Android, gồm 12 resource dữ liệu, xác thực bằng access token, phân quyền và các endpoint nghiệp vụ đặt/bán/đổi/check-in vé.

## Chạy local

Yêu cầu Node.js 18+ và MongoDB 7+.

```powershell
Copy-Item .env.example .env
npm install
npm run db:setup
npm run dev
```

- API: `http://localhost:5550`
- Swagger UI: `http://localhost:5550/api-docs`
- Health check: `http://localhost:5550/health`
- Android emulator base URL: `http://10.0.2.2:5550/`

Hoặc chạy cả API và MongoDB bằng Docker. Trước lần deploy đầu tiên, tạo file
môi trường riêng và thay mật khẩu/secret mẫu:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up --build -d
```

Compose sẽ tự chờ MongoDB khỏe, chạy migration + seed an toàn (`--if-empty`),
sau đó khởi động API ở port `5550`. Dữ liệu MongoDB và ảnh upload được lưu bằng
named volumes nên không mất khi container được tạo lại.

Kiểm tra trạng thái và log:

```bash
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f api
curl http://localhost:5550/health
```

Dừng service mà vẫn giữ dữ liệu:

```bash
docker compose --env-file .env.docker down
```

Chỉ dùng `docker compose down -v` khi thực sự muốn xóa toàn bộ database và ảnh upload.

## CI/CD với GitHub Actions, GHCR và Coolify

Workflow tại `.github/workflows/backend-ci-cd.yml` thực hiện:

1. Mọi pull request hoặc push vào `main`: cài dependency từ lockfile, kiểm tra cú pháp, chạy toàn bộ test và xác minh Docker image build được.
2. Chỉ khi push/merge vào `main`: build image `linux/amd64` và push lên GHCR với hai tag `latest` và `sha-<commit>`.
3. Khi push image thành công: gọi deployment webhook của Coolify.

Tạo GitHub Environment tên `production`, sau đó thêm hai Environment secrets:

| Secret | Nội dung |
|---|---|
| `COOLIFY_WEBHOOK_URL` | Deploy webhook hoặc API deploy URL của resource trên Coolify |
| `COOLIFY_TOKEN` | Coolify API token có quyền deploy resource đó |

`GITHUB_TOKEN` được GitHub cấp tự động và workflow chỉ mở quyền `packages: write`
cho job push image. Image thực tế được chuẩn hóa chữ thường, ví dụ:
`ghcr.io/thangwibu1/be-fsa:latest`.

Trên Coolify, cấu hình resource dùng image GHCR tag `latest` và expose port `5550`.
Nếu package GHCR để private, cần thêm GHCR registry credential/PAT có quyền `read:packages`
vào Coolify; nếu package public thì không cần credential này.

## Xác thực và quyền

- `POST /register`: đăng ký MEMBER.
- `POST /login`: trả cặp `accessToken`/`refreshToken`, thời hạn token, account đã loại bỏ password và member profile.
- `GET /auth/me`: kiểm tra phiên và trả account/profile hiện tại.
- `POST /auth/refresh`: làm mới cặp access/refresh token.
- `POST /auth/logout`: thu hồi token của tài khoản trên server.
- Các route cần đăng nhập nhận header `Authorization: Bearer <accessToken>`.
- `PATCH /me/profile`: cập nhật hồ sơ của tài khoản hiện tại.
- `POST /auth/change-password`: đổi mật khẩu sau khi xác minh mật khẩu hiện tại.
- Đọc phim, suất chiếu, ghế, phòng và khuyến mãi là public để Guest xem lịch/giá.
- Thêm/sửa/xóa resource quản trị yêu cầu ADMIN.
- MEMBER chỉ đọc được account, profile, booking và lịch sử điểm của chính mình.

Mật khẩu mới được băm bằng `scrypt` và salt. Tài khoản seed cũ còn plain text sẽ tự được nâng cấp sang hash sau lần đăng nhập hợp lệ đầu tiên. Password/hash không được trả về client.

## Endpoint nghiệp vụ

| Method | URL | Role | Ý nghĩa |
|---|---|---|---|
| `POST` | `/bookings` | MEMBER | Đặt vé online |
| `POST` | `/counter-sales` | EMPLOYEE, ADMIN | Bán vé tại quầy |
| `POST` | `/bookings/:id/convert` | EMPLOYEE, ADMIN | Chuyển booking thành ticket, tùy chọn dùng điểm |
| `POST` | `/tickets/:id/check-in` | EMPLOYEE, ADMIN | Check-in vé |

Server tự xác minh showtime/ghế, tính giá/khuyến mãi/điểm, giữ ghế có điều kiện và tạo booking, booking seat, ticket cùng point history. Client không được tự quyết định tổng tiền hoặc số dư điểm.

Ví dụ request đặt vé:

```json
{
  "showtimeId": "show_001",
  "showtimeSeatIds": ["sh_st_00001", "sh_st_00002"],
  "promotionCode": "SVDAY",
  "convertedTicketQuantity": 1
}
```

## CRUD và query

Các resource `ACCOUNT`, `MEMBER_PROFILE`, `CINEMA_ROOM`, `SEAT`, `MOVIE`, `SHOWTIME`, `SHOWTIME_SEAT`, `PROMOTION`, `BOOKING`, `BOOKING_SEAT`, `TICKET`, `POINT_HISTORY` hỗ trợ list/create/read/replace/patch/delete theo quyền.

Query hỗ trợ filter, `_gt/_gte/_lt/_lte/_ne`, `q`, `_sort`, `_start/_end/_limit` và `_page/_per_page`.

## Upload ảnh

ADMIN có thể gửi ảnh JPEG, PNG, WEBP hoặc GIF tới `POST /uploads/images` bằng multipart field `file`. API giới hạn 5 MB và trả URL công khai dưới `/uploads/...`; Android dùng endpoint này cho ảnh phim, nhân viên và khuyến mãi.

## Migration, seed và test

| Lệnh | Tác dụng |
|---|---|
| `npm run migrate` | Chạy migration còn thiếu |
| `npm run seed` | Seed các collection rỗng |
| `npm run seed:fresh` | Xóa, seed lại 12 collection và sinh lịch chiếu mới |
| `npm run seed:showtimes -- --dry-run` | Kiểm tra trước lịch 30 ngày mà không ghi dữ liệu |
| `npm run seed:showtimes` | Thay toàn bộ lịch bằng 5 suất/phim/ngày trong 30 ngày |
| `npm test` | Chạy test local/in-memory MongoDB |
| `npm run test:remote` | Test MongoDB được cấu hình khi bật biến môi trường tương ứng |

Kết quả kiểm thử gần nhất: 31 pass, 0 fail.

Lệnh `seed:showtimes` đọc toàn bộ phim và các phòng `ACTIVE` đang có, xếp lịch từ ngày kế tiếp, chừa 20 phút giữa hai suất và kiểm tra không trùng phòng/giờ trước khi ghi. Dữ liệu lịch cũ và các booking phụ thuộc được sao lưu vào `backups/showtime-reset-*.json`; nếu ghi lỗi, script tự khôi phục bản sao lưu.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `5550` | Cổng API trong container |
| `HOST` | `0.0.0.0` | Host lắng nghe |
| `MONGODB_URI` | local MongoDB | Connection string |
| `MONGODB_DB_NAME` | lấy từ URI | Ghi đè tên database |
| `RUN_MIGRATIONS` | `true` | Tự chạy migration khi start |
| `CORS_ORIGIN` | `*` | Origin hoặc danh sách origin |
| `LOG_LEVEL` | `info` | Mức log |
| `AUTH_TOKEN_SECRET` | development only | Khóa ký token; bắt buộc thay ở production |
| `AUTH_TOKEN_LIFETIME_SECONDS` | `28800` | Thời hạn token, giây |
| `AUTH_REFRESH_TOKEN_LIFETIME_SECONDS` | `2592000` | Thời hạn refresh token, giây |
| `UPLOAD_DIR` | `./uploads` | Thư mục lưu ảnh upload |
| `MAX_IMAGE_UPLOAD_BYTES` | `5242880` | Kích thước ảnh tối đa (5 MB) |

Production phải dùng HTTPS, secret riêng và MongoDB replica set nếu muốn nâng cơ chế bù trừ booking hiện tại lên multi-document transaction.
