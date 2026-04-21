# BackZuhr Backend API

BackZuhr is a Node.js + Express + MongoDB backend for an education center.  
It combines CRM, LMS, scheduling, attendance, homework, and finance workflows in one API.

Main domains:
- Employee auth and role-based access control (RBAC)
- Student auth and student lifecycle
- Courses, lessons, groups, attendance, and homework
- Extra lesson booking and support-teacher scheduling
- Employee violations and finance ledger events
- Lead management (CRM)

---

## Table of Contents

- [1. Core Features](#1-core-features)
- [2. Tech Stack](#2-tech-stack)
- [3. Architecture Overview](#3-architecture-overview)
- [4. Project Structure](#4-project-structure)
- [5. Quick Start](#5-quick-start)
- [6. Environment Variables](#6-environment-variables)
- [7. Runtime Routes and Docs](#7-runtime-routes-and-docs)
- [8. Authentication and Authorization](#8-authentication-and-authorization)
- [9. Domain Modules](#9-domain-modules)
- [10. Data Model Overview](#10-data-model-overview)
- [11. API Endpoint Index](#11-api-endpoint-index)
- [12. Uploads and Public URLs](#12-uploads-and-public-urls)
- [13. Error Contract](#13-error-contract)
- [14. Testing](#14-testing)
- [15. Operational Notes and Known Caveats](#15-operational-notes-and-known-caveats)
- [16. Frontend Integration](#16-frontend-integration)

---

## 1. Core Features

- JWT authentication for employees and students (separate identities)
- Dynamic RBAC permissions using role documents in MongoDB
- Employee profile and role management
- Student CRUD, student login, and student-group membership sync
- Group scheduling with odd/even schedule validation
- Attendance with in-window enforcement and automatic balance effects
- Course methodology management and lesson synchronization to linked groups
- Homework assignment, submission, grading, and unlock progression
- Finance as append-only ledger events (`salary_update`, `bonus`, `fine`, `student_payment`)
- Forbidden rules + employee violations with optional automatic fine events
- Extra lesson booking with strict UTC+5 slot rules and lifecycle states
- Lead management for CRM intake
- Swagger docs (`/api-docs`) and JSON OpenAPI output (`/api-docs-json`)

---

## 2. Tech Stack

- Runtime: Node.js (CommonJS)
- Framework: Express 5
- Database: MongoDB + Mongoose
- Auth/Security: `jsonwebtoken`, `bcrypt`
- Uploads: `multer`
- Docs: `swagger-jsdoc`, `swagger-ui-express`
- Config: `dotenv`
- CORS: `cors`
- Testing style: Node scripts + assertions (`scripts/smoke.test.js`, `scripts/senior.test.js`)

---

## 3. Architecture Overview

High-level flow:
1. `index.js` starts the HTTP server.
2. MongoDB connection runs in background with retry logic (`src/config/db.js`).
3. `app.js` configures middleware, CORS, static routes, Swagger, API routes, and global error handling.
4. Route handlers call controllers.
5. Controllers apply domain logic and use models/services.
6. Error middleware normalizes error responses.

Key design points:
- Server starts listening before DB connection succeeds.
- Roles are seeded on DB connect.
- Finance events are append-only by model constraint.
- Student balance reset checks are invoked from student/group controllers.

---

## 4. Project Structure

```text
BackZuhr/
|- index.js
|- app.js
|- package.json
|- README.md
|- README.frontend.md
|- public/
|  `- face-id-demo.html
|- uploads/
|- scripts/
|  |- smoke.test.js
|  `- senior.test.js
`- src/
   |- config/
   |  |- db.js
   |  `- swagger.js
   |- controllers/
   |  |- auth.controller.js
   |  |- student.controller.js
   |  |- group.controller.js
   |  |- course.controller.js
   |  |- homework.controller.js
   |  |- finance.controller.js
   |  |- forbidden.controller.js
   |  |- extra-lesson.controller.js
   |  `- lead.controller.js
   |- middleware/
   |  |- auth.middleware.js
   |  |- upload.middleware.js
   |  |- validateObjectId.js
   |  `- errorHandler.js
   |- model/
   |  |- user.model.js
   |  |- student.model.js
   |  |- group.model.js
   |  |- course.model.js
   |  |- lesson.model.js
   |  |- homework-submission.model.js
   |  |- extra-lesson.model.js
   |  |- forbidden-rule.model.js
   |  |- employee-violation.model.js
   |  `- lead.model.js
   |- models/
   |  |- Role.model.js
   |  |- FinancialEvent.model.js
   |  `- FaceCredential.model.js
   |- routes/
   |- seeders/
   |- services/
   `- utils/
```

---

## 5. Quick Start

### Prerequisites

- Node.js 18+ recommended
- MongoDB instance (local or hosted)

### Install

```bash
npm install
```

### Configure `.env`

Create `.env` in project root with at least:

```env
MONGO_URI=mongodb://localhost:27017/backzuhr
PORT=3000
JWT_SECRET=replace_with_a_long_random_secret
```

### Run

```bash
node index.js
```

### Run tests

```bash
npm test
```

---

## 6. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | Yes | - | MongoDB connection string |
| `PORT` | No | `3000` | HTTP server port |
| `JWT_SECRET` | Yes (recommended) | - | Primary JWT signing secret |
| `JWT_ACCESS_SECRET` | Legacy fallback | - | Used only if `JWT_SECRET` is missing |
| `JWT_REFRESH_SECRET` | No (legacy) | - | Present in historical configs, not used by current token utility |
| `STRICT_REFRESH_TOKEN_MATCH` | No | `false` | If `true`, DB refresh token must exactly match incoming refresh token |
| `CORS_ORIGINS` | No | allow all | Comma-separated allow list (`*` allowed) |
| `CORS_ORIGIN` | No | allow all | Legacy single-origin alias |
| `PUBLIC_BASE_URL` | No | request-derived | Base URL used for absolute file links |
| `BASE_URL` | No | request-derived | Fallback alias for `PUBLIC_BASE_URL` |
| `FACE_MATCH_THRESHOLD` | No | `0.45` | Face login distance threshold (`0 < value <= 2`) |
| `FACE_LOGIN_MAX_CANDIDATES` | No | `2000` | Max descriptors checked on face login (hard cap `10000`) |
| `STUDENT_BALANCE_RESET_INTERVAL_MS` | No | `3600000` | Interval for scheduled reset helper |
| `STUDENT_BALANCE_RESET_MIN_GAP_MS` | No | `300000` | Min gap between reset checks (throttle) |

---

## 7. Runtime Routes and Docs

System endpoints:
- `GET /health` -> service health
- `GET /api-docs` -> Swagger UI
- `GET /api-docs-json` -> OpenAPI JSON
- `GET /face-id-demo` -> browser Face ID demo page

Static serving:
- `GET /uploads/*` -> uploaded files
- `GET /public/*` -> public assets

API base prefix:
- All business routes are under `/api`

---

## 8. Authentication and Authorization

### 8.1 Token Model

BackZuhr uses one JWT system with typed payloads:
- Employee token: `userType = "employee"`
- Student token: `userType = "student"`

Token TTLs:
- Access token: `24h`
- Refresh token: `7d`

### 8.2 Auth Middleware

- `requireAuth` -> employee token only
- `requireStudentAuth` -> student token only
- `requireAnyAuth` -> employee or student
- `allowRoles(...roles)` -> role whitelist
- `allowPermissions(...permissions)` -> dynamic permission checks via role documents
- `allowPermissionsOrStudent(...permissions)` -> employees must pass permissions, students pass
- `allowStudentSelfOrPermissions(...permissions)` -> student can only access own `:studentId`

### 8.3 Default Roles and Permissions (Seeded)

Seeded in `src/seeders/roles.seeder.js`:

- `teacher`:
  - `profile:read`
  - `students:read`
  - `students:manage`
  - `groups:read`
- `supporteacher`:
  - `profile:read`
  - `students:read`
  - `groups:read`
- `headteacher`:
  - `profile:read`
  - `users:read`
  - `students:read`
  - `students:manage`
  - `groups:read`
  - `groups:manage`
- `admin`:
  - `profile:read`
  - `users:read`
  - `users:manage`
  - `users:manage_roles`
  - `students:read`
  - `students:manage`
  - `groups:read`
  - `groups:manage`
- `superadmin`:
  - `*`

Notes:
- Input role `"supportteacher"` is normalized to `"supporteacher"`.
- Role permissions are cached in-memory for 60 seconds and invalidated when role permissions are updated.

---

## 9. Domain Modules

### 9.1 Auth and Users

- Employee login with password or Face ID descriptor
- Face descriptors stored in separate `FaceCredential` collection
- Refresh token rotation on login/refresh
- Profile update with avatar upload
- Role listing and role-permission updates
- User role updates and guarded deletes

Important current behavior:
- `POST /api/auth/register` is currently mounted without `requireAuth` / `requireRegisterPermission` middleware in the route file.
- Controller still blocks creating `superadmin` via this endpoint.

### 9.2 Students

- Student login + refresh token flow
- Legacy plain-text password upgrade to bcrypt during successful login
- Student CRUD and group membership lifecycle
- Student coin rewards
- Group/student link synchronization across both collections
- Periodic balance reset checks triggered in controller flows

### 9.3 Groups and Attendance

- Group creation with strict odd/even schedule shape:
  - `odd` -> monday/wednesday/friday
  - `even` -> tuesday/thursday/saturday
- Optional `courseId` linking:
  - with `courseId`: `courseRef` set, lessons synced from course methodology
  - without `courseId`: manual mode with plain `course` name
- Attendance validation:
  - date must be today (UTC+5 local logic)
  - updates allowed only during scheduled lesson window
  - only group teacher/support/admin-headteacher-superadmin can manage
- Attendance affects student balance:
  - charged statuses: `present`, `late`
  - per-lesson cost: `monthlyFee / 12`

### 9.4 Courses, Lessons, and Methodology Sync

- Courses enforce:
  - unique name
  - `durationMonths` range `1..120`
  - max lessons = `durationMonths * 12`
- Lesson ordering:
  - unique `(course, order)` index
  - order is auto-sequenced in create flow
- Methodology sync:
  - creating/deleting lessons updates `course.methodology`
  - linked groups (`courseRef`) receive lesson add/remove updates
  - rebuild endpoint re-synchronizes methodology from lessons
- Lesson content:
  - lesson documents
  - homework description
  - homework links
  - homework attachments

### 9.5 Homework

- Student fetches assignment by lesson
- Unlock logic requires previous homework lessons (in ordered course flow) to be approved with score >= 70
- One submission per `(lesson, student)` (unique index)
- Resubmission allowed until approved
- Grading:
  - score range `0..100`
  - `>=70` -> `approved`
  - `<70` -> remains/reverts to `submitted`
- Student visibility:
  - own assignment/submission status
  - graded groupmate scores via dedicated endpoint

### 9.6 Finance (Append-Only Ledger)

- `FinancialEvent` types:
  - `salary`
  - `salary_update`
  - `bonus`
  - `fine`
  - `student_payment`
- Model blocks updates/deletes via pre-hooks
- Employee summary and monthly history derived from events
- Student payment events increase `Student.balance`
- Deletion endpoint for transactions intentionally returns immutable-flow errors

### 9.7 Forbidden Rules and Violations

- CRUD for forbidden behavior rules
- Violation recording:
  - creates `EmployeeViolation`
  - appends snapshot entry into `User.forbidens`
  - optionally appends finance fine event
- Violation delete:
  - removes violation
  - removes snapshot from user
  - appends negative fine reversal event

### 9.8 Extra Lessons

- Fixed UTC+5 slot system:
  - `14:00`, `15:10`, `16:20`, `17:30`, `18:40`
- Limits:
  - max 5 lessons per teacher/day
  - max 3 students per lesson
  - max 3 designated support teachers globally
- Status flow:
  - `pending_approval` -> `confirmed` -> `completed`
  - `pending_approval` -> `cancelled`
  - `confirmed` -> `cancelled` (manager cancel route)
- Public availability check endpoint (no auth)
- Supports student-request flow and teacher-created direct confirmed flow

### 9.9 Leads (CRM)

- Lead CRUD
- Source enum:
  - `INSTAGRAM`
  - `TELEGRAM`
  - `CALL_CENTER`
  - `WEBSITE`
  - `LANDING`
  - `FRIEND`

---

## 10. Data Model Overview

Primary entity relationships:

- `User`
  - employee account with role, optional face-enabled flag, salary field, forbidden snapshots
- `Role`
  - role name + dynamic permissions
- `FaceCredential`
  - one-to-one with user, stores 128-length face descriptor
- `Student`
  - student profile, token fields, balance, coin balance, group memberships
- `Group`
  - teacher/support teachers/students, schedule, attendance, optional linked course
- `Course`
  - course metadata + methodology lesson references
- `Lesson`
  - belongs to course, ordered sequence, documents + homework fields
- `HomeworkSubmission`
  - student/lesson/group submission, status/score/history/documents
- `FinancialEvent`
  - immutable ledger event for employee or student transactions
- `ForbiddenRule`
  - violation rule metadata + default fine
- `EmployeeViolation`
  - violation event linked to employee and rule
- `ExtraLesson`
  - support-teacher scheduled extra class with lifecycle + student entries
- `Lead`
  - CRM intake record

---

## 11. API Endpoint Index

Base prefix: `/api`

### 11.1 Auth (`/api/auth`)

| Method | Path | Access |
|---|---|---|
| POST | `/register` | Currently no route middleware guard |
| POST | `/login` | Public |
| POST | `/login/face` | Public |
| PATCH | `/face` | Employee token |
| DELETE | `/face` | Employee token |
| POST | `/refresh-token` | Public (refresh token required) |
| POST | `/logout` | Employee token |
| GET | `/me` | Employee token |
| GET | `/users` | Employee + permission (`users:read`) |
| GET | `/roles` | Superadmin |
| PATCH | `/roles/:roleId` | Superadmin |
| PATCH | `/users/:userId/role` | Employee + permission (`users:manage_roles`) |
| PATCH | `/users/:userId` | Employee self |
| DELETE | `/users/:userId` | Employee + permission (`users:manage`) |

### 11.2 Students (`/api/students`)

| Method | Path | Access |
|---|---|---|
| POST | `/login` | Public |
| POST | `/refresh-token` | Public |
| GET | `/` | Any auth (employees need `students:read`) |
| POST | `/` | Employee + permission (`students:manage`) |
| GET | `/:studentId` | Student self or employee permission |
| PATCH | `/:studentId` | Employee + permission (`students:manage`) |
| DELETE | `/:studentId` | Employee + permission (`students:manage`) |
| GET | `/:studentId/groups` | Student self or employee permission |
| POST | `/:studentId/reward-coins` | Teacher/headteacher/admin/superadmin |

### 11.3 Groups (`/api/groups`)

| Method | Path | Access |
|---|---|---|
| GET | `/` | Student or employee permission (`groups:read`) |
| POST | `/` | Employee permission (`groups:manage`) |
| GET | `/:groupId` | Student or employee permission (`groups:read`) |
| PATCH | `/:groupId` | Employee permission (`groups:manage`) |
| DELETE | `/:groupId` | Employee permission (`groups:manage`) |
| GET | `/:groupId/students` | Student or employee permission (`groups:read`/`students:read`) |
| POST | `/:groupId/students/:studentId` | Employee permission (`groups:manage`) |
| DELETE | `/:groupId/students/:studentId` | Employee permission (`groups:manage`) |
| POST | `/:groupId/attendance` | Employee permission (`groups:read`) |
| PATCH | `/:groupId/attendance/students/:studentId` | Employee permission (`groups:read`) |

### 11.4 Courses and Lessons (`/api/courses`)

| Method | Path | Access |
|---|---|---|
| GET | `/` | Student or employee permission (`groups:read`) |
| POST | `/` | Employee permission (`groups:manage`) |
| GET | `/:courseId` | Student or employee permission (`groups:read`) |
| PATCH | `/:courseId` | Employee permission (`groups:manage`) |
| DELETE | `/:courseId` | Employee permission (`groups:manage`) |
| GET | `/:courseId/lessons` | Student or employee permission (`groups:read`) |
| POST | `/:courseId/lessons` | Admin/headteacher/superadmin |
| PATCH | `/:courseId/lessons/:lessonId` | Admin/headteacher/superadmin |
| DELETE | `/:courseId/lessons/:lessonId` | Admin/headteacher/superadmin |
| GET | `/:courseId/lessons/:lessonId/documents` | Student or employee permission (`groups:read`) |
| DELETE | `/:courseId/lessons/:lessonId/documents/:documentId` | Admin/headteacher/superadmin |
| GET | `/:courseId/lessons/:lessonId/homework` | Student or employee permission (`groups:read`) |
| PATCH | `/:courseId/lessons/:lessonId/homework` | Admin/headteacher/superadmin |
| POST | `/:courseId/lessons/:lessonId/homework/documents` | Admin/headteacher/superadmin |
| DELETE | `/:courseId/lessons/:lessonId/homework/documents/:documentId` | Admin/headteacher/superadmin |
| POST | `/:courseId/rebuild-methodology` | Employee permission (`groups:manage`) |

### 11.5 Homework (`/api/homework`)

| Method | Path | Access |
|---|---|---|
| GET | `/lessons/:lessonId` | Student token |
| GET | `/lesson/:lessonId` | Student token (alias) |
| POST | `/lessons/:lessonId/submissions` | Student token |
| POST | `/lesson/:lessonId/submissions` | Student token (alias) |
| GET | `/groupmates/grades` | Student token |
| GET | `/submissions` | Employee token |
| PATCH | `/submissions/:submissionId/grade` | Employee token |

### 11.6 Finance (`/api/finance`)

| Method | Path | Access |
|---|---|---|
| GET | `/transactions` | Teacher/supporteacher/headteacher/admin/superadmin |
| DELETE | `/transactions/:transactionId` | Admin/superadmin (returns immutable-flow errors) |
| GET | `/employees` | Teacher/supporteacher/headteacher/admin/superadmin |
| GET | `/employees/:employeeId` | Teacher/supporteacher/headteacher/admin/superadmin |
| GET | `/employees/:employeeId/bonuses` | Teacher/supporteacher/headteacher/admin/superadmin |
| GET | `/employees/:employeeId/fines` | Teacher/supporteacher/headteacher/admin/superadmin |
| PATCH | `/employees/:employeeId/salary` | Admin/superadmin |
| POST | `/employees/:employeeId/bonus` | Headteacher/admin/superadmin |
| POST | `/employees/:employeeId/fine` | Headteacher/admin/superadmin |
| GET | `/students/payments` | Teacher/supporteacher/headteacher/admin/superadmin |
| POST | `/students/:studentId/payment` | Employee token |
| GET | `/students/:studentId/payments` | Employee token |

### 11.7 Forbidden (`/api/forbidden`)

| Method | Path | Access |
|---|---|---|
| GET | `/rules` | Employee token |
| POST | `/rules` | Employee token |
| PATCH | `/rules/:ruleId` | Employee token |
| DELETE | `/rules/:ruleId` | Employee token |
| GET | `/violations` | Employee token |
| POST | `/violations` | Employee token |
| DELETE | `/violations/:violationId` | Employee token |

### 11.8 Extra Lessons (`/api/extra-lessons`)

| Method | Path | Access |
|---|---|---|
| GET | `/support-teachers` | Employee + permission (`users:read`) |
| POST | `/support-teachers/:userId` | Employee + permission (`users:manage`) |
| DELETE | `/support-teachers/:userId` | Employee + permission (`users:manage`) |
| GET | `/availability` | Public |
| POST | `/book` | Student token |
| GET | `/my-lessons` | Student token |
| GET | `/requests` | Employee token |
| GET | `/` | Employee token |
| POST | `/` | Employee token |
| GET | `/:lessonId` | Employee token |
| PATCH | `/:lessonId` | Employee token |
| DELETE | `/:lessonId` | Employee token |
| PATCH | `/:lessonId/approve` | Employee + permission (`groups:read`) |
| PATCH | `/:lessonId/deny` | Employee + permission (`groups:read`) |
| PATCH | `/:lessonId/cancel` | Employee + permission (`groups:manage`) |
| PATCH | `/:lessonId/complete` | Employee + permission (`groups:read`) |
| POST | `/:lessonId/students` | Employee token |
| DELETE | `/:lessonId/students/:studentId` | Employee token |

### 11.9 Leads (`/api/leads`)

| Method | Path | Access |
|---|---|---|
| GET | `/` | Employee token |
| POST | `/` | Employee token |
| GET | `/:leadId` | Employee token |
| PATCH | `/:leadId` | Employee token |
| DELETE | `/:leadId` | Employee token |

---

## 12. Uploads and Public URLs

Upload storage:
- Local folder: `uploads/`

Upload middleware limits:
- Avatar:
  - field: `avatar`
  - types: JPG/PNG/WEBP
  - max size: 2 MB
- Lesson documents:
  - field: `document`
  - document-like formats (`pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `txt`, `csv`, `rtf`, `odt`, `ods`, `odp`, `zip`, `rar`)
  - max size: 25 MB
- Homework attachments:
  - field: `document`
  - lesson document types + images (`jpg`, `jpeg`, `png`, `webp`, `gif`)
  - max size: 25 MB

Public URL handling:
- `toPublicUrl()` returns absolute URLs when `PUBLIC_BASE_URL` or `BASE_URL` is configured.
- Otherwise URLs are derived from request host/protocol or kept as relative paths.

---

## 13. Error Contract

The app normalizes non-2xx JSON responses to:

```json
{
  "message": "Human-readable message",
  "code": "MACHINE_CODE",
  "field": null
}
```

Notes:
- Default `code` is inferred from HTTP status when not provided.
- `field` is set when validation can identify a specific field.
- 500 responses are masked as `"Internal server error"` in the global handler.

---

## 14. Testing

Run:

```bash
npm test
```

This executes:
- `scripts/smoke.test.js`
- `scripts/senior.test.js`

Coverage style:
- Syntax sanity checks
- Middleware behavior checks
- Controller behavior with patched model methods
- Core domain invariants (course/group/student/homework rules)

---

## 15. Operational Notes and Known Caveats

- Server startup sequence:
  - HTTP server starts immediately.
  - DB connects in background with retries.
  - If DB fails after all retries, server still listens but DB-backed endpoints fail until restart.

- Role seed behavior:
  - Default roles are upserted on every DB connect.
  - Seeder uses `$set` for permissions, so local manual edits may be overwritten on restart.

- Register route protection:
  - Route-level middleware for superadmin-only register is not currently mounted in `auth.routes.js`.
  - If production policy requires strict protection, add `requireAuth` + `requireRegisterPermission`.

- Student balance reset:
  - Scheduled helper exists in service, but auto-start is not wired from startup.
  - Controllers trigger reset checks opportunistically.

- Finance immutability:
  - `FinancialEvent` updates/deletes are blocked at model level.
  - Reversals are represented as compensating events.

- Swagger route docs:
  - Most endpoints are documented in route annotations.
  - Some implementation details (for example extra-lesson `/cancel`) may need swagger annotation updates if strict parity is required.

---

## 16. Frontend Integration

For frontend-oriented examples and integration notes, see:

- `README.frontend.md`

