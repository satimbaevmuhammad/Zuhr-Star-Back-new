# BackZuhr Backend API

BackZuhr is a Node.js + Express + MongoDB backend for an education center. It is designed to handle the main school administration workflows in one place: student management, group scheduling, attendance, homework, finance, extra lessons, and CRM.

This README provides a full explanation of the architecture, key entities, authentication flows, API structure, configuration, and how to start working with the project.

## 1. What this project solves

The backend supports a school that needs to manage:

- Employee and student accounts separately
- Staff roles and access control for teachers, managers, and admins
- Student groups, courses, and lesson scheduling
- Attendance tracking and homework workflows
- Finance records, salary payments, bonuses, fines, and extra lesson billing
- Forbidden behavior rules and employee violation tracking
- Lead intake and CRM operations
- Extra lesson booking, approval, completion, and payment flows
- File uploads for avatars and documents
- Runtime API documentation via Swagger

The goal is to provide a single backend that makes the education center's operations auditable, rule-driven, and scalable.

## 2. High-level architecture

### 2.1 Server startup

- `index.js` boots the application.
- `app.js` configures Express middleware, routes, static file serving, Swagger docs, and error handling.
- Database connection is established in `src/config/db.js`.
- Role seeding runs on startup if required.

### 2.2 Request lifecycle

1. A request enters Express.
2. Middleware parses JSON, handles CORS, checks authentication, and validates IDs.
3. Routes are routed to controller handlers.
4. Controllers execute business logic using models and services.
5. Errors are normalized and returned with a consistent JSON shape.

### 2.3 Data storage

- MongoDB is the primary datastore.
- Mongoose schemas are defined in `src/model/` and `src/models/`.
- The backend uses a mix of direct model operations and transactional logic when available.

## 3. Key concepts and entities

### 3.1 Users vs Students

This system intentionally separates two account types:

- `User` — an employee or staff member.
- `Student` — a learner enrolled in groups, extra lessons, or CRM lead flows.

They have different authentication routes and different access patterns.

### 3.2 Roles and permissions

Staff roles are enforced at the API layer. Main roles include:

- `teacher`
- `supporteacher`
- `headteacher`
- `admin`
- `superadmin`

Role checks are performed by middleware and controller logic. Some actions are reserved for managers (`admin`, `superadmin`, `headteacher`) while others can be done by assigned teachers.

Permissions are loaded from the database and can be adjusted without code changes.

### 3.3 Courses, groups, and lessons

The domain model has a clear hierarchy:

- `Course` — a reusable course template.
- `Group` — a cohort of students attached to a course, with schedule rules and attendance.
- `Lesson` — a specific class session for a group.

This separation allows the app to manage both curriculum and delivery.

### 3.4 Homework

Homework records are attached to lessons and students. The backend supports:

- Assigning homework to a lesson or student
- Uploading homework documents
- Submitting homework
- Grading and status updates

### 3.5 Finance and audit

The finance module is designed to be audit-friendly:

- Financial records are append-only
- Salary payments, bonuses, fines, discounts, and extra lesson charges are recorded as events
- Records are not deleted to preserve history

This makes it easier to review past operations and resolve discrepancies.

### 3.6 Forbidden rules and employee violations

Employees can be assigned forbidden rules and tracked for violations.

- Rules are defined in `forbidden-rule.model.js`
- Violations are stored separately with references to employees and applied fines

This module supports behavior enforcement and HR workflows.

### 3.7 Extra lessons

Extra lessons are handled with a dedicated workflow for support teachers:

- Support teachers have a configurable work schedule
- Students can request a slot via booking
- Teachers review and approve or deny requests
- Confirmed lessons can be completed and paid for
- Payment is processed only after completion, respecting free quota rules

This flow is implemented in `src/controllers/extra-lesson.controller.js` and its supporting services.

### 3.8 Leads and CRM

Leads are potential clients who are not yet students.

- Leads can be created, updated, assigned, and tracked
- CRM workflows live in `lead.controller.js`
- Leads usually represent inquiries, potential enrollments, or sales pipelines

## 4. Authentication and authorization

### 4.1 Employee authentication

Employees log in through the staff auth routes. These routes issue access tokens and refresh tokens.

Typical flow:

- `POST /api/auth/login` — log in with employee credentials
- `POST /api/auth/refresh-token` — obtain a new access token using a refresh token
- `POST /api/auth/logout` — revoke refresh tokens

### 4.2 Student authentication

Students authenticate separately:

- `POST /api/students/login`

Student tokens are separate from employee tokens and do not share the same permissions.

### 4.3 JWT and token structure

Access tokens are JWTs. Example payload fields:

- `sub` — user ID
- `role` — staff role or `student`
- `userType` — `employee` or `student`
- `iat` — issued at
- `exp` — expiration

Headers should include:

```http
Authorization: Bearer <accessToken>
```

### 4.4 Authorization rules

- Only designated extra-lesson support teachers can manage their own support schedule.
- Only assigned teachers or managers can update lessons and student assignments.
- Only admin/headteacher roles can perform high-risk actions like deleting lessons or cancelling confirmed sessions.

