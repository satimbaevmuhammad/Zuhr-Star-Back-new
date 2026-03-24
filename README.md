# BackZuhr — Backend API Documentation

> Express.js + MongoDB ta'lim markazi boshqaruv tizimi
> Deployed: https://zuhr-star-back-new-production.up.railway.app
> Local port: `3000`

---

## Texnologiyalar

| Texnologiya | Versiya | Maqsad |
|---|---|---|
| Express.js | v5.2.1 | Asosiy framework |
| MongoDB + Mongoose | v9.1.5 | Ma'lumotlar bazasi |
| JWT (jsonwebtoken) | v9.0.3 | Access + Refresh tokenlar |
| bcrypt | v6.0.0 | Parolni shifrlash (12 round) |
| Multer | v2.0.2 | Fayl yuklash |
| Swagger/OpenAPI | 3.0.3 | API dokumentatsiya |
| Firebase Admin SDK | v13.6.1 | O'rnatilgan (hozircha ishlatilmagan) |

---

## Loyiha strukturasi

```
BackZuhr/
├── app.js                          # Express app konfiguratsiyasi
├── index.js                        # Server ishga tushirish
├── package.json
├── .env                            # Muhit o'zgaruvchilari
│
├── src/
│   ├── config/
│   │   ├── db.js                   # MongoDB ulanish
│   │   └── swagger.js              # OpenAPI spesifikatsiya
│   │
│   ├── middleware/
│   │   ├── auth.middleware.js      # JWT, rol asosida ruxsat
│   │   └── upload.middleware.js    # Multer fayl yuklash
│   │
│   ├── model/
│   │   ├── user.model.js           # O'qituvchi/admin modeli
│   │   ├── student.model.js        # Talaba modeli
│   │   ├── group.model.js          # Guruh modeli
│   │   ├── course.model.js         # Kurs modeli
│   │   ├── lesson.model.js         # Dars modeli
│   │   ├── homework-submission.model.js  # Uyga vazifa topshirish
│   │   └── finance.model.js        # Moliya (hozircha bo'sh)
│   │
│   ├── controllers/
│   │   ├── auth.controller.js      # Autentifikatsiya, Face ID
│   │   ├── student.controller.js   # Talaba CRUD
│   │   ├── group.controller.js     # Guruh CRUD, davomat
│   │   ├── course.controller.js    # Kurs, dars
│   │   └── homework.controller.js  # Uyga vazifa
│   │
│   ├── routes/
│   │   ├── auth.routes.js          # /api/auth/*
│   │   ├── student.routes.js       # /api/students/*
│   │   ├── group.routes.js         # /api/groups/*
│   │   ├── course.routes.js        # /api/courses/*
│   │   └── homework.routes.js      # /api/homework/*
│   │
│   ├── services/
│   │   ├── course-sync.service.js          # Kurs guruh sonini sinxronlash
│   │   └── student-balance-reset.service.js # Talaba balansini reset qilish
│   │
│   └── utils/
│       ├── token.js                # JWT yaratish/tekshirish
│       └── public-url.js           # URL yasash yordamchisi
│
├── scripts/
│   ├── smoke.test.js               # Asosiy testlar
│   └── senior.test.js              # Kengaytirilgan testlar (31 ta)
│
└── uploads/                        # Fayllar saqlanadigan joy
```

---

## Muhit o'zgaruvchilari (.env)

```env
# Ma'lumotlar bazasi
MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/database

# JWT
JWT_SECRET=<secret-kalit>
JWT_ACCESS_SECRET=<ixtiyoriy>
JWT_REFRESH_SECRET=<ixtiyoriy>

# Server
PORT=3000

# CORS
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com

# Face ID
FACE_MATCH_THRESHOLD=0.45           # Masofa chegarasi
FACE_LOGIN_MAX_CANDIDATES=2000      # Qidiruvdagi max foydalanuvchi

# Balans reset
STUDENT_BALANCE_RESET_INTERVAL_MS=3600000    # 1 soat
STUDENT_BALANCE_RESET_MIN_GAP_MS=300000      # 5 daqiqa

# Fayl URL
PUBLIC_BASE_URL=https://yourdomain.com
BASE_URL=https://yourdomain.com
```

