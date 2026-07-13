# Zuhr Star Backend

Zuhr Star Backend is the server-side API for an education-management platform. It is the central system used by staff to manage students, employees, courses, groups, attendance, homework, payments, discipline, extra lessons, leads, and rewards. Students use the same API through their own authentication flow to view learning material, submit homework, book extra lessons, join group meetings, and use reward coins in the shop.

The application is a REST API built with Express and MongoDB. It exposes Swagger documentation, serves uploaded files, uses JWT authentication, and can connect teachers' Google accounts to create Google Calendar events with Google Meet links.

## What the backend manages

The system has two primary audiences:

- Staff: teachers, support teachers, head teachers, administrators, and superadministrators.
- Students: learners who belong to one or more academic groups.

Staff access is role- and permission-based. Student access uses separate JWTs and only permits operations allowed for the authenticated student. Most staff resources require an employee bearer token; student-specific routes require a student bearer token.

## Technology stack

| Area | Technology |
| --- | --- |
| Runtime | Node.js, CommonJS |
| HTTP API | Express 5 |
| Database | MongoDB with Mongoose |
| Authentication | JSON Web Tokens and bcrypt |
| Authorization | Roles plus dynamic permissions stored in MongoDB |
| File uploads | Multer |
| API documentation | Swagger JSDoc and Swagger UI |
| Meetings | Google OAuth, Google Calendar API, Google Meet |
| Configuration | dotenv |

## Main capabilities

### Authentication and authorization

- Employee login, logout, access-token refresh, and profile retrieval.
- Student login and independent student-token refresh flow.
- JWT access and refresh tokens with token-type validation.
- Permission checks for protected staff endpoints.
- Seeded role definitions and permission metadata.
- Employee Face ID credential registration, update, removal, and login support.

### Employee management

- Authorized staff can create and update employee accounts.
- Employee records support personal details, roles, salary-related information, location, avatars, achievements, and Face ID enrollment.
- Employee finance data is derived from append-only financial events such as salary, bonuses, and fines.

### Student management

- Student creation, login, profile updates, retrieval, and deletion.
- Group membership tracking with active, paused, completed, and left states.
- Student monetary balance and reward coin balance.
- Student payment, discount, and payable-course-amount handling.
- Student homework and group membership associations.

### Courses, lessons, and groups

- Courses have a name, duration, price, methodology/lesson list, and group count.
- Lessons belong to courses and can contain descriptions, documents, homework text, homework links, and homework documents.
- Groups link a course to a teacher, support teachers, students, room, schedule, status, and attendance records.
- Groups use an `odd` or `even` pattern. Odd groups are scheduled Monday/Wednesday/Friday; even groups are scheduled Tuesday/Thursday/Saturday.
- Group-to-course links keep the course title, lesson list, and group count synchronized.

### Attendance and student billing

Attendance records support `present`, `absent`, `late`, and `excused` statuses. The attendance workflow keeps its existing membership checks, teacher schedule-window checks, teacher edit limits, and administrator bypass behavior.

`present` and `late` are currently billable statuses. For a billable attendance record, the per-lesson charge is calculated from the group schedule and the linked course:

```text
lessonsInCurrentMonth = number of scheduled group weekdays in this calendar month
lessonPrice = Course.price / lessonsInCurrentMonth
```

Changing a record from a non-billable status to a billable status deducts that lesson price. Changing it back credits the same amount. Student balances are intentionally allowed to become negative; the balance is not clamped to zero.

### Homework

- Teachers create homework through course lessons, including text, links, and documents.
- Students can retrieve homework for lessons in their active groups.
- Students submit a description, links, and/or one permitted attachment.
- Teachers, support teachers assigned to the group, and authorized administrators can list and review submissions.
- Students can see safe, limited grade information for active groupmates where the endpoint permits it.

#### Temporary rating workflow

Homework uses an informational **integer rating from 0 through 5**.

