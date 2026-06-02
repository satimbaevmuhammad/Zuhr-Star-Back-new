# BackZuhr API — Справочник для Frontend-разработчика

Полная документация по всем API. Написана специально для frontend-разработчика — с объяснением архитектуры, нюансов токенов и готовыми примерами запросов/ответов.

---

## Содержание

1. [Как устроен этот проект](#1-как-устроен-этот-проект)
2. [Базовые URL и утилиты](#2-базовые-url-и-утилиты)
3. [Авторизация и токены](#3-авторизация-и-токены)
4. [Формат ошибок](#4-формат-ошибок)
5. [Формат пагинации](#5-формат-пагинации)
6. [Роли и права доступа](#6-роли-и-права-доступа)
7. [Модуль Auth — сотрудники](#7-модуль-auth--сотрудники)
8. [Модуль Students](#8-модуль-students)
9. [Модуль Groups](#9-модуль-groups)
10. [Модуль Courses и Lessons](#10-модуль-courses-и-lessons)
11. [Модуль Homework](#11-модуль-homework)
12. [Модуль Finance](#12-модуль-finance)
13. [Модуль Forbidden — правила и штрафы](#13-модуль-forbidden--правила-и-штрафы)
14. [Модуль Extra Lessons](#14-модуль-extra-lessons)
15. [Модуль Leads](#15-модуль-leads)
16. [Загрузка файлов (аватары)](#16-загрузка-файлов-аватары)
17. [Face ID](#17-face-id)
18. [Чеклист для frontend](#18-чеклист-для-frontend)

---

## 1. Как устроен этот проект

Это REST API для учебного центра (school/education center). Прежде чем идти к эндпоинтам, важно понять архитектуру — иначе многое будет непонятно.

### 1.1 Две совершенно разные сущности: User и Student

Самое важное отличие в проекте — это разделение на **User (сотрудник)** и **Student (ученик)**. Это два разных типа аккаунтов с разными таблицами (коллекциями) в базе данных и разными JWT токенами.

| | User (сотрудник) | Student (ученик) |
|---|---|---|
| Логин | `POST /api/auth/login` | `POST /api/students/login` |
| Токен | `userType: "employee"` | `userType: "student"` |
| Refresh токен | Есть (7 дней) | Нет |
| Роли | teacher, supporteacher, headteacher, admin, superadmin | Нет ролей |
| Может | Управлять всей системой | Смотреть расписание, бронировать доп.уроки |

Когда ты делаешь запрос с токеном сотрудника на студенческий эндпоинт — получишь 401. И наоборот. Это не баг, это намеренное разделение.

### 1.2 Иерархия ролей сотрудников

```
superadmin   — полный доступ ко всему
  └── admin       — управление сотрудниками, финансами, группами
        └── headteacher  — руководит учителями, может добавлять бонусы/штрафы
              └── supporteacher  — поддержка, проводит доп.уроки
                    └── teacher        — ведёт группы и уроки
```

Роли проверяются на бэкенде. Если у пользователя нет нужной роли или прав — придёт 403 Forbidden.

### 1.3 Система прав (permissions)

Помимо ролей есть отдельная система разрешений (permissions). Они хранятся в базе данных и могут быть изменены через API. Например, роль `teacher` по умолчанию имеет права `groups:read`, `students:read` и т.д. Суперадмин имеет все права (`*`). Это позволяет гибко настраивать что может делать каждая роль.

### 1.4 Финансы — только append-only (никаких удалений)

Финансовые транзакции (`FinancialEvent`) нельзя удалить или изменить — это намеренно для аудита. Если нужно "отменить" штраф — удаляют само нарушение (`DELETE /api/forbidden/violations/:id`), и бэкенд сам создаёт компенсирующую запись.

### 1.5 Доп.уроки (Extra Lessons) — отдельная система бронирования

У учебного центра есть 2-3 специально назначенных "support teacher" (поддерживающих учителя), которые проводят дополнительные занятия. Студент может:
- Посмотреть свободное время учителя
- Забронировать слот (создаётся запрос `pending_approval`)
- Учитель одобряет или отклоняет запрос

Каждый доп.урок: ровно 60 минут, после — 10 минут отдыха. Итого 70-минутные слоты. 5 слотов в день: 14:00, 15:10, 16:20, 17:30, 18:40 (UTC+5, Ташкент).

### 1.6 Чем отличается Group от Course?

- **Course** — это шаблон курса (название, описание, продолжительность, предмет). Абстракция.
- **Group** — это конкретная группа студентов, которая проходит курс. У группы есть расписание, учитель, список студентов, посещаемость.
- **Lesson** — конкретное занятие внутри группы (дата, тема, домашнее задание).

Связь: `Course → Group → Lesson`. Группа может существовать без привязки к Course.

### 1.7 Leads — это потенциальные клиенты

Lead — это человек, который проявил интерес к учебному центру (написал в Instagram, позвонил и т.д.), но ещё не является студентом. CRM-модуль для отдела продаж.

---

## 2. Базовые URL и утилиты

```
Базовый URL всех API: /api
```

| Эндпоинт | Описание |
|---|---|
| `GET /health` | Проверка сервера → `{ status: "ok" }` |
| `GET /api-docs` | Swagger UI — интерактивная документация |
| `GET /api-docs-json` | OpenAPI спецификация в JSON |
| `GET /face-id-demo` | Тестовая страница Face ID |
| `GET /uploads/<filename>` | Загруженные файлы (аватары) |
| `GET /public/<file>` | Статические файлы |

---

## 3. Авторизация и токены

### Два отдельных токена — не забывай!

```
Сотрудник:  POST /api/auth/login          → токен с userType: "employee"
Студент:    POST /api/students/login       → токен с userType: "student"
```

Используй нужный токен для нужного типа эндпоинтов.

### Заголовок авторизации

```
Authorization: Bearer <accessToken>
```

### Структура JWT payload (после декодирования)

```json
{
  "sub": "65f12ca7a7720c194de6a095",
  "role": "teacher",
  "userType": "employee",
  "iat": 1711000000,
  "exp": 1711086400
}
```

Для студента:
```json
{
  "sub": "65f12ca7a7720c194de6a010",
  "role": "student",
  "userType": "student",
  "iat": 1711000000,
  "exp": 1711086400
}
```

### Время жизни токенов

| Токен | Время жизни |
|---|---|
| Access токен сотрудника | 24 часа |
| Refresh токен сотрудника | 7 дней |
| Access токен студента | 24 часа (без refresh) |

### Обновление токена сотрудника

```
POST /api/auth/refresh-token
Content-Type: application/json

{ "refreshToken": "eyJ..." }
```

Ответ:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

> У студентов refresh токена **нет** — при истечении нужно снова логиниться через `/api/students/login`.

---

## 4. Формат ошибок

Все ошибки (4xx, 5xx) возвращаются в едином формате:

```json
{
  "message": "Текст ошибки на английском",
  "code": "ERROR_CODE",
  "field": "fieldName"
}
```

| Поле | Описание |
|---|---|
| `message` | Человекочитаемое описание |
| `code` | Машиночитаемый код (используй для локализации) |
| `field` | Если ошибка относится к конкретному полю — оно будет здесь, иначе `null` |

### Стандартные коды ошибок

| HTTP | code |
|---|---|
| 400 | `BAD_REQUEST` или `INVALID_OBJECT_ID` |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 409 | `CONFLICT` |
| 500 | `INTERNAL_SERVER_ERROR` |

---

## 5. Формат пагинации

Все списки поддерживают пагинацию через query params `?page=1&limit=20`.

Ответ всегда имеет формат:
```json
{
  "page": 1,
  "limit": 20,
  "total": 150,
  "data": [...]
}
```

Максимальный `limit` обычно 100.

---

## 6. Роли и права доступа

### Роли сотрудников (field: `role`)

| Роль | Описание |
|---|---|
| `superadmin` | Полный доступ ко всему, включает все права |
| `admin` | Управление сотрудниками, финансами, группами |
| `headteacher` | Руководство учителями, бонусы/штрафы |
| `supporteacher` | Поддержка, проводит доп.уроки |
| `teacher` | Ведёт группы и уроки |

### Строки прав (permissions)

Права хранятся в БД. Администратор может менять права через API. Вот список прав которые встречаются в коде:

| Permission | Что разрешает |
|---|---|
| `users:read` | Читать список пользователей |
| `students:read` | Читать список студентов |
| `students:manage` | Управлять студентами |
| `groups:read` | Читать группы, уроки, доп.уроки |
| `groups:manage` | Управлять группами |
| `courses:read` | Читать курсы |
| `courses:manage` | Управлять курсами |
| `finance:read` | Читать финансы |
| `*` | Все права (суперадмин) |

---

## 7. Модуль Auth — сотрудники

Базовый путь: `/api/auth`

### Регистрация сотрудника

```
POST /api/auth/register
Authorization: Bearer <superadmin-token>
Content-Type: multipart/form-data
```

Только суперадмин может регистрировать сотрудников.

| Поле | Тип | Обязательное | Описание |
|---|---|---|---|
| `fullname` | string | ✅ | Полное имя |
| `phone` | string | ✅ | Уникальный телефон (+998...) |
| `email` | string | ✅ | Уникальный email |
| `password` | string | ✅ | Минимум 8 символов |
| `role` | string | ✅ | teacher, supporteacher, headteacher, admin |
| `dateOfBirth` | string (ISO date) | ✅ | Дата рождения |
| `gender` | string | ✅ | male / female |
| `company` | string | ❌ | Компания/филиал |
| `avatar` | file | ❌ | Фото (JPEG/PNG, max 5MB) |

Ответ `201`:
```json
{
  "message": "User registered",
  "user": {
    "_id": "65f12ca7...",
    "fullname": "Алишер Каримов",
    "phone": "+998901234567",
    "email": "ali@school.uz",
    "role": "teacher",
    "gender": "male",
    "imgURL": "/uploads/avatar-xxx.jpg",
    "isExtraLessonSupport": false,
    "createdAt": "2026-03-28T09:00:00Z"
  }
}
```

### Логин сотрудника

```
POST /api/auth/login
Content-Type: application/json

{
  "phone": "+998901234567",
  "password": "securepass"
}
```

Ответ `200`:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "user": {
    "_id": "65f12ca7...",
    "fullname": "Алишер Каримов",
    "role": "teacher",
    "email": "ali@school.uz",
    "phone": "+998901234567",
    "imgURL": "/uploads/avatar-xxx.jpg",
    "isExtraLessonSupport": false
  }
}
```

### Обновление токена

```
POST /api/auth/refresh-token
Content-Type: application/json

{ "refreshToken": "eyJ..." }
```

### Выход

```
POST /api/auth/logout
Authorization: Bearer <token>
```

### Текущий пользователь

```
GET /api/auth/me
Authorization: Bearer <token>
```

Возвращает полный объект текущего пользователя (без пароля и refreshToken).

### Список сотрудников

```
GET /api/auth/users?page=1&limit=20&search=ali&role=teacher
Authorization: Bearer <token>  (нужно право users:read)
```

Query params:
- `search` — поиск по имени, телефону, email
- `role` — фильтр по роли
- `page`, `limit` — пагинация

### Список ролей с правами

```
GET /api/auth/roles
Authorization: Bearer <token>
```

Ответ:
```json
[
  {
    "name": "teacher",
    "permissions": ["groups:read", "students:read", "courses:read"]
  },
  {
    "name": "admin",
    "permissions": ["*"]
  }
]
```

### Обновление прав роли (только суперадмин)

```
PATCH /api/auth/roles/:roleName/permissions
Authorization: Bearer <superadmin-token>
Content-Type: application/json

{ "permissions": ["groups:read", "students:read", "finance:read"] }
```

### Изменение роли пользователя (только суперадмин)

```
PATCH /api/auth/users/:userId/role
Authorization: Bearer <superadmin-token>
Content-Type: application/json

{ "role": "headteacher" }
```

### Удаление пользователя (только суперадмин)

```
DELETE /api/auth/users/:userId
Authorization: Bearer <superadmin-token>
```

---

## 8. Модуль Students

Базовый путь: `/api/students`

> **Важно:** Студенты — отдельная сущность от сотрудников. Для управления студентами нужен токен **сотрудника** (не студента). Для логина студента — свой эндпоинт.

### Логин студента

```
POST /api/students/login
Content-Type: application/json

{
  "studentPhone": "+998901234567",
  "password": "pass1234"
}
```

Ответ `200`:
```json
{
  "accessToken": "eyJ...",
  "student": {
    "_id": "65f12ca7...",
    "fullname": "Камол Юсупов",
    "studentPhone": "+998901234567",
    "gender": "male",
    "balance": 0,
    "coinBalance": 0
  }
}
```

> Студент получает токен с `userType: "student"`. Этот токен используется ТОЛЬКО для `/api/extra-lessons/book`, `/api/extra-lessons/my-lessons` и `/api/extra-lessons/availability` (последний вообще без токена).

### Создать студента (сотрудник)

```
POST /api/students
Authorization: Bearer <employee-token>
Content-Type: application/json

{
  "fullname": "Камол Юсупов",
  "studentPhone": "+998901234567",
  "parentPhone": "+998907654321",
  "gender": "male",
  "birthDate": "2010-05-15",
  "password": "pass1234",
  "note": "Хорошо успевает по математике"
}
```

### Список студентов

```
GET /api/students?page=1&limit=20&search=камол&groupAttached=true
Authorization: Bearer <employee-token>
```

Query params:
- `search` — поиск по имени, телефону
- `groupAttached` — `true` (прикреплён к группе) / `false`
- `page`, `limit`

Поле `groupAttached: true` означает что студент состоит хотя бы в одной **активной** группе.

### Получить студента по ID

```
GET /api/students/:studentId
Authorization: Bearer <employee-token>
```

### Группы студента

```
GET /api/students/:studentId/groups
Authorization: Bearer <employee-token>
```

Ответ включает статус в каждой группе: `active`, `paused`, `completed`, `left`.

### Обновить студента

```
PATCH /api/students/:studentId
Authorization: Bearer <employee-token>
Content-Type: application/json

{
  "fullname": "Новое имя",
  "parentPhone": "+998901111111",
  "note": "Обновлённая заметка"
}
```

### Начислить монеты студенту

```
POST /api/students/:studentId/reward
Authorization: Bearer <employee-token>
Content-Type: application/json

{ "coins": 10, "reason": "Лучший результат на тесте" }
```

### Удалить студента

```
DELETE /api/students/:studentId
Authorization: Bearer <employee-token>  (нужна роль admin/superadmin)
```

---

## 9. Модуль Groups

Базовый путь: `/api/groups`

> Группа — это конкретная учебная группа с расписанием, учителем и студентами.

### Типы групп и расписание

- `groupType: "odd"` — занятия в **понедельник, среду, пятницу**
- `groupType: "even"` — занятия во **вторник, четверг, субботу**

Расписание задаётся массивом — по одному объекту на каждый день:
```json
"schedule": [
  { "dayOfWeek": "monday", "startTime": "09:00", "durationMinutes": 90 },
  { "dayOfWeek": "wednesday", "startTime": "09:00", "durationMinutes": 90 },
  { "dayOfWeek": "friday", "startTime": "09:00", "durationMinutes": 90 }
]
```

Статусы группы: `planned` → `active` → `paused` / `completed` / `archived`

### Создать группу

```
POST /api/groups
Authorization: Bearer <employee-token>
Content-Type: application/json

{
  "name": "Math A1",
  "course": "Математика",
  "courseRef": "65f12ca7...",
  "groupType": "odd",
  "teacher": "65f12ca7...",
  "startDate": "2026-04-01",
  "schedule": [
    { "dayOfWeek": "monday", "startTime": "10:00", "durationMinutes": 90 },
    { "dayOfWeek": "wednesday", "startTime": "10:00", "durationMinutes": 90 },
    { "dayOfWeek": "friday", "startTime": "10:00", "durationMinutes": 90 }
  ],
  "monthlyFee": 500000,
  "maxStudents": 15,
  "room": "Кабинет 101"
}
```

### Список групп

```
GET /api/groups?page=1&limit=20&status=active&teacherId=65f...&search=math
Authorization: Bearer <employee-token>
```

### Получить группу по ID

```
GET /api/groups/:groupId
Authorization: Bearer <employee-token>
```

### Обновить группу

```
PATCH /api/groups/:groupId
Authorization: Bearer <employee-token>
```

### Добавить/удалить студента из группы

```
POST   /api/groups/:groupId/students        — добавить студента
DELETE /api/groups/:groupId/students/:sid   — удалить студента
```

Body для добавления: `{ "studentId": "65f..." }`

### Добавить/удалить поддерживающего учителя в группе

```
POST   /api/groups/:groupId/support-teachers
DELETE /api/groups/:groupId/support-teachers/:userId
```

> **Внимание:** `supporteachers` в группе — это НЕ то же самое, что `isExtraLessonSupport` у пользователя. Первое — помощники конкретной группы, второе — глобальные учителя доп.уроков.

### Посещаемость

```
POST /api/groups/:groupId/attendance
Authorization: Bearer <employee-token>
Content-Type: application/json

{
  "date": "2026-03-28",
  "records": [
    { "studentId": "65f...", "status": "present" },
    { "studentId": "65f...", "status": "absent", "note": "Заболел" }
  ]
}
```

Статусы посещаемости: `present`, `absent`, `late`, `excused`

```
GET /api/groups/:groupId/attendance?date=2026-03-28
```

---

## 10. Модуль Courses и Lessons

### Courses — шаблоны курсов

Базовый путь: `/api/courses`

```
GET    /api/courses              — список курсов
POST   /api/courses              — создать курс
GET    /api/courses/:courseId    — курс по ID
PATCH  /api/courses/:courseId    — обновить
DELETE /api/courses/:courseId    — удалить
```

Поля курса: `name`, `description`, `subject`, `durationMonths`, `level`, `price`.

### Lessons — занятия внутри группы

```
GET    /api/groups/:groupId/lessons              — список уроков группы
POST   /api/groups/:groupId/lessons              — создать урок
GET    /api/groups/:groupId/lessons/:lessonId    — урок по ID
PATCH  /api/groups/:groupId/lessons/:lessonId    — обновить
DELETE /api/groups/:groupId/lessons/:lessonId    — удалить
```

Поля урока: `topic`, `date`, `homeworkDescription`, `homeworkDueDate`, `note`.

---

## 11. Модуль Homework

Базовый путь: `/api/homework`

Домашние задания — это submissions (ответы студентов) на задания уроков.

```
GET    /api/homework                     — список submissions (фильтры: lessonId, studentId, status)
POST   /api/homework                     — студент/учитель создаёт submission
GET    /api/homework/:submissionId       — submission по ID
PATCH  /api/homework/:submissionId       — обновить (проверить, поставить оценку)
DELETE /api/homework/:submissionId       — удалить
```

Статусы: `pending` → `submitted` → `graded` / `late`

---

## 12. Модуль Finance

Базовый путь: `/api/finance`

> **Ключевое понимание:** Финансы работают как банковский ledger — только добавление записей, никаких удалений. Каждый бонус/штраф = отдельная запись (FinancialEvent). Текущий баланс = сумма всех событий.

### Виды финансовых событий

| Тип | Описание |
|---|---|
| `salary_update` | Изменение базовой зарплаты |
| `bonus` | Бонус (увеличивает баланс) |
| `fine` | Штраф (уменьшает баланс) |

### Список транзакций

```
GET /api/finance/transactions?employeeId=65f...&type=bonus&page=1&limit=20
Authorization: Bearer <token>  (нужно право users:read)
```

### Список сотрудников с финансами

```
GET /api/finance/employees?page=1&limit=20&search=Ali&role=teacher
Authorization: Bearer <token>
```

### Финансовое резюме сотрудника

```
GET /api/finance/employees/:employeeId
Authorization: Bearer <token>
```

Ответ включает: текущий баланс, базовую зарплату, итого бонусов, итого штрафов, список нарушений.

### Установить зарплату

```
PATCH /api/finance/employees/:employeeId/salary
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "salary": 3000000 }
```

### Добавить бонус

```
POST /api/finance/employees/:employeeId/bonus
Authorization: Bearer <token>  (headteacher/admin/superadmin)
Content-Type: application/json

{
  "amount": 200000,
  "reason": "Лучший учитель месяца"
}
```

### Добавить штраф вручную

```
POST /api/finance/employees/:employeeId/fine
Authorization: Bearer <token>  (headteacher/admin/superadmin)
Content-Type: application/json

{
  "amount": 50000,
  "reason": "Опоздание 3 раза на этой неделе"
}
```

> Для штрафов через нарушения правил используй модуль Forbidden.

---

## 13. Модуль Forbidden — правила и штрафы

Базовый путь: `/api/forbidden`

Система запрещённых действий. Администратор создаёт правила (например "запрещено курить"), при нарушении создаётся запись и автоматически применяется штраф.

### Правила (Rules)

```
GET    /api/forbidden/rules         — список правил
POST   /api/forbidden/rules         — создать правило
GET    /api/forbidden/rules/:id     — правило по ID
PATCH  /api/forbidden/rules/:id     — обновить
DELETE /api/forbidden/rules/:id     — удалить
```

Поля правила: `name`, `description`, `fineAmount` (размер штрафа в сумах).

### Нарушения (Violations)

```
GET    /api/forbidden/violations                     — список нарушений
POST   /api/forbidden/violations                     — зафиксировать нарушение
GET    /api/forbidden/violations/:violationId        — нарушение по ID
DELETE /api/forbidden/violations/:violationId        — удалить нарушение (сторнирует штраф)
```

Создать нарушение:
```json
{
  "userId": "65f...",
  "ruleId": "65f...",
  "note": "Курил в туалете"
}
```

При создании нарушения автоматически создаётся `FinancialEvent` типа `fine` на сумму из правила.
При удалении нарушения автоматически создаётся компенсирующий `FinancialEvent` (возврат штрафа).

---

## 14. Модуль Extra Lessons

Базовый путь: `/api/extra-lessons`

> Самый сложный модуль. Читай внимательно.

### Концепция

- Назначается 2-3 специальных учителя (`isExtraLessonSupport: true`)
- Они работают с **14:00 до 20:00** (UTC+5, Ташкент)
- Каждый урок длится **ровно 60 минут** + 10 минут отдыха = 70-минутные слоты
- В день у каждого учителя **5 слотов**: 14:00, 15:10, 16:20, 17:30, 18:40
- Студент бронирует → учитель одобряет/отклоняет
- Учитель может сам создать урок (сразу подтверждается)
- В одном уроке может быть **1-3 студента**

### Статусы урока

```
pending_approval  — студент подал заявку, ждёт решения учителя
        ↓
   confirmed       — учитель одобрил (или создал сам)
        ↓
   completed       — урок состоялся

pending_approval → cancelled  — учитель отклонил (с причиной)
confirmed → cancelled         — отменён администратором
```

### Типы создания (requestType)

- `student_request` — студент забронировал → нужно одобрение
- `teacher_created` — учитель создал сам → сразу `confirmed`

---

### Эндпоинты

#### Управление поддерживающими учителями (admin)

```
GET    /api/extra-lessons/support-teachers
POST   /api/extra-lessons/support-teachers/:userId    — назначить как support teacher
DELETE /api/extra-lessons/support-teachers/:userId    — снять
```

`GET` требует токен сотрудника с правом `users:read`.
`POST`/`DELETE` требуют роль `admin` или `superadmin`.

Ответ GET:
```json
{
  "total": 2,
  "max": 3,
  "data": [
    {
      "_id": "65f...",
      "fullname": "Зафар Исмоилов",
      "phone": "+998901234567",
      "role": "supporteacher",
      "isExtraLessonSupport": true
    }
  ]
}
```

---

#### Просмотр расписания (БЕЗ авторизации — публичный)

```
GET /api/extra-lessons/availability?teacherId=65f...&date=2026-03-28
```

`date` — необязательный параметр в формате `YYYY-MM-DD` (локальная UTC+5). По умолчанию — сегодня.

Ответ `200`:
```json
{
  "teacherId": "65f...",
  "date": "2026-03-28",
  "teacher": { "_id": "65f...", "fullname": "Зафар Исмоилов" },
  "lessonsToday": 2,
  "remainingSlots": 3,
  "slots": [
    { "scheduledAt": "2026-03-28T09:00:00.000Z", "localTime": "14:00", "isFree": false },
    { "scheduledAt": "2026-03-28T10:10:00.000Z", "localTime": "15:10", "isFree": true },
    { "scheduledAt": "2026-03-28T11:20:00.000Z", "localTime": "16:20", "isFree": true },
    { "scheduledAt": "2026-03-28T12:30:00.000Z", "localTime": "17:30", "isFree": false },
    { "scheduledAt": "2026-03-28T13:40:00.000Z", "localTime": "18:40", "isFree": true }
  ]
}
```

> **Важно для frontend:** Значение `scheduledAt` из этого ответа — это именно то, что нужно передать при бронировании. Не вычисляй время сам, используй ответ сервера.

---

#### Бронирование студентом

```
POST /api/extra-lessons/book
Authorization: Bearer <student-token>      ← токен студента!
Content-Type: application/json

{
  "teacherId": "65f...",
  "scheduledAt": "2026-03-28T10:10:00.000Z",
  "studentNote": "Нужна помощь с темой тригонометрия"
}
```

Ответ `201`:
```json
{
  "message": "Booking request submitted. Waiting for teacher approval.",
  "lesson": {
    "_id": "65f...",
    "assignedTeacher": { "_id": "65f...", "fullname": "Зафар Исмоилов" },
    "scheduledAt": "2026-03-28T10:10:00.000Z",
    "status": "pending_approval",
    "requestType": "student_request",
    "studentNote": "Нужна помощь с темой тригонометрия",
    "students": [
      { "student": { "_id": "65f...", "fullname": "Камол Юсупов" } }
    ]
  }
}
```

Возможные ошибки:
- `400` — `scheduledAt` не является допустимым слотом
- `409` — слот уже занят
- `409` — у учителя уже 5 уроков в этот день
- `409` — у студента уже есть урок в это время

---

#### Мои уроки (студент)

```
GET /api/extra-lessons/my-lessons?status=pending_approval&page=1&limit=20
Authorization: Bearer <student-token>
```

Статусы для фильтра: `pending_approval`, `confirmed`, `cancelled`, `completed`

---

#### Очередь заявок (сотрудник/учитель)

```
GET /api/extra-lessons/requests?page=1&limit=20
Authorization: Bearer <employee-token>
```

- Учитель видит только **свои** заявки
- Admin/superadmin видят все заявки (можно фильтровать `?teacherId=65f...`)

---

#### Одобрить заявку студента

```
PATCH /api/extra-lessons/:lessonId/approve
Authorization: Bearer <employee-token>   (assigned teacher или admin)
Content-Type: application/json

{ "teacherNote": "До встречи!" }
```

`teacherNote` — необязательный.

Ответ `200`: урок со статусом `confirmed`.

Ошибка `409` если слот уже занят другим подтверждённым уроком — нужно сначала отклонить.

---

#### Отклонить заявку студента

```
PATCH /api/extra-lessons/:lessonId/deny
Authorization: Bearer <employee-token>   (assigned teacher или admin)
Content-Type: application/json

{
  "denialReason": "Слот уже занят другим студентом",
  "teacherNote": "Попробуйте выбрать другое время"
}
```

`denialReason` — **обязательный**. Студент увидит его в своём списке уроков.

Ответ `200`: урок со статусом `cancelled` и заполненным `denialReason`.

---

#### Завершить урок

```
PATCH /api/extra-lessons/:lessonId/complete
Authorization: Bearer <employee-token>   (assigned teacher или admin)
Content-Type: application/json

{ "teacherNote": "Хорошо поработали" }
```

Урок должен быть в статусе `confirmed`. После — становится `completed`.

---

#### Создать урок напрямую (учитель/admin)

```
POST /api/extra-lessons
Authorization: Bearer <employee-token>   (supporteacher, headteacher, admin, superadmin)
Content-Type: application/json

{
  "scheduledAt": "2026-03-29T10:10:00.000Z",
  "subject": "Алгебра",
  "teacherNote": "Повторение темы квадратных уравнений",
  "room": "Кабинет 3",
  "studentIds": ["65f...", "65f..."],
  "assignedTeacherId": "65f..."
}
```

- `studentIds` — необязательный, 1-3 студента
- `assignedTeacherId` — только для admin/superadmin (создают от имени другого учителя). Обычный учитель создаёт урок на себя.
- Слот должен быть свободен и допустим
- Урок сразу становится `confirmed`

---

#### Список всех уроков (admin/сотрудник)

```
GET /api/extra-lessons?status=confirmed&teacherId=65f...&date=2026-03-28&page=1&limit=20
Authorization: Bearer <employee-token>  (нужно право groups:read)
```

---

#### Получить урок по ID

```
GET /api/extra-lessons/:lessonId
Authorization: Bearer <employee-token>
```

Ответ содержит все поля, включая `students` с данными кто добавил и когда, `requestedBy`, `denialReason`.

---

#### Обновить урок

```
PATCH /api/extra-lessons/:lessonId
Authorization: Bearer <employee-token>   (assigned teacher или admin)
Content-Type: application/json

{
  "subject": "Геометрия",
  "teacherNote": "Обновлённая тема",
  "room": "Кабинет 5",
  "scheduledAt": "2026-03-29T11:20:00.000Z"
}
```

- `subject`, `teacherNote`, `room` — может менять учитель
- `scheduledAt` (перенос) — только admin, и новый слот должен быть свободен
- Нельзя редактировать отменённые или завершённые уроки

---

#### Удалить урок (жёсткое удаление)

```
DELETE /api/extra-lessons/:lessonId
Authorization: Bearer <admin-token>
```

---

#### Добавить студентов в урок

```
POST /api/extra-lessons/:lessonId/students
Authorization: Bearer <employee-token>   (assigned teacher или admin)
Content-Type: application/json

{ "studentIds": ["65f...", "65f..."] }
```

- Максимум 3 студента на урок суммарно
- Уже записанные студенты пропускаются без ошибки
- Нельзя добавлять в отменённые/завершённые уроки

---

#### Удалить студента из урока

```
DELETE /api/extra-lessons/:lessonId/students/:studentId
Authorization: Bearer <employee-token>   (assigned teacher или admin)
```

---

### Полная схема объекта ExtraLesson

```json
{
  "_id": "65f...",
  "assignedTeacher": { "_id": "65f...", "fullname": "...", "phone": "...", "role": "supporteacher" },
  "scheduledAt": "2026-03-28T10:10:00.000Z",
  "subject": "Алгебра",
  "requestType": "student_request",
  "requestedBy": { "_id": "65f...", "fullname": "Камол Юсупов" },
  "requestedByModel": "Student",
  "status": "confirmed",
  "students": [
    {
      "student": { "_id": "65f...", "fullname": "Камол Юсупов", "studentPhone": "+998..." },
      "addedBy": null,
      "addedAt": "2026-03-27T08:00:00.000Z"
    }
  ],
  "studentNote": "Нужна помощь с тригонометрией",
  "teacherNote": "Приходи вовремя",
  "denialReason": null,
  "room": "Кабинет 3",
  "createdAt": "2026-03-27T08:00:00.000Z",
  "updatedAt": "2026-03-27T09:00:00.000Z"
}
```

---

## 15. Модуль Leads

Базовый путь: `/api/leads`

Lead — потенциальный клиент (ещё не студент). CRM для отдела продаж.

```
GET    /api/leads?search=Ali&source=INSTAGRAM&page=1&limit=20
POST   /api/leads
GET    /api/leads/:leadId
PATCH  /api/leads/:leadId
DELETE /api/leads/:leadId
```

Все эндпоинты требуют токен сотрудника.

### Создать лид

```json
{
  "name": "Алибек Рахимов",
  "source": "INSTAGRAM",
  "number": "+998901234567",
  "email": "alibek@mail.uz",
  "username": "@alibek_instagram",
  "description": "Интересуется курсом математики для ребёнка 10 лет",
  "referral": "Порекомендовал Иван Иванов"
}
```

Источники (`source`): `INSTAGRAM`, `TELEGRAM`, `CALL_CENTER`, `WEBSITE`, `LANDING`, `FRIEND`

---

## 16. Загрузка файлов (аватары)

Аватары загружаются при регистрации пользователя:

```
POST /api/auth/register
Content-Type: multipart/form-data

avatar: <file>     — поле с файлом (JPEG/PNG, max 5MB)
...другие поля формы
```

После загрузки в поле `imgURL` будет `/uploads/имя-файла.jpg`.

Для отображения: `<img src="http://твой-сервер.uz/uploads/имя-файла.jpg" />`

Если аватар не загружен — используется дефолтный: `/uploads/default-avatar.png`.

---

## 17. Face ID

Face ID позволяет сотрудникам входить через распознавание лица вместо пароля.

```
POST /api/auth/login/face     — логин через Face ID
POST /api/auth/face/enroll    — добавить данные лица (нужно авторизоваться паролем сначала)
DELETE /api/auth/face/revoke  — удалить Face ID
GET /face-id-demo             — тестовая HTML-страница
```

Face ID использует `FaceCredential` — отдельную запись в базе, хранящую зашифрованный дескриптор лица.

---

## 18. Чеклист для frontend

### Авторизация

- [ ] Храни **два отдельных токена** если приложение работает и со студентами и с сотрудниками
- [ ] При 401 — либо обнови токен (`/auth/refresh-token`), либо перенаправь на логин
- [ ] У студентов **нет refresh токена** — при 401 сразу на логин
- [ ] Декодируй JWT и проверяй `userType` перед показом UI (не только `role`)

### Роли и доступ

- [ ] Не показывай кнопки которые пользователь не может использовать по роли
- [ ] Роль `supporteacher` ≠ `isExtraLessonSupport` — это разные вещи!
  - `supporteacher` — роль сотрудника в иерархии компании
  - `isExtraLessonSupport: true` — флаг что именно этот человек ведёт доп.уроки
  - Сотрудник с ролью `teacher` тоже может иметь `isExtraLessonSupport: true`

### Extra Lessons (бронирование)

- [ ] **Поток для студента:**
  1. `GET /availability?teacherId=...&date=...` — получить свободные слоты
  2. `POST /book` — отправить заявку с `scheduledAt` из ответа availability
  3. `GET /my-lessons` — отслеживать статус заявки
- [ ] **Поток для учителя:**
  1. `GET /requests` — список ожидающих заявок
  2. `PATCH /:id/approve` или `PATCH /:id/deny` — принять решение
  3. `PATCH /:id/complete` — после проведения урока

### Даты и время

- [ ] Все даты в API — **UTC**
- [ ] Слоты доп.уроков: отображай пользователю `localTime` из ответа availability (уже UTC+5)
- [ ] `scheduledAt` в слотах уже корректен для передачи обратно — не пересчитывай
- [ ] Для фильтрации по дате передавай `date=YYYY-MM-DD` (локальная дата UTC+5)

### Финансы

- [ ] Транзакции нельзя удалить через `/api/finance/transactions/:id` — сервер вернёт 405
- [ ] Для отмены штрафа-нарушения — удаляй через `/api/forbidden/violations/:id`

### Пагинация

- [ ] Всегда передавай `?page=1&limit=20`
- [ ] Используй `total` из ответа для pagination UI

### Работа с файлами

- [ ] Для аватаров используй `multipart/form-data`, не `application/json`
- [ ] Полный URL аватара: `BASE_URL + user.imgURL`
