# BackZuhr — Backend API

REST API для CRM + LMS учебного центра. Node.js + Express + MongoDB.

---

## Содержание

1. [Технологии](#1-технологии)
2. [Быстрый старт](#2-быстрый-старт)
3. [Переменные окружения](#3-переменные-окружения)
4. [Архитектура проекта](#4-архитектура-проекта)
5. [API маршруты](#5-api-маршруты)
6. [Структура папок](#6-структура-папок)
7. [Ключевые решения](#7-ключевые-решения)

---

## 1. Технологии

| Пакет | Версия | Назначение |
|---|---|---|
| `express` | 5 | HTTP-фреймворк |
| `mongoose` | 9 | ODM для MongoDB |
| `jsonwebtoken` | — | JWT-токены |
| `bcrypt` | — | Хэширование паролей |
| `multer` | — | Загрузка файлов (аватары) |
| `cors` | — | CORS-политика |
| `swagger-jsdoc` + `swagger-ui-express` | — | Автодокументация API |
| `face-api.js` | — | Распознавание лиц (Face ID) |

---

## 2. Быстрый старт

```bash
npm install
cp .env.example .env   # заполни переменные
node index.js
```

Полезные URL после старта:
- `GET /health` — проверка работоспособности
- `GET /api-docs` — Swagger UI
- `GET /api-docs-json` — OpenAPI JSON

При первом подключении к MongoDB автоматически запускается `roles.seeder.js` — создаёт дефолтные роли с правами если они ещё не существуют.

---

## 3. Переменные окружения

```env
# База данных
MONGO_URI=mongodb://localhost:27017/backzuhr

# Сервер
PORT=3000

# JWT — нужен хотя бы один из вариантов
JWT_SECRET=your_secret_here
# Устаревшие алиасы (используются если JWT_SECRET не задан):
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

# CORS — список разрешённых origin через запятую. Пусто или * = разрешить всё.
CORS_ORIGINS=http://localhost:5173,https://app.school.uz

# Face ID
FACE_MATCH_THRESHOLD=0.45          # порог схожести (0–1, ниже = строже)
FACE_LOGIN_MAX_CANDIDATES=2000     # максимум кандидатов при поиске

# Автоматический сброс баланса студентов
STUDENT_BALANCE_RESET_INTERVAL_MS=3600000   # интервал проверки (1 час)
STUDENT_BALANCE_RESET_MIN_GAP_MS=300000     # минимальный промежуток между сбросами (5 мин)

# Публичный URL сервера (используется в ссылках на файлы)
PUBLIC_BASE_URL=https://your-domain.com
BASE_URL=https://your-domain.com
```

---

## 4. Архитектура проекта

### 4.1 Две отдельные сущности аккаунтов

В системе два типа пользователей с разными коллекциями и токенами:

| | Сотрудник (`User`) | Студент (`Student`) |
|---|---|---|
| Коллекция | `users` | `students` |
| Логин | `POST /api/auth/login` | `POST /api/students/login` |
| `userType` в JWT | `employee` | `student` |
| Refresh токен | Есть (7 дней) | Нет |
| Роли | teacher, supportTeacher, headteacher, admin, superadmin | Нет |

### 4.2 JWT

Алгоритм: `HS256`. Payload: `{ sub, role, userType, iat, exp }`.

| Токен | TTL |
|---|---|
| Access (сотрудник) | 24 часа |
| Refresh (сотрудник) | 7 дней |
| Access (студент) | 24 часа (без refresh) |

### 4.3 RBAC — роли и права

Роли и их permissions хранятся в MongoDB (коллекция `roles`), не в коде. Это позволяет менять права через API без деплоя.

- Инициализация: `src/seeders/roles.seeder.js` (запускается при каждом старте, идемпотентно)
- Кэш permissions в `auth.middleware.js`: TTL 60 секунд
- Суперадмин имеет право `*` (все права)

Middleware:
- `requireAuth` — проверяет employee токен, загружает `req.userDocument`
- `requireStudentAuth` — проверяет student токен, загружает `req.student`
- `allowRoles(...roles)` — разрешает только указанные роли
- `allowPermissions(...perms)` — проверяет наличие прав у роли (через кэш из БД)

### 4.4 Финансы — append-only ledger

Модель `FinancialEvent` (коллекция `financialevents`) хранит все финансовые события как неизменяемые записи. Mongoose middleware блокирует любые `update`/`delete` операции на уровне модели.

Типы событий: `salary_update`, `bonus`, `fine`.

Текущий баланс сотрудника = агрегация всех его событий (`finance.service.js`).

При удалении нарушения (`DELETE /api/forbidden/violations/:id`) автоматически создаётся компенсирующий `fine` с отрицательной суммой.

### 4.5 Face ID

Биометрические данные вынесены в отдельную коллекцию `FaceCredential` (не хранятся в `User`). Дескриптор лица зашифрован. Логин через лицо: `POST /api/auth/login/face`.

### 4.6 Доп. уроки (Extra Lessons) — система бронирования

Фиксированные слоты: 5 в день на учителя. Рабочее время 14:00–20:00 (UTC+5).
Слоты: 14:00 / 15:10 / 16:20 / 17:30 / 18:40 (60 мин урок + 10 мин отдых = 70 мин интервал).

Флаг `User.isExtraLessonSupport: true` отмечает учителей доп. уроков (независимо от их роли).

Статусы: `pending_approval` → `confirmed` → `completed`, или `pending_approval`/`confirmed` → `cancelled`.

### 4.7 Формат ошибок

Глобальный middleware (`errorHandler.js`) и нормализатор в `app.js` гарантируют единый формат:

```json
{
  "message": "Human readable description",
  "code": "SCREAMING_SNAKE_CASE_CODE",
  "field": null
}
```

### 4.8 Валидация ObjectId

`src/middleware/validateObjectId.js` — factory-middleware. Принимает список имён параметров и возвращает 400 `INVALID_OBJECT_ID` если хотя бы один не является валидным MongoDB ObjectId.

```js
validateObjectId('lessonId', 'studentId')
```

---

## 5. API маршруты

### Auth — `/api/auth`

```
POST   /api/auth/register                          — регистрация сотрудника (только superadmin)
POST   /api/auth/login                             — логин по паролю
POST   /api/auth/login/face                        — логин через Face ID
POST   /api/auth/face/enroll                       — добавить данные лица
DELETE /api/auth/face/revoke                       — удалить Face ID
POST   /api/auth/refresh-token                     — обновить токены
POST   /api/auth/logout                            — выход
GET    /api/auth/me                                — текущий пользователь
GET    /api/auth/users                             — список сотрудников
PATCH  /api/auth/users/:userId/role                — изменить роль (superadmin)
PATCH  /api/auth/users/:userId                     — обновить профиль
DELETE /api/auth/users/:userId                     — удалить (superadmin)
GET    /api/auth/roles                             — список ролей с правами
PATCH  /api/auth/roles/:roleName/permissions       — изменить права роли (superadmin)
```

### Students — `/api/students`

```
POST   /api/students/login                         — логин студента
GET    /api/students                               — список студентов
POST   /api/students                               — создать студента
GET    /api/students/:studentId                    — студент по ID
PATCH  /api/students/:studentId                    — обновить
DELETE /api/students/:studentId                    — удалить (admin+)
GET    /api/students/:studentId/groups             — группы студента
POST   /api/students/:studentId/reward             — начислить монеты
```

### Groups — `/api/groups`

```
GET    /api/groups                                 — список групп
POST   /api/groups                                 — создать группу
GET    /api/groups/:groupId                        — группа по ID
PATCH  /api/groups/:groupId                        — обновить
DELETE /api/groups/:groupId                        — удалить (admin+)
POST   /api/groups/:groupId/students               — добавить студента в группу
DELETE /api/groups/:groupId/students/:studentId    — убрать студента из группы
POST   /api/groups/:groupId/support-teachers       — добавить support-учителя в группу
DELETE /api/groups/:groupId/support-teachers/:uid  — убрать support-учителя из группы
POST   /api/groups/:groupId/attendance             — отметить посещаемость
GET    /api/groups/:groupId/attendance             — получить посещаемость
GET    /api/groups/:groupId/lessons                — уроки группы
POST   /api/groups/:groupId/lessons                — создать урок
GET    /api/groups/:groupId/lessons/:lessonId      — урок по ID
PATCH  /api/groups/:groupId/lessons/:lessonId      — обновить урок
DELETE /api/groups/:groupId/lessons/:lessonId      — удалить урок
```

### Courses — `/api/courses`

```
GET    /api/courses                                — список курсов
POST   /api/courses                                — создать курс
GET    /api/courses/:courseId                      — курс по ID
PATCH  /api/courses/:courseId                      — обновить
DELETE /api/courses/:courseId                      — удалить
```

### Homework — `/api/homework`

```
GET    /api/homework                               — список заданий
POST   /api/homework                               — создать задание / submission
GET    /api/homework/:submissionId                 — по ID
PATCH  /api/homework/:submissionId                 — обновить / проверить / оценить
DELETE /api/homework/:submissionId                 — удалить
```

### Finance — `/api/finance`

```
GET    /api/finance/transactions                           — список транзакций
DELETE /api/finance/transactions/:transactionId            — всегда 405 (ledger immutable)
GET    /api/finance/employees                              — сотрудники с финансами
GET    /api/finance/employees/:employeeId                  — финансовое резюме
PATCH  /api/finance/employees/:employeeId/salary           — установить зарплату (admin+)
POST   /api/finance/employees/:employeeId/bonus            — добавить бонус
POST   /api/finance/employees/:employeeId/fine             — добавить штраф вручную
```

### Forbidden — `/api/forbidden`

```
GET    /api/forbidden/rules                        — список правил
POST   /api/forbidden/rules                        — создать правило
GET    /api/forbidden/rules/:ruleId                — правило по ID
PATCH  /api/forbidden/rules/:ruleId                — обновить
DELETE /api/forbidden/rules/:ruleId                — удалить
GET    /api/forbidden/violations                   — список нарушений
POST   /api/forbidden/violations                   — зафиксировать нарушение (→ штраф)
GET    /api/forbidden/violations/:violationId      — нарушение по ID
DELETE /api/forbidden/violations/:violationId      — удалить (→ сторно штрафа)
```

### Extra Lessons — `/api/extra-lessons`

```
— Управление support-учителями (admin+) —
GET    /api/extra-lessons/support-teachers                 — список (любой сотрудник)
POST   /api/extra-lessons/support-teachers/:userId         — назначить (admin+)
DELETE /api/extra-lessons/support-teachers/:userId         — снять (admin+)

— Расписание и бронирование —
GET    /api/extra-lessons/availability                     — свободные слоты (БЕЗ авторизации)
POST   /api/extra-lessons/book                             — забронировать (student token)
GET    /api/extra-lessons/my-lessons                       — мои уроки (student token)

— Очередь заявок (employee token) —
GET    /api/extra-lessons/requests                         — список ожидающих заявок

— CRUD (employee token) —
GET    /api/extra-lessons                                  — все уроки
POST   /api/extra-lessons                                  — создать урок напрямую (support teacher+)
GET    /api/extra-lessons/:lessonId                        — урок по ID
PATCH  /api/extra-lessons/:lessonId                        — обновить
DELETE /api/extra-lessons/:lessonId                        — удалить (admin+)

— Управление заявками (employee token) —
PATCH  /api/extra-lessons/:lessonId/approve                — одобрить заявку
PATCH  /api/extra-lessons/:lessonId/deny                   — отклонить заявку
PATCH  /api/extra-lessons/:lessonId/complete               — завершить урок

— Студенты в уроке (employee token) —
POST   /api/extra-lessons/:lessonId/students               — добавить студентов (массив)
DELETE /api/extra-lessons/:lessonId/students/:studentId    — убрать студента
```

### Leads — `/api/leads`

```
GET    /api/leads                                  — список лидов
POST   /api/leads                                  — создать лид
GET    /api/leads/:leadId                          — лид по ID
PATCH  /api/leads/:leadId                          — обновить
DELETE /api/leads/:leadId                          — удалить
```

---

## 6. Структура папок

```
BackZuhr/
├── app.js                          — Express-приложение, middleware, роуты
├── index.js                        — Точка входа: подключение к БД, запуск сервера
├── public/
│   └── face-id-demo.html           — Тестовая страница Face ID
├── uploads/                        — Загруженные файлы (аватары)
└── src/
    ├── config/
    │   ├── db.js                   — Подключение к MongoDB + запуск seeders
    │   └── swagger.js              — Конфигурация Swagger
    ├── controllers/                — Обработчики запросов (бизнес-логика)
    │   ├── auth.controller.js
    │   ├── student.controller.js
    │   ├── group.controller.js
    │   ├── course.controller.js
    │   ├── homework.controller.js
    │   ├── finance.controller.js
    │   ├── forbidden.controller.js
    │   ├── extra-lesson.controller.js
    │   └── lead.controller.js
    ├── middleware/
    │   ├── auth.middleware.js       — requireAuth, requireStudentAuth, allowRoles, allowPermissions
    │   ├── validateObjectId.js      — Factory: проверка ObjectId в URL-параметрах
    │   └── errorHandler.js         — Глобальный обработчик ошибок
    ├── model/                      — Основные Mongoose-модели
    │   ├── user.model.js           — Сотрудник
    │   ├── student.model.js        — Студент
    │   ├── group.model.js          — Группа (расписание, посещаемость)
    │   ├── lesson.model.js         — Урок внутри группы
    │   ├── course.model.js         — Шаблон курса
    │   ├── homework-submission.model.js
    │   ├── extra-lesson.model.js   — Доп. уроки (слоты, бронирование)
    │   ├── forbidden-rule.model.js — Правила запрещённых действий
    │   ├── employee-violation.model.js — Нарушения сотрудников
    │   └── lead.model.js           — Лиды (CRM)
    ├── models/                     — Вспомогательные модели
    │   ├── Role.model.js           — Роли с permissions (RBAC)
    │   ├── FinancialEvent.model.js — Append-only финансовый ledger
    │   └── FaceCredential.model.js — Биометрические данные (Face ID)
    ├── routes/                     — Express-роуты со Swagger-аннотациями
    │   ├── auth.routes.js
    │   ├── student.routes.js
    │   ├── group.routes.js
    │   ├── course.routes.js
    │   ├── homework.routes.js
    │   ├── finance.routes.js
    │   ├── forbidden.routes.js
    │   ├── extra-lesson.routes.js
    │   └── lead.routes.js
    ├── services/
    │   ├── finance.service.js              — Агрегация финансового баланса
    │   ├── course-sync.service.js          — Синхронизация курс ↔ группы
    │   └── student-balance-reset.service.js — Периодический сброс баланса студентов
    ├── seeders/
    │   └── roles.seeder.js                 — Инициализация ролей (запускается при старте)
    └── utils/
        ├── token.js                        — Генерация и верификация JWT
        └── AppError.js                     — Класс кастомных ошибок
```

---

## 7. Ключевые решения

### Почему два типа токенов?

Студенты и сотрудники — принципиально разные сущности с разными правами и workflow. Смешивать их в одну систему означало бы постоянные проверки типа `if (userType === 'student')` везде. Разделение делает каждый middleware простым и предсказуемым.

### Почему финансы append-only?a

Для бухгалтерского аудита. Если можно удалить транзакцию, нельзя восстановить историю. Append-only — стандартная практика для финансовых систем. "Отмена" реализуется через компенсирующую запись, а не удаление.

### Почему ExtraLesson.students — массив объектов, а не ObjectId?

Нужно хранить кто и когда добавил студента (`addedBy`, `addedAt`). Простой массив ObjectId не позволял бы это без отдельной коллекции.

### Почему VALID_SLOT_MINUTES_LOCAL?

Слоты рассчитаны по формуле: 14:00 + N×70 минут. Хранятся как минуты от полуночи в локальном времени (UTC+5), чтобы валидация была независима от летнего/зимнего времени и проста для проверки.

### Почему нет отдельного `title` у ExtraLesson?

Тема задаётся через `subject` + `teacherNote`. Урок идентифицируется учителем, временем и студентами — фиксированное название избыточно.

### Порядок маршрутов в extra-lesson.routes.js

Все маршруты с фиксированным сегментом (`/availability`, `/book`, `/my-lessons`, `/requests`, `/support-teachers`) объявлены **до** маршрутов с параметром (`/:lessonId`). Иначе Express попытается интерпретировать строки как ObjectId и вернёт `INVALID_OBJECT_ID`.

---

> Для документации API с примерами запросов и ответов — смотри `README.frontend.md`.
> Для интерактивной документации — открой `GET /api-docs`.