- Submit a rating through `PATCH /api/homework/submissions/:submissionId/grade` with `{ "score": 0 }` through `{ "score": 5 }`.
- Ratings never block access to a later lesson.
- A reviewed submission can still be updated by the student; review does not force a corrected upload.
- The previous 0–100, pass-score workflow is preserved in code but disabled by `HOMEWORK_GATING_ENABLED = false`.
- Temporary gating branches are labeled `TODO: Re-enable automatic homework gating` so that the former workflow can be restored intentionally later.

The submission `status` remains part of the backward-compatible response shape. During this temporary workflow, `approved` means that a teacher reviewed the work; it does not mean the student passed a threshold.

### Extra lessons

- Students can see available slots and book extra lessons.
- Support teachers can maintain availability and manage requests.
- Authorized staff can create, update, cancel, complete, and otherwise manage extra lessons.
- Extra lessons validate scheduling conflicts, daily limits, participating students, and lifecycle transitions.
- Completing a paid extra lesson can deduct the student balance, credit the teacher, and create finance events.

### Finance and discipline

- Financial events provide the audit trail for employee salary, salary updates, bonuses, fines, student payments, discounts, and extra-lesson payments.
- Employee finance summaries and monthly history are calculated from these events.
- Student payment records increase student balance; discounts update payable-course data.
- Forbidden behavior rules define violations and default fine amounts.
- Recording an employee violation creates the associated fine event. Deleting/reversing a violation follows the corresponding finance workflow rather than silently deleting audit data.

### Shop and rewards

- Staff can manage reward-shop inventory.
- Students can browse active items and purchase them with coins.
- Purchases have administrative delivery and cancellation workflows.
- Shop actions maintain purchase records and student coin balances.

### Leads

The lead module provides a small CRM workflow for admission and marketing leads, including contact details, source, referral data, descriptions, and notes.

### Google Meet

- A staff member connects a Google account through OAuth.
- The backend creates a Google Calendar event with Google Meet conference data.
- The active Meet event and URL are stored on the group.
- Authorized staff can end the group meeting, which removes the backing Calendar event and marks the group meeting ended.
- Enrolled students may retrieve the meeting information through the group Meet endpoint when authorized.

For the detailed Google Cloud setup, see [GOOGLE_MEET_SETUP.md](GOOGLE_MEET_SETUP.md).

## Project structure

```text
src/
  config/       # MongoDB and Swagger configuration
  controllers/  # request handlers and domain workflows
  middleware/   # auth, permissions, validation, upload, and error middleware
  model/        # primary Mongoose models
  models/       # role, finance-event, and face-credential models
  routes/       # Express routes and Swagger JSDoc annotations
  seeders/      # initial role and permission seeding
  services/     # course sync, finance, Google Calendar, balance reset logic
  utils/        # JWT, errors, and public-URL helpers
public/         # static Face ID test page
scripts/        # smoke and focused test suites
uploads/        # runtime-uploaded assets; this directory must be writable
app.js          # Express configuration and route mounting
index.js        # HTTP server startup and MongoDB connection
```

## Prerequisites

- Node.js 18 or newer.
- A MongoDB 6+ instance, local or hosted.
- Google OAuth credentials only if Google Meet integration is enabled.
- A writable `uploads/` directory.

## Installation and configuration

Install dependencies:

```bash
npm install
```

Create a `.env` file in the project root:

```env
# Server and database
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/zuhr-star

# JWT signing. JWT_SECRET is supported as a legacy fallback.
# Access and refresh tokens use the same configured signing secret.
JWT_ACCESS_SECRET=replace-with-a-long-random-secret

# Optional CORS and public upload URL configuration
CORS_ORIGINS=http://localhost:5173,http://localhost:3001
PUBLIC_BASE_URL=http://localhost:3000

# Optional Google Calendar / Google Meet configuration
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/oauth-callback
GOOGLE_CONNECT_SUCCESS_URL=http://localhost:5173/google-connected
GOOGLE_CONNECT_ERROR_URL=http://localhost:5173/google-error

# Optional balance-reset scheduling overrides
STUDENT_BALANCE_RESET_INTERVAL_MS=3600000
STUDENT_BALANCE_RESET_MIN_GAP_MS=300000
```

Start the server in development:

```bash
npm start
```