---

## Rollar va ruxsatlar

| Rol | Ruxsatlar |
|---|---|
| `superadmin` | Hammasi (`*`) |
| `admin` | Foydalanuvchi, talaba, guruh boshqaruvi |
| `headteacher` | Talaba/guruh boshqaruvi, o'qituvchi qo'shish |
| `supportteacher` | Talaba/guruh faqat ko'rish |
| `teacher` | Faqat profil va asosiy ko'rish |

---

## Token tizimi

- **Access token**: 5 soat amal qiladi
- **Refresh token**: 7 kun amal qiladi
- **Bearer** formatida yuboriladi: `Authorization: Bearer <token>`
- Logout qilganda refresh token o'chiriladi

---

## API Endpointlar

### Auth — `/api/auth`

| Method | Endpoint | Rol | Tavsif |
|---|---|---|---|
| POST | `/register` | superadmin | Yangi foydalanuvchi ro'yxatdan o'tkazish |
| POST | `/login` | — | Email/telefon + parol bilan kirish |
| POST | `/refresh` | — | Access tokenni yangilash |
| POST | `/logout` | auth | Chiqish |
| GET | `/me` | auth | O'z profilini olish |
| GET | `/users` | admin+ | Barcha foydalanuvchilar ro'yxati |
| POST | `/face-id/register` | auth | Face ID ro'yxatdan o'tkazish |
| POST | `/face-id/login` | — | Face ID bilan kirish |
| DELETE | `/face-id/remove` | auth | Face ID o'chirish |
| PATCH | `/users/:id/role` | superadmin | Foydalanuvchi rolini o'zgartirish |

#### Login so'rovi
```json
{
  "login": "email@example.com",  // yoki telefon
  "password": "password123"
}
```

#### Register so'rovi
```json
{
  "fullName": "Ism Familiya",
  "phone": "+998901234567",
  "email": "email@example.com",
  "password": "password123",
  "role": "teacher",
  "dateOfBirth": "1990-01-01",
  "gender": "male"
}
```

---

### Talabalar — `/api/students`

| Method | Endpoint | Rol | Tavsif |
|---|---|---|---|
| POST | `/` | admin+ | Yangi talaba qo'shish |
| GET | `/` | auth | Talabalar ro'yxati (pagination + qidiruv) |
| GET | `/:id` | auth | Bitta talaba |
| PATCH | `/:id` | admin+ | Talabani tahrirlash |
| DELETE | `/:id` | admin+ | Talabani o'chirish |
| POST | `/login` | — | Talaba kirishi |
| POST | `/:id/coins` | admin+ | Coin mukofot berish |
| GET | `/:id/groups` | auth | Talabaning guruhlari |
| POST | `/:id/groups` | admin+ | Talabani guruhga qo'shish |
| DELETE | `/:id/groups/:groupId` | admin+ | Talabani guruhdan chiqarish |

#### Talaba yaratish so'rovi
```json
{
  "fullName": "Talaba Ismi",
  "studentPhone": "+998901234567",
  "parentPhone": "+998901234568",
  "birthDate": "2005-05-15",
  "gender": "male"
}
```

#### Talaba modeli maydonlari
| Maydon | Tur | Tavsif |
|---|---|---|
| `fullName` | String | To'liq ism (required) |
| `studentPhone` | String | Talaba telefoni (unique) |
| `parentPhone` | String | Ota-ona telefoni |
| `birthDate` | Date | Tug'ilgan sana |
| `gender` | String | `male` / `female` |
| `balance` | Number | Balans (30 kunda reset) |
| `coins` | Number | Coin mukofotlar |
| `groupAttachments` | Array | Guruhlarga birikish holati |
| `groupAttached` | Boolean | Hozir aktiv guruhda bormi |

#### `groupAttachments` massivining har bir elementi
```json
{
  "group": "GroupId",
  "status": "active",   // active | paused | completed | left
  "joinedAt": "2024-01-01",
  "leftAt": null
}
```

---

### Guruhlar — `/api/groups`

