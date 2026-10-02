# CareFirst — Codebase Index

Healthcare platform (Pakistan, PKR) connecting patients, doctors, labs, lawyers and an admin. Core idea: lab tests paid in **installments**, with a 3-step receipt verification flow and automatic **legal escalation** of defaulters. Also a **community support** (charity) track for needy patients.

Two independent apps, no git, no tests, no monorepo tooling:

| Dir | Stack | Run |
|---|---|---|
| `carefirst-backend/` | Node (CommonJS), Express 4, Mongoose 7, Socket.IO 4, multer, node-cron, JWT | `npm run dev` (nodemon) → :5000 |
| `carefirst-web-modified/` | React 19, Vite 8, Tailwind 4 (auth pages only), mix of `.jsx` and `.tsx` | `npm run dev` → :5173, proxies `/api` and `/socket.io` to :5000 |

Env (`carefirst-backend/.env.example`): `PORT, MONGO_URI, JWT_SECRET, JWT_EXPIRES_IN, ADMIN_USERNAME, ADMIN_PASSWORD, CLIENT_URL, BASE_URL`.
Note: files live in OneDrive — some reads via shell can hang on cloud-only placeholders; use the Read tool.

## Backend (`carefirst-backend/`)

- `server.js` — wires middleware, routes, Socket.IO, 404 handler; on DB connect starts the cron job. Serves `uploads/` statically. No JSON error middleware (multer errors return Express's default HTML).
- `config/db.js` — Mongo connect + seeds one `admin` user if none exists.
- `middleware/auth.js` — `protect` (Bearer JWT → `req.user`), `requireRole(...roles)`, `requireActive` (status must be `active`). Routers use a `guard = [protect, requireRole(x), requireActive]` array.
- `middleware/upload.js` — multer disk storage into `uploads/{reports,receipts,community-docs}`; pdf/jpg/png, 10 MB. Only `uploadReport` is used.
- `socket/notificationSocket.js` — clients emit `join(userId)` to enter a room; server emits `notification:new`. `sendNotification(userId, doc)` is called from controllers/job. Room join is not authenticated.
- `jobs/defaulterJob.js` — daily 00:05 Asia/Karachi. Pending installments past due + 3 grace days with no receipt → `overdue`; first time escalates wallet to `defaulter`, creates `DefaulterCase` with generated legal text (`utils/legalAgreementTemplate.js`), assigns the active lawyer with fewest active cases, notifies lawyer/admins/patient.
- `utils/generateToken.js` — JWT `{id, role}`.
- `utils/cnic.js` (`normalizeCnic` → `#####-#######-#`), `utils/fileUrl.js` (`fileUrl(subfolder, filename)`, `removeUploadedFiles(req)` for rejected uploads), `utils/patientProfiles.js` (`withPatientDetails(docs)` adds cnic/city/address/cnicStatus onto populated `patient`).
- `server.js` ends with a JSON error handler (multer + body-parse errors → `{ message }` 400).

### Models (`models/`)
- `User` — `role: admin|lawyer|lab|doctor|patient`, `status: pending|active|rejected|suspended`; bcrypt pre-save hook, `comparePassword`.
- `PatientProfile` — unique `cnic`, city, address, `cnicStatus: unverified|verified|rejected` (+ reason/reviewedAt/By). Patients are `active` on signup; admin verifies the CNIC; verified CNIC is required for community support (and installments, Step 2).
- `DoctorProfile` (specialization, experience, fee, `availability[{day, slots[{time,isBooked}]}]`, bio, rating), `LabProfile` (labName, location, payment details, `isCharityPartner`, embedded `tests[]` with installment config: enabled/count/tenureDays ∈ {15,20,25,30}), `LawyerProfile`. Each 1:1 with User via `user`.
- `Wallet` — a patient's installment plan with a lab: totalAmount, downPayment, serviceFee, `installments[]` (receipt → `labApproved` → `adminVerified` → `paid`), guarantor, `status: active|completed|defaulter`. Pre-save recalculates `remainingBalance`.
- `DefaulterCase`, `CommunityApplication` (pending → approved with `slip.slipId` + assigned lab → `testConducted`), `Prescription` (doctor → patient, list of tests), `TestReport` (lab → patient file URL), `Notification` (typed enum, `meta` mixed).

### API (all JSON; mount prefix in parentheses)
- **auth** (`/api/auth`): `POST /register` (patient|lawyer|lab|doctor; patient needs `cnic` and starts `active`, providers start `pending`; creates role profile, rolls back User on failure; emails lowercased), `POST /login` (non-admin; must be `active`), `GET /me`.
- **patient** (`/api/patient`): profile get/put (CNIC editable until verified; change → `unverified`); `GET /prescriptions`; `GET /reports`, `PUT /reports/:id/read`; `GET /wallets`, `POST /wallets/:walletId/installments/:instIndex/receipt` (multipart `receipt`; replaceable until lab confirms; notifies lab); `GET|POST /community-applications` (multipart `testRequired` + `documents[]` ≤5; needs verified CNIC; one pending at a time; notifies admins); notifications incl. `read-all`.
- **admin** (`/api/admin`): `POST /login` (username/password compared to env, returns token for seeded admin user); registrations list/approve/reject (providers only); users list (paginated, role/status filters; patients include `profile`)/suspend/activate; `PUT /patients/:userId/cnic/verify|reject`; wallets list/get/`PUT wallets/:walletId/installments/:instIndex/verify`; `GET defaulter-cases`; community-applications list/approve (`assignedLabId`)/reject; notifications.
- **lab** (`/api/lab`): profile get/put; tests CRUD (`/tests/:testId`, embedded subdocs); `POST /reports/upload` (multipart field `report`, body `patientId, testName, notes`); `GET /reports`; `GET /receipts` + `PUT /receipts/:walletId/installments/:instIndex/approve`; needy-patients list + `PUT /:id/mark-conducted`; `GET /patients` (from wallets + community apps); notifications.
- **doctor** (`/api/doctor`): profile get/put; availability get/put; `PUT /fee`; prescriptions create/list; `GET /reports` (reports of patients this doctor prescribed for); notifications.
- **lawyer** (`/api/lawyer`): `GET /defaulter-cases[/:id]` (own cases only); notifications incl. `PUT /notifications/read-all` (declared before `/:id/read`).
- **public** (`/api/public`): `GET /tests` — active tests of active labs, grouped by lab; `GET /doctors` — active doctors with fee, rating, available days. No auth.
- `GET /api/health`.

Controller convention: one async function per endpoint, `try { ... } catch (err) { res.status(500).json({ message: err.message }) }`, errors as `{ message }`. Installments are addressed by array **index**, not id.

## Frontend (`carefirst-web-modified/src/`)

- `main.jsx` → `App.jsx`: **hand-rolled routing** on `window.location.pathname` (no router; navigation is `window.location.href = ...`). Routes: `/` landing, `/login`, `/signup`|`/sign-up`, `/forgot-password`, `/{admin,doctor,patient,lab,lawyer}-dashboard`. `wouter` is a dependency but only `ForgotPassword` uses it.
- `lib/api.js` — `api.get/post/put/delete/upload` over `fetch('/api' + path)`, throws `Error(data.message)` with `.status`; session in localStorage (`cf_token`, `cf_user`); `getDashboardPath(role)`; `formatCnic`.
- `lib/socket.js` — singleton `getSocket()`. Each dashboard emits `join` with the session user id and listens for `notification:new`.
- Landing page: `components/*.jsx` (Navbar, Hero, StatsBand, Features, HowItWorks, TestCatalog, Roles, Testimonials, CTABanner, LedgerSection, Footer, Shared) styled with inline styles + `theme/theme.jsx` (`T` tokens, `GLOBAL_CSS`, `IC` icons, `Logo`). `hooks/useReveal.js` for scroll reveal.
- Auth: `auth/pages/{Login,SignUp,ForgotPassword}.tsx` with shadcn-style `auth/components/ui/{button,input,label}.tsx`, Tailwind via `auth/index.css`. Vite alias `@` → `src/auth`. Login: identifier without `@` → admin login, else `/auth/login`. ForgotPassword is simulated (no backend).
- Dashboards: `pages/<Role>Dashboard.tsx` + matching `.css` and shared `DashboardBase.css`. Large single-file components, internal `currentPage` state for tabs, loose `any` typing.
  - Admin, Lab, Lawyer: wired to their APIs.
  - Doctor: wired, but falls back to `DUMMY_*` data when the API returns nothing.
  - Patient: fully wired to `/api/patient` + `/api/public` (dashboard, doctors, tests, reports + prescriptions, wallet receipts, community support, notifications, profile). Redirects to `/login` unless the session role is `patient`. Doctor/lab **booking** buttons are disabled placeholders (Step 3); True Cost toggle and TTS are not built yet (Step 4).
  - Admin Manage Users has a CNIC column with Verify/Reject and a "CNIC Review" filter.

## Known gaps (as of 2026-10-02)
- No endpoint creates wallets / installment plans yet (guarantor, agreement, admin plan approval, down payment & service fee verification) — Step 2. Until then `downPayment`/`serviceFee` `adminVerified` are never set, so wallets can't reach `completed`.
- Uploaded files (reports, receipts, community docs) are served publicly from `/uploads` with unguessable names but no auth.
- Doctors have no endpoint to look up patients for `createPrescription` (needs a raw `patientId`).
- `adminController.js` imports `{ v4 }` from `crypto` (doesn't exist; unused).
- `db.js` logs the default admin password.