The application starts the HTTP server and connects to MongoDB in the background. Once MongoDB is connected, role data is seeded if necessary.

## API overview

| Module | Base path | Purpose |
| --- | --- | --- |
| Health | `/health` | Liveness endpoint returning `{ "status": "ok" }` |
| Swagger | `/api-docs`, `/api-docs-json` | Interactive and raw API documentation |
| Authentication | `/api/auth` | Employee accounts, login, refresh, Face ID, user administration |
| Students | `/api/students` | Student authentication, profiles, groups, and coin operations |
| Courses | `/api/courses` | Courses, lessons, documents, and lesson homework |
| Groups | `/api/groups` | Groups, memberships, attendance, and nested Meet routes |
| Homework | `/api/homework` | Student homework retrieval/submission and staff grading |
| Finance | `/api/finance` | Employee finance, transactions, student payments, and discounts |
| Discipline | `/api/forbidden` | Forbidden rules and employee violations |
| Extra lessons | `/api/extra-lessons` | Availability, booking, requests, lesson lifecycle |
| Leads | `/api/leads` | Lead CRM operations |
| Shop | `/api/shop` | Shop inventory, student purchases, and fulfillment |
| Google | `/api/google` | Google OAuth connect, callback, status, and disconnect |

Swagger is the authoritative source for route parameters, request bodies, response schemas, status codes, and required permissions. Open it locally at:

```text
http://localhost:3000/api-docs
```

## Authentication examples

Employee endpoints normally expect:

```http
Authorization: Bearer <employee-access-token>
```

Student-only endpoints use the student token returned by the student login flow:

```http
Authorization: Bearer <student-access-token>
```

Do not send an employee token to a student-only endpoint, or a student token to an employee-only endpoint. Middleware validates the token type as well as the signature.

## File uploads and static assets

The application accepts uploads for employee avatars, lesson documents, and homework attachments. Public asset URLs are served under `/uploads`; the static Face ID demo is available at `/face-id-demo`.

For production, treat uploads as persistent application data. Store them on durable, access-controlled storage or mount a persistent volume; container-local files are commonly lost during redeployment.

## Testing

Run all included automated checks:

```bash
npm test
```

The suite consists of an app-level smoke test and focused senior tests. It currently verifies:

- JWT generation, validation, refresh behavior, and permission middleware.
- Face ID credential registration and matching behavior.
- Student validation and coin rewards.
- Attendance date, time-window, and teacher modification rules.
- Finance calculation helpers and paid extra-lesson settlement.
- Google Meet controller behavior using mocked Google Calendar interactions.
- Course/group synchronization, lesson document handling, and model constraints.
- Balance-reset service throttling.

The tests deliberately mock MongoDB and Google services. They are not a replacement for a staging test with a disposable MongoDB database and real Google credentials. Before release, manually verify:

1. Upload and download of every supported file type.
2. End-to-end employee and student login/refresh/logout flows.
3. Google OAuth browser redirects and real Calendar event creation/deletion.
4. Attendance billing for each status transition and month boundary.
5. Concurrent shop purchases, student payments, and extra-lesson completion.
6. Authorization for every staff role and every student-facing endpoint.

## Production deployment checklist

- Use a managed MongoDB deployment with backups, restricted network access, and a least-privilege database user.
- Use a strong, unique JWT secret and keep `.env` files out of version control.
- Restrict `CORS_ORIGINS` to known frontend origins; do not rely on permissive defaults in production.
- Run behind HTTPS, preferably behind a reverse proxy that handles TLS and request limits.
- Use persistent storage for uploads and define retention/back-up rules.
- Configure Google redirect URIs exactly as registered in Google Cloud.
- Add application monitoring, error reporting, backups, and restore procedures.
- Review `npm audit` results and perform dependency upgrades through a tested release process.
- Never log connection strings, access tokens, refresh tokens, Google OAuth credentials, or other secrets.

## Useful local URLs

```text
Health:       http://localhost:3000/health
Swagger UI:   http://localhost:3000/api-docs
Swagger JSON: http://localhost:3000/api-docs-json
Face ID demo: http://localhost:3000/face-id-demo
```
