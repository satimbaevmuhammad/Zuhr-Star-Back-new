# BackZuhr Backend API

BackZuhr is a backend for an education center that combines:

- CRM flows (lead capture and processing)
- LMS flows (courses, groups, lessons, homework)
- Operations (employee auth/roles, extra lesson booking, finance, violations)

The stack is Node.js + Express + MongoDB (Mongoose), with JWT authentication and Swagger docs.

## Table Of Contents

- [1. Core Capabilities](#1-core-capabilities)
- [2. Tech Stack](#2-tech-stack)
- [3. Architecture Overview](#3-architecture-overview)
- [4. Project Structure](#4-project-structure)
- [5. Quick Start](#5-quick-start)
- [6. Environment Variables](#6-environment-variables)
- [7. Authentication And Authorization](#7-authentication-and-authorization)
- [8. Domain Modules](#8-domain-modules)
- [9. API Endpoint Map](#9-api-endpoint-map)
- [10. Files And Uploads](#10-files-and-uploads)
- [11. Error Contract](#11-error-contract)
- [12. Tests](#12-tests)
- [13. Operational Notes](#13-operational-notes)

## 1. Core Capabilities

- Employee authentication with JWT access/refresh tokens
- Student authentication with separate JWT identity and token flow
- Dynamic RBAC roles with permission checks in middleware
- User and student management
- Course methodology management (courses -> lessons -> homework)
- Group management with attendance and student membership lifecycle
- Homework submission + grading with progression lock (previous lesson checks)
- Student grade visibility controls (own submissions + groupmates' graded results via scoped endpoint)
- Finance as append-only ledger events (salary updates, bonuses, fines)
- Forbidden-rule and employee-violation system with automatic financial impact
- Extra lesson booking system with strict slot scheduling (UTC+5 model)
- Leads CRUD for CRM pipeline
- Swagger OpenAPI docs and health endpoints

## 2. Tech Stack

- Runtime: Node.js (CommonJS modules)
- HTTP: `express@5`
- Database: MongoDB + `mongoose@9`
- Auth: `jsonwebtoken`, `bcrypt`
- File uploads: `multer`
- API docs: `swagger-jsdoc`, `swagger-ui-express`
- Cross-origin: `cors`
- Config: `dotenv`
- Testing style: Node scripts with assertions (`scripts/smoke.test.js`, `scripts/senior.test.js`)

## 3. Architecture Overview

- `index.js` starts HTTP server immediately, then connects to MongoDB with retry logic.
- `app.js` configures middleware, CORS, static files, Swagger docs, API routes, and error handling.
- Routes are organized by domain under `src/routes/`.
- Controllers under `src/controllers/` contain request validation and business logic.
- Mongoose schemas are split into:
  - `src/model/` for main domain models
  - `src/models/` for shared/support models (`Role`, `FinancialEvent`, `FaceCredential`)
- Services in `src/services/` provide reusable logic (course counts, finance summary, student balance reset).

High-level flow:

1. Request enters Express route.
2. Auth middleware validates token and user type (employee or student).
3. Permission middleware checks RBAC permissions/roles.
4. Controller validates payload and performs domain actions.
5. Response is normalized (especially error shape).

## 4. Project Structure

```text
BackZuhr/
|- index.js
|- app.js
|- package.json
|- README.md
|- README.frontend.md
|- public/
|  |- face-id-demo.html
|- uploads/
|- scripts/
|  |- smoke.test.js
|  |- senior.test.js
`- src/
   |- config/
   |  |- db.js
   |  `- swagger.js
   |- controllers/
   |- middleware/
   |- model/
   |- models/
   |- routes/
   |- seeders/
   |- services/
   `- utils/
```

## 5. Quick Start

### Prerequisites

- Node.js 18+ recommended
- MongoDB instance

### Install

```bash
npm install
```

### Configure

Create `.env` in project root (`BackZuhr`) and set at least:

```env
MONGO_URI=mongodb://localhost:27017/backzuhr
PORT=3000
JWT_SECRET=replace_with_a_strong_secret
```

### Run

```bash
node index.js
```

Useful URLs after startup:

- `GET /health`
- `GET /api-docs`
- `GET /api-docs-json`
- `GET /face-id-demo` (Face ID demo page)

## 6. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | Yes | - | MongoDB connection string |
| `PORT` | No | `3000` | HTTP server port |
| `JWT_SECRET` | Yes (or legacy fallback) | - | Primary signing secret for access/refresh tokens |
| `JWT_ACCESS_SECRET` | Legacy fallback | - | Used only if `JWT_SECRET` is missing |
| `JWT_REFRESH_SECRET` | Legacy fallback | - | Used only if `JWT_SECRET` is missing |
| `STRICT_REFRESH_TOKEN_MATCH` | No | `false` | If `true`, refresh token in DB must exactly match incoming token |
| `CORS_ORIGINS` | No | allow all | Comma-separated allow-list of origins |
| `CORS_ORIGIN` | No | allow all | Legacy alias for a single origin value |
| `PUBLIC_BASE_URL` | No | request-derived | Base URL for absolute file links |
| `BASE_URL` | No | request-derived | Fallback alias for `PUBLIC_BASE_URL` |
| `FACE_MATCH_THRESHOLD` | No | `0.45` | Face match threshold (0 < value <= 2) |
| `FACE_LOGIN_MAX_CANDIDATES` | No | `2000` | Max candidate records checked during face login (capped at 10000) |
| `STUDENT_BALANCE_RESET_INTERVAL_MS` | No | `3600000` | Interval for scheduled balance reset job helper |
| `STUDENT_BALANCE_RESET_MIN_GAP_MS` | No | `300000` | Throttle between reset checks |

## 7. Authentication And Authorization

### Two User Types

BackZuhr uses separate JWT identities:

- Employee token: `userType = "employee"`
- Student token: `userType = "student"`

This keeps employee/admin flows separate from student flows.

### Token TTL

- Employee access token: `24h`
- Employee refresh token: `7d`
- Student access token: `24h`
- Student refresh token: `7d`

### Auth Middleware

- `requireAuth` -> employee token only
- `requireStudentAuth` -> student token only
- `requireAnyAuth` -> employee or student token
- `allowRoles(...roles)` -> static role allow-list
- `allowPermissions(...perms)` -> checks dynamic role permissions from DB
- `allowPermissionsOrStudent(...perms)` -> employee must pass permissions, student is allowed
- `allowStudentSelfOrPermissions(...perms)` -> employee must pass permissions, student can only access own `:studentId`

### RBAC Defaults (Seeded On DB Connect)

Default role permissions are defined in `src/seeders/roles.seeder.js`:

- `teacher`: `profile:read`, `students:read`, `groups:read`
- `supporteacher`: `profile:read`, `students:read`, `groups:read`
- `headteacher`: teacher perms + `users:read`, `students:manage`, `groups:manage`
- `admin`: headteacher perms + `users:manage`, `users:manage_roles`
- `superadmin`: `*`

## 8. Domain Modules

### 8.1 Auth And Users

- Password login and token rotation
- Face ID login using 128-length descriptor vectors
- Face descriptors stored in separate `FaceCredential` collection
- Profile update includes avatar upload support
- Role management endpoints (including permission updates by role document)

### 8.2 Students

- Student CRUD and login
- Legacy plaintext student passwords are upgraded to bcrypt on successful login
- Student-group memberships tracked with status (`active`, `paused`, `completed`, `left`)
- Coin rewards endpoint
- Group links stay synchronized between `students.groups` and `groups.students`

### 8.3 Groups

- Group creation enforces odd/even scheduling patterns:
  - `odd` -> monday, wednesday, friday
  - `even` -> tuesday, thursday, saturday
- Group-to-course methodology attachment works in two modes:
  - Linked mode (`courseId` provided):
    - `courseRef` is set to the target course
    - `group.course` is normalized from `course.name`
    - `group.lessons` is auto-copied from `course.methodology`
  - Manual mode (`courseId` omitted, plain `course` name used):
    - `courseRef` is set to `null`
    - `group.lessons` stays empty and is managed manually (no methodology sync)
- On group update:
  - Sending `courseId` relinks the group and refreshes `group.lessons` from that course methodology
  - Sending only `course` (without `courseId`) detaches the group from the course and clears `group.lessons`
- Attendance logic:
  - Only allowed during scheduled lesson window
  - Date must be today
  - Only active group members can be marked
  - Balance is adjusted based on attendance status and monthly fee
- Computed fields returned in responses:
  - `studentsCount`
  - `coinBalance` (`studentsCount * 200`)

### 8.4 Courses And Lessons

- Course methodology model:
  - `course.methodology` stores lesson ObjectIds
  - duplicates are blocked
  - max methodology size is `durationMonths * 12`
- Lesson ordering model:
  - lessons are unique by `(course, order)`
  - lesson `order` is incremental within a course
- Methodology sync behavior:
  - `POST /courses/:courseId/lessons` creates a lesson, adds it to `course.methodology`, and adds the lesson to every `group.lessons` where `group.courseRef = courseId`
  - `DELETE /courses/:courseId/lessons/:lessonId` removes that lesson from both `course.methodology` and all linked groups
  - `POST /courses/:courseId/rebuild-methodology` rebuilds methodology from actual lessons (sorted by `order`) and force-syncs all linked groups' `lessons`
- Homework is attached directly to the lesson entity:
  - `lesson.homework` (description)
  - `lesson.homeworkLinks` (array of links)
  - `lesson.homeworkDocuments` (uploaded files)
- Homework can be attached/updated by staff through:
  - `POST /courses/:courseId/lessons` (when creating lesson)
  - `PATCH /courses/:courseId/lessons/:lessonId` (general lesson update)
  - `PATCH /courses/:courseId/lessons/:lessonId/homework` (homework-focused update)
  - `POST /courses/:courseId/lessons/:lessonId/homework/documents` (homework file attachments)

### 8.5 Homework

- Student access flow:
  - student calls `GET /homework/lessons/:lessonId`
  - system checks student is active in a matching group and enrolled in that lesson
  - if multiple matching active groups exist, `groupId` must be provided
- Homework unlock rule:
  - previous lessons in the same course/group that contain homework must already be approved
  - pass threshold is `score >= 70`
  - if blocked, API returns `isBlocked: true` and `blockedByLessonId`
- Submission model:
  - one submission per `(lesson, student)` (unique index)
  - student can resubmit until approved
  - once approved, resubmission is blocked
  - submission supports `description`, `links`, and file attachments
- Grading model:
  - score range: `0..100`
  - `score >= 70` -> `status = approved`
  - `score < 70` -> `status = submitted`
  - grading metadata includes `checkedBy` and `checkedAt`
- Grade visibility (important):
  - Student can see their own submission/score for a lesson through `GET /homework/lessons/:lessonId` (`submission.status`, `submission.score`, etc.)
  - Student can see graded homework scores of active groupmates in their own active group through `GET /homework/groupmates/grades`
  - Listing all submissions (`GET /homework/submissions`) and grading (`PATCH /homework/submissions/:submissionId/grade`) require employee auth
  - Non-admin employees are additionally scoped to groups where they are assigned teacher or support teacher

### 8.6 Finance

- Finance data is append-only via `FinancialEvent`
- Event types: `salary`, `salary_update`, `bonus`, `fine`
- Event updates/deletes are blocked at model level (immutable ledger behavior)
- Employee summary is aggregated from events:
  - latest salary
  - total bonuses
  - total fines
  - net/take-home estimate

### 8.7 Forbidden Rules And Violations

- Admin creates forbidden behavior rules with default fine amount
- Recording a violation:
  - creates `EmployeeViolation`
  - appends violation snapshot to `User.forbidens`
  - appends linked fine event (if fine > 0)
- Deleting a violation appends reversal finance event (negative fine)

### 8.8 Extra Lessons

- Dedicated booking module for extra support lessons
- Strict fixed slots in local UTC+5 time:
  - `14:00`, `15:10`, `16:20`, `17:30`, `18:40`
- Constraints:
  - max 5 lessons per teacher per day
  - max 3 students per lesson
  - max 3 designated support teachers globally
- Status lifecycle:
  - `pending_approval` -> `confirmed` -> `completed`
  - or `pending_approval` -> `cancelled`
- Public availability endpoint allows slot browsing without auth

### 8.9 Leads

- Basic CRM lead CRUD
- Source enum:
  - `INSTAGRAM`, `TELEGRAM`, `CALL_CENTER`, `WEBSITE`, `LANDING`, `FRIEND`
- Paginated list with search/filter support

## 9. API Endpoint Map

Base path prefix is `/api`.

### Auth (`/auth`)

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/login/face`
- `PATCH /auth/face`
- `DELETE /auth/face`
- `POST /auth/refresh-token`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/users`
- `GET /auth/roles`
- `PATCH /auth/roles/:roleId`
- `PATCH /auth/users/:userId/role`
- `PATCH /auth/users/:userId`
- `DELETE /auth/users/:userId`

### Students (`/students`)

- `POST /students/login`
- `POST /students/refresh-token`
- `GET /students`
- `POST /students`
- `GET /students/:studentId` (employee with permission or same student via student token)
- `PATCH /students/:studentId`
- `DELETE /students/:studentId`
- `GET /students/:studentId/groups` (employee with permission or same student via student token)
- `POST /students/:studentId/reward-coins`

### Groups (`/groups`)

- `GET /groups` (employee with permission or student token)
- `POST /groups`
- `GET /groups/:groupId` (employee with permission or student token)
- `PATCH /groups/:groupId`
- `DELETE /groups/:groupId`
- `GET /groups/:groupId/students` (employee with permission or student token)
- `POST /groups/:groupId/students/:studentId`
- `DELETE /groups/:groupId/students/:studentId`
- `POST /groups/:groupId/attendance`
- `PATCH /groups/:groupId/attendance/students/:studentId`

### Courses (`/courses`)

- `GET /courses` (employee with permission or student token)
- `POST /courses`
- `GET /courses/:courseId` (employee with permission or student token)
- `PATCH /courses/:courseId`
- `DELETE /courses/:courseId`
- `GET /courses/:courseId/lessons` (employee with permission or student token)
- `POST /courses/:courseId/lessons`
- `PATCH /courses/:courseId/lessons/:lessonId`
- `DELETE /courses/:courseId/lessons/:lessonId`
- `GET /courses/:courseId/lessons/:lessonId/documents` (employee with permission or student token)
- `DELETE /courses/:courseId/lessons/:lessonId/documents/:documentId`
- `GET /courses/:courseId/lessons/:lessonId/homework` (employee with permission or student token)
- `PATCH /courses/:courseId/lessons/:lessonId/homework`
- `POST /courses/:courseId/lessons/:lessonId/homework/documents`
- `DELETE /courses/:courseId/lessons/:lessonId/homework/documents/:documentId`
- `POST /courses/:courseId/rebuild-methodology`

### Homework (`/homework`)

- `GET /homework/lessons/:lessonId` (student token; returns that student's own submission summary)
- `GET /homework/lesson/:lessonId` (student token; backward-compatible alias of endpoint above)
- `POST /homework/lessons/:lessonId/submissions` (student token)
- `POST /homework/lesson/:lessonId/submissions` (student token; backward-compatible alias)
- `GET /homework/groupmates/grades` (student token; active groupmates' graded homework results)
- `GET /homework/submissions` (employee token; non-admin users limited to their own groups)
- `PATCH /homework/submissions/:submissionId/grade` (employee token; admin/headteacher/superadmin or assigned teacher/support teacher)

### Finance (`/finance`)

- `GET /finance/transactions`
- `DELETE /finance/transactions/:transactionId` (intentionally immutable flow)
- `GET /finance/employees`
- `GET /finance/employees/:employeeId`
- `PATCH /finance/employees/:employeeId/salary`
- `POST /finance/employees/:employeeId/bonus`
- `POST /finance/employees/:employeeId/fine`

### Forbidden (`/forbidden`)

- `GET /forbidden/rules`
- `POST /forbidden/rules`
- `PATCH /forbidden/rules/:ruleId`
- `DELETE /forbidden/rules/:ruleId`
- `GET /forbidden/violations`
- `POST /forbidden/violations`
- `DELETE /forbidden/violations/:violationId`

### Extra Lessons (`/extra-lessons`)

- `GET /extra-lessons/support-teachers`
- `POST /extra-lessons/support-teachers/:userId`
- `DELETE /extra-lessons/support-teachers/:userId`
- `GET /extra-lessons/availability`
- `POST /extra-lessons/book`
- `GET /extra-lessons/my-lessons`
- `GET /extra-lessons/requests`
- `GET /extra-lessons`
- `POST /extra-lessons`
- `GET /extra-lessons/:lessonId`
- `PATCH /extra-lessons/:lessonId`
- `DELETE /extra-lessons/:lessonId`
- `PATCH /extra-lessons/:lessonId/approve`
- `PATCH /extra-lessons/:lessonId/deny`
- `PATCH /extra-lessons/:lessonId/complete`
- `POST /extra-lessons/:lessonId/students`
- `DELETE /extra-lessons/:lessonId/students/:studentId`

### Leads (`/leads`)

- `GET /leads`
- `POST /leads`
- `GET /leads/:leadId`
- `PATCH /leads/:leadId`
- `DELETE /leads/:leadId`

## 10. Files And Uploads

- Uploaded files are stored in `uploads/`
- Static file serving:
  - `/uploads` -> uploaded files
  - `/public` -> public assets
- Upload middleware enforces file type and size:
  - avatar: image only, <= 2 MB
  - lesson/homework docs: <= 25 MB
- URL normalization can return absolute links when `PUBLIC_BASE_URL` is set

## 11. Error Contract

The API normalizes error responses to:

```json
{
  "message": "Human-readable message",
  "code": "MACHINE_CODE",
  "field": null
}
```

`AppError` + global middleware ensure consistent shape for validation and domain errors.

## 12. Tests

Run the included test scripts:

```bash
npm test
```

This executes:

- `scripts/smoke.test.js`
- `scripts/senior.test.js`

## 13. Operational Notes

- Server starts listening before DB connection is confirmed. If DB fails after retries, API process stays up but DB-backed endpoints fail until restart.
- Roles are seeded on DB connect with upsert + `$set`, so manual permission edits can be overwritten on next startup.
- Student balance reset helper exists as a service. In current codebase, reset checks are triggered from student/group controllers; scheduled job helper is present but not auto-started.
- Finance events are intentionally immutable. Reversals are modeled as compensating events, not deletes.
- Route `/api/auth/register` is currently not protected by `requireAuth`/`requireRegisterPermission` in `auth.routes.js`. If production policy requires superadmin-only registration, add the middleware guard.

---

For frontend-oriented API usage examples, see `README.frontend.md`.