## 5. API documentation

Swagger is available at:

- `GET /api-docs` — interactive Swagger UI
- `GET /api-docs-json` — OpenAPI JSON schema

These endpoints document the available routes and expected request/response shapes.

## 6. Error handling and validation

The API returns a consistent JSON error shape for all failures:

```json
{
  "message": "Invalid request data",
  "code": "BAD_REQUEST",
  "field": "date"
}
```

Common error codes:

- `BAD_REQUEST` — validation failure or missing input
- `NOT_FOUND` — resource not found
- `FORBIDDEN` — permission denied
- `UNAUTHORIZED` — missing or invalid authentication
- `CONFLICT` — entity conflict, duplicate entry, or invalid transition
- `INTERNAL_SERVER_ERROR` — unexpected server failure

## 7. File uploads and static assets

- Uploaded files are stored in `/uploads`
- Static assets are served from `/public`
- Avatars and other upload routes are handled with `multer`
- A Face ID demo page is available at `GET /face-id-demo`

## 8. Running locally

### Install dependencies

```bash
npm install
```

### Set environment variables

Create a `.env` file with at least the required values:

```env
MONGO_URI=mongodb://localhost:27017/backzuhr
PORT=3000
JWT_SECRET=replace_with_a_long_secret
```

### Start the server

```bash
node index.js
```

### Run tests

```bash
npm test
```

## 9. Environment variables

| Name | Required | Default | Description |
|---|---|---|---|
| `MONGO_URI` | yes | n/a | MongoDB connection string |
| `PORT` | no | `3000` | HTTP port |
| `JWT_SECRET` | yes | n/a | JWT signing secret |
| `JWT_ACCESS_SECRET` | no | n/a | optional access token secret |
| `JWT_REFRESH_SECRET` | no | n/a | optional refresh token secret |
| `CORS_ORIGINS` | no | allow all | allowed CORS origins |
| `CORS_ORIGIN` | no | allow all | single-origin fallback |
| `PUBLIC_BASE_URL` | no | derived | public URL used for uploaded files |
| `BASE_URL` | no | derived | fallback base URL |
| `FACE_MATCH_THRESHOLD` | no | `0.45` | face login similarity threshold |
| `FACE_LOGIN_MAX_CANDIDATES` | no | `2000` | maximum face match candidates |

## 10. Project structure

```text
BackZuhr/
├── index.js
├── app.js
├── package.json
├── README.md
├── README.frontend.md
├── public/
│   └── face-id-demo.html
├── uploads/
├── scripts/
│   ├── smoke.test.js
│   └── senior.test.js
└── src/
    ├── config/
    │   ├── db.js
    │   └── swagger.js
    ├── controllers/
    ├── middleware/
    ├── model/
    ├── models/
    ├── routes/
    ├── seeders/
    ├── services/
    └── utils/
```

### 10.1 Core folders

- `src/controllers/` — request handlers and business logic
- `src/routes/` — API endpoints and route wiring
- `src/model/` — Mongoose schema definitions for domain entities
- `src/models/` — shared models such as `Role`, `FaceCredential`, and `FinancialEvent`
- `src/services/` — reusable business operations, such as finance processing
- `src/middleware/` — authentication, validation, file upload, and error handling
- `src/config/` — database and Swagger configuration
- `src/seeders/` — initial data seeding

## 11. Important implementation notes

### 11.1 Extra lesson scheduling

Extra lessons use a local schedule and fixed-time slots. The system converts local slots into UTC dates for storage and comparison.

### 11.2 Teacher daily limits

The app enforces a teacher daily capacity limit based on schedule slots. This prevents overbooking.

### 11.3 Transaction support

Where possible, the app uses MongoDB sessions and transactions. If the database does not support transactions, it falls back to non-transactional processing.

### 11.4 Data validation

The controllers include strict validation for:

- dates in `YYYY-MM-DD` format
- time slots in `HH:mm` format
- MongoDB ObjectId strings
- required fields for each operation

## 12. Frontend integration

For frontend-specific guidance, request examples, and authentication details, refer to `README.frontend.md`.

## 13. How to extend this backend

- Add new routes in `src/routes/`
- Add handlers in `src/controllers/`
- Add schema changes in `src/model/`
- Add business utilities in `src/services/`
- Use `src/utils/` for shared helpers and error creation

## 14. Contact points in code

- `app.js` — Express app setup and middleware chain
- `index.js` — server bootstrap
- `src/config/db.js` — MongoDB connection and seeding
- `src/controllers/auth.controller.js` — employee auth logic
- `src/controllers/extra-lesson.controller.js` — extra lesson booking workflow
- `src/controllers/finance.controller.js` — finance event creation
- `src/middleware/auth.middleware.js` — token validation and role enforcement

---

BackZuhr is built to be maintainable and extensible. Use this README as the starting point for onboarding frontend and backend developers, and refer to `README.frontend.md` for API usage patterns.