| Method | Endpoint | Rol | Tavsif |
|---|---|---|---|
| POST | `/` | admin+ | Yangi guruh yaratish |
| GET | `/` | auth | Guruhlar ro'yxati |
| GET | `/:id` | auth | Bitta guruh |
| PATCH | `/:id` | admin+ | Guruhni tahrirlash |
| DELETE | `/:id` | admin+ | Guruhni o'chirish |
| POST | `/:id/students` | admin+ | Guruhga talaba qo'shish |
| DELETE | `/:id/students/:studentId` | admin+ | Guruhdan talabani chiqarish |
| PATCH | `/:id/attendance` | teacher+ | Davomat yangilash (bulk) |
| PATCH | `/:id/attendance/:studentId` | teacher+ | Bitta talaba davomati |

#### Guruh yaratish so'rovi
```json
{
  "name": "Guruh nomi",
  "course": "CourseId",
  "groupType": "odd",
  "teacher": "TeacherId",
  "supportTeachers": ["TeacherId2"],
  "startDate": "2024-01-01",
  "monthlyFee": 500000,
  "schedule": [
    { "day": "monday", "time": "09:00", "duration": 90 },
    { "day": "wednesday", "time": "09:00", "duration": 90 },
    { "day": "friday", "time": "09:00", "duration": 90 }
  ]
}
```

#### Guruh turlari
| tur | Kunlar |
|---|---|
| `odd` | Dushanba, Chorshanba, Juma |
| `even` | Seshanba, Payshanba, Shanba |

#### Guruh holatlari
`planned` → `active` → `paused` → `completed` → `archived`

#### Davomat so'rovi (bulk)
```json
{
  "date": "2024-01-15",
  "attendance": [
    { "student": "StudentId", "present": true },
    { "student": "StudentId2", "present": false }
  ]
}
```

---

### Kurslar — `/api/courses`

| Method | Endpoint | Rol | Tavsif |
|---|---|---|---|
| POST | `/` | admin+ | Yangi kurs yaratish |
| GET | `/` | auth | Kurslar ro'yxati |
| GET | `/:id` | auth | Bitta kurs |
| PATCH | `/:id` | admin+ | Kursni tahrirlash |
| DELETE | `/:id` | admin+ | Kursni o'chirish |
| POST | `/:courseId/lessons` | admin+ | Kursga dars qo'shish |
| GET | `/:courseId/lessons` | auth | Kurs darslari |
| GET | `/:courseId/lessons/:lessonId` | auth | Bitta dars |
| PATCH | `/:courseId/lessons/:lessonId` | admin+ | Darsni tahrirlash |
| DELETE | `/:courseId/lessons/:lessonId` | admin+ | Darsni o'chirish |
| POST | `/:courseId/lessons/:lessonId/documents` | admin+ | Darsga hujjat yuklash |
| DELETE | `/:courseId/lessons/:lessonId/documents/:docId` | admin+ | Hujjatni o'chirish |

#### Kurs yaratish so'rovi
```json
{
  "name": "Kurs nomi",
  "durationMonths": 6,
  "price": 600000
}
```

> **Muhim**: Kurs dars soni `durationMonths * 12` dan oshmasligi kerak.

#### Dars yaratish so'rovi
```json
{
  "title": "Dars mavzusi",
  "duration": 90,
  "description": "Dars tavsifi",
  "homeworkDescription": "Uyga vazifa tavsifi",
  "homeworkLinks": ["https://link.com"]
}
```

> **Muhim**: `order` (tartib) avtomatik belgilanadi, qo'lda kiritilsa e'tiborga olinmaydi.

#### Kurs modeli maydonlari
| Maydon | Tur | Tavsif |
|---|---|---|
| `name` | String | Kurs nomi (unique) |
| `durationMonths` | Number | Davomiyligi (oy) |
| `price` | Number | Narxi |
| `methodology` | Array | Darslar ID ro'yxati |
| `groupsCount` | Number | Avtomatik hisoblanadi |

---

### Uyga vazifa — `/api/homework`

| Method | Endpoint | Rol | Tavsif |
|---|---|---|---|
| POST | `/` | student | Vazifa topshirish |
| GET | `/` | teacher+ | Barcha topshirilgan vazifalar |
| GET | `/:id` | auth | Bitta vazifa |
| PATCH | `/:id/grade` | teacher+ | Bahо qo'yish |
| GET | `/student/:studentId` | auth | Talabaning vazifalari |

#### Vazifa topshirish so'rovi
```json
{
  "lesson": "LessonId",
  "group": "GroupId",
  "description": "Vazifa tavsifi",
  "links": ["https://github.com/..."]
}
```

#### Baho qo'yish so'rovi
```json
{
  "score": 85,
  "status": "approved"
}
```

#### Vazifa holatlari
- `submitted` — topshirildi
- `approved` — tasdiqlandi

---

## Fayl yuklash

### Fayl turlari va chegaralar

| Tur | Max hajm | Ruxsat etilgan formatlar |
|---|---|---|
| Avatar | 2 MB | jpg, jpeg, png, gif, webp |
| Dars hujjati | 25 MB | pdf, doc, docx, ppt, pptx, xls, xlsx, txt, zip, rar, mp4, mp3 |
| Uyga vazifa | 25 MB | yuqoridagi formatlar |

### Fayllar URL formati
```
https://yourdomain.com/uploads/<filename>
```

---

## Tizim endpointlari

| Endpoint | Tavsif |
|---|---|
| `GET /health` | Server holati tekshirish |
| `GET /api-docs` | Swagger UI |
| `GET /api-docs-json` | OpenAPI JSON |
| `GET /face-id-demo` | Face ID test sahifasi |
| `GET /uploads/:file` | Yuklangan fayllar |

---

## Face ID tizimi

- **128 o'lchovli descriptor** ishlatiladi
- **Evklid masofasi** bilan taqqoslanadi
- Chegara (threshold): `0.45` (sozlanadi `FACE_MATCH_THRESHOLD` orqali)
- Eng yaqin descriptor topilsa, token qaytariladi

#### Face ID ro'yxatdan o'tkazish
```json
{
  "descriptor": [0.1, 0.2, ..., 0.5]   // 128 ta son
}
```

---

## Servislar

### Student Balance Reset Service
- Har 30 kunda talaba balansi avtomatik `0` ga qaytadi
- `STUDENT_BALANCE_RESET_INTERVAL_MS` orqali interval sozlanadi
- Ketma-ket chaqiruvlar o'rtasida `STUDENT_BALANCE_RESET_MIN_GAP_MS` vaqt bo'lishi kerak (throttle)

### Course Sync Service
- Kursga bog'liq guruhlar soni o'zgarganda `groupsCount` yangilanadi
- Guruh qo'shilganda/o'chirilganda avtomatik ishga tushadi

---

## Testlar

```bash
npm test
```

- `scripts/smoke.test.js` — asosiy sintaksis va integratsiya testlari
- `scripts/senior.test.js` — kengaytirilgan domenli testlar (**31 ta test**)

### Test natijalari (barcha o'tadi)
- Token yaratish va tekshirish
- Ruxsatlar middleware
- Face ID ro'yxatdan o'tish va kirish
- Talaba yaratish va coin berish
- Davomat tekshirish
- Guruh jadvali validatsiyasi
- Kurs dars limiti tekshirish
- Dars tartib (order) avtomatik belgilash
- Hujjat yuklash va o'chirish
- Kurs sinxronizatsiya
- Balans reset throttle

---

## Ishga tushirish

```bash
# O'rnatish
npm install

# Development (nodemon bilan)
npm run dev

# Production
npm start

# Testlar
npm test
```

---

## Ma'lumotlar bazasi indekslari

| Kolleksiya | Indeks |
|---|---|
| `users` | `phone` (unique), `email` (unique) |
| `students` | `studentPhone` (unique) |
| `groups` | `name + startDate` (unique) |
| `lessons` | `course` (indexed), `course + order` (unique) |
| `homeworksubmissions` | `lesson + student` (unique) |

---

## Qo'shimcha eslatmalar

1. `validateBeforeSave: false` — auth controllerda refresh token saqlashda ishlatiladi (6 joyda)
2. Davomat faqat **bugun** uchun belgilanishi mumkin, kelajak sana rad etiladi
3. Guruh talabalar soni: **1–100** oralig'ida
4. Kurs nomi **unique** bo'lishi kerak
5. Dars `order` maydoni har doim ketma-ket son oladi (1, 2, 3...) — qo'lda o'zgartirish mumkin emas
