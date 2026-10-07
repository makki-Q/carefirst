# CareFirst — File-to-Feature Index

Which files make up each feature, and how a request travels from the screen to the database.
This document maps files only; rules and decisions are in [`PROJECT_GUIDE.md`](../PROJECT_GUIDE.md).

**How to read it**
- Paths are relative to the repo root. `BE` = `carefirst-backend/`, `FE` = `carefirst-web-modified/src/`.
- `name:123` = function or page section at that line, as of commit `7dfea82` (2026-10-07). Line numbers drift as the code changes; search for the name when they're off.
- The five dashboards are single large files, so a frontend "file" is often a **page section** inside one: `FE/pages/PatientDashboard.tsx › myWallet:2312` means the `<section>` shown when `currentPage === 'myWallet'`.
- Every role router applies `guard = [protect, requireRole(role), requireActive]` from `BE/middleware/auth.js`. That is left out of the tables below.

## Feature list

| # | Feature | Main roles |
|---|---|---|
| 1 | [Shared foundation (server, auth middleware, uploads, API client)](#1-shared-foundation) | all |
| 2 | [Registration, login & account approval](#2-registration-login--account-approval) | all, admin |
| 3 | [Patient profile & CNIC verification](#3-patient-profile--cnic-verification) | patient, admin |
| 4 | [Notifications (in-app + real-time)](#4-notifications-in-app--real-time) | all |
| 5 | [Doctor profile, availability & appointments](#5-doctor-profile-availability--appointments) | doctor, patient |
| 6 | [Prescriptions](#6-prescriptions) | doctor, patient |
| 7 | [Lab profile, branches & test catalogue](#7-lab-profile-branches--test-catalogue) | lab, patient |
| 8 | [Lab visits (bookings)](#8-lab-visits-bookings) | patient, lab |
| 9 | [Lab reports & report sharing](#9-lab-reports--report-sharing) | lab, patient, doctor |
| 10 | [Automatic report summary](#10-automatic-report-summary) | lab, patient, doctor |
| 11 | [Urdu translation & audio (TTS)](#11-urdu-translation--audio-tts) | patient, lab, doctor, lawyer |
| 12 | [True Cost Analysis](#12-true-cost-analysis) | patient |
| 13 | [Installment plan application (CNIC pictures + agreement)](#13-installment-plan-application) | patient |
| 14 | [Installment agreement — the stamp paper](#14-installment-agreement--the-stamp-paper) | patient, lab, admin, lawyer |
| 15 | [Plan review, service fee & activation](#15-plan-review-service-fee--activation) | admin, patient |
| 16 | [Receipt chain: down payment & installments](#16-receipt-chain-down-payment--installments) | patient, lab, admin |
| 17 | [Lab finance: Installment Plans page & earnings](#17-lab-finance-installment-plans-page--earnings) | lab |
| 18 | [Due-soon reminders](#18-due-soon-reminders) | patient |
| 19 | [Defaulters: escalation, restriction & lawyer cases](#19-defaulters-escalation-restriction--lawyer-cases) | patient, lawyer, admin |
| 20 | [Community Support (needy patients, partner labs)](#20-community-support) | patient, admin, lab |
| 21 | [PDF slips](#21-pdf-slips) | patient, doctor, lab, admin |
| 22 | [Admin overview, monthly reports & settings](#22-admin-overview-monthly-reports--settings) | admin |
| 23 | [Landing page](#23-landing-page) | public |
| 24 | [Demo data, Faisalabad dataset & tests](#24-demo-data-faisalabad-dataset--tests) | developers |

---

## 1. Shared foundation

**Purpose:** what every feature runs on: the Express/Socket.IO server, database connection, JWT guards, file uploads, error handling, and the browser-side API client and routing.

| Layer | File | Role |
|---|---|---|
| Server | `BE/server.js` | Middleware, mounts `/api/*` routers, serves `/uploads`, `/api/health`, 404 + JSON error handler; on DB connect starts the cron job and the startup backfills |
| Config | `BE/config/db.js` | Mongo connect; seeds the `admin` user |
| Config | `BE/.env.example` | Every env variable |
| Middleware | `BE/middleware/auth.js` | `protect:4` (Bearer JWT → `req.user`), `requireRole:23`, `requireActive:31` |
| Middleware | `BE/middleware/upload.js` | multer: `uploadReport`, `uploadReceipt`, `uploadCommunityDoc` (→ `BE/uploads/…`, public), `uploadCnicPictures` (→ private `CNIC_DIR`) |
| Utils | `BE/utils/generateToken.js` | JWT `{id, role}` |
| Utils | `BE/utils/fileUrl.js` | `fileUrl`, `removeUploadedFiles` (clean up a rejected upload) |
| Utils | `BE/utils/patientProfiles.js` | `withPatientDetails` — adds CNIC / city / address to populated patients (used by admin, lab, doctor, lawyer lists) |
| Frontend | `FE/main.jsx`, `FE/App.jsx` | Hand-rolled routing on `window.location.pathname` |
| Frontend | `FE/lib/api.js` | `api.get/post/put/delete/upload`, session in localStorage, `downloadFile`, `downloadSlip` |
| Frontend | `FE/components/Dialog.tsx` | `confirmDialog` / `alertDialog` (used by every dashboard) |
| Frontend | `FE/components/BrandLogo.tsx` | Sidebar logo |
| Styles | `FE/pages/DashboardBase.css`, `FE/pages/<Role>Dashboard.css`, `FE/pages/HideScrollbars.css` | Shared and per-role dashboard styles |
| Build | `carefirst-web-modified/vite.config.js`, `index.html` | `@` alias → `src/auth`, `/api` + `/socket.io` proxy to :5000; Google Fonts |

**End to end:** browser → `api.js` adds `Authorization: Bearer <cf_token>` → Vite proxy → `server.js` → `routes/<role>.js` (guard, optional multer) → `controllers/<role>Controller.js` → Mongoose `models/` → MongoDB. Errors come back as `{ message }` and `api.js` throws them as `Error` objects with `.status`.

---

## 2. Registration, login & account approval

**Purpose:** sign up (patients are active at once; doctors, labs and lawyers wait for the admin), log in, and let the admin approve, reject, suspend or reactivate accounts.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/auth.js` | `POST /register`, `POST /login`, `GET /me` |
| Route | `BE/routes/admin.js` | `POST /login`, `/registrations…`, `/users…` |
| Controller | `BE/controllers/authController.js` | `register:10` (creates the User + role profile, rolls back on failure), `login:79`, `getMe:116` |
| Controller | `BE/controllers/adminController.js` | `adminLogin:44`, `getRegistrations:68`, `approveRegistration:91`, `rejectRegistration:111`, `getUsers:132`, `suspendUser:171`, `activateUser:182` |
| Models | `BE/models/User.js` | role, status, bcrypt hook, `comparePassword` |
| Models | `BE/models/PatientProfile.js`, `DoctorProfile.js`, `LabProfile.js`, `LawyerProfile.js` | 1:1 role profiles created at signup |
| Utils | `BE/utils/cnic.js` | `normalizeCnic` (patient signup) |
| Utils | `BE/utils/labBranches.js` | `ensureBranch` — the first branch for a new lab |
| Frontend | `FE/auth/pages/SignUp.tsx`, `Login.tsx`, `ForgotPassword.tsx` (simulated) | Auth pages (Tailwind) |
| Frontend | `FE/auth/components/ui/{button,input,label}.tsx`, `FE/auth/lib/utils.ts`, `FE/auth/index.css` | shadcn-style UI |
| Frontend | `FE/pages/AdminDashboard.tsx › registrations:717`, `› users:838` | Approve / reject providers; Manage Users (search, role filter, suspend / activate) |
| Frontend | `FE/lib/api.js` | `setSession`, `getDashboardPath(role)` |

**End to end:**
1. SignUp → `POST /api/auth/register` → `User` + `<Role>Profile` saved. A patient becomes `active` and gets a token; a provider starts `pending`.
2. Admin → Registrations → `PUT /api/admin/registrations/:id/approve|reject` → `User.status` changes → `registration_approved|rejected` notification.
3. Login → identifier without `@` → `POST /api/admin/login` (compared with `.env`), otherwise `POST /api/auth/login` → JWT stored as `cf_token` → redirect to `/<role>-dashboard`.

---

## 3. Patient profile & CNIC verification

**Purpose:** the patient keeps their CNIC, city and address. The admin verifies or rejects the CNIC. A verified CNIC unlocks Community Support.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/patient.js` | `GET/PUT /profile` |
| Route | `BE/routes/admin.js` | `PUT /patients/:userId/cnic/verify|reject` |
| Controller | `BE/controllers/patientController.js` | `getProfile:161` (+ defaulter `restriction`), `updateProfile:176` (a CNIC change → `unverified`; locked once verified or while a plan is under review) |
| Controller | `BE/controllers/adminController.js` | `verifyPatientCnic:193`, `rejectPatientCnic:220` |
| Model | `BE/models/PatientProfile.js` | `cnic` (unique), `cnicStatus`, reason, reviewer |
| Utils | `BE/utils/cnic.js` | Format check |
| Frontend | `FE/pages/PatientDashboard.tsx › profile:2795`, `loadProfile:237` | Profile form, CNIC status pill |
| Frontend | `FE/pages/AdminDashboard.tsx › users:838` | CNIC column, "CNIC Review" filter, Verify / Reject |

**End to end:** Profile → `PUT /api/patient/profile` → `PatientProfile` (status `unverified`) → admin Manage Users → `PUT /api/admin/patients/:id/cnic/verify` → `cnicStatus: verified` → `cnic_verified` notification. Approving an installment plan also verifies the CNIC (feature 15).

---

## 4. Notifications (in-app + real-time)

**Purpose:** each role gets a notification list. New ones arrive live over Socket.IO, and dashboards reload their data when they do.

| Layer | File | Role |
|---|---|---|
| Socket | `BE/socket/notificationSocket.js` | `initSocket` (room `join(userId)`, not authenticated), `sendNotification(userId, doc)` → emits `notification:new` |
| Model | `BE/models/Notification.js` | `NOTIFICATION_TYPES` enum (32 types), `read`, `meta` |
| Routes | `BE/routes/{patient,doctor,lab,lawyer,admin}.js` | `GET /notifications`, `PUT /notifications/:id/read`; patient + lawyer also `PUT /notifications/read-all` |
| Controllers | `patientController.js` `getNotifications:922`, `markRead:934`, `markAllRead:948`; `doctorController.js` `getNotifications:274`, `markRead:315`; `labController.js` `getNotifications:826`, `markRead:838`; `lawyerController.js` `getNotifications:87`, `markRead:99`, `markAllRead:112`; `adminController.js` `getNotifications:661`, `markNotificationRead:673` | |
| Senders | local `notify` / `notifyUser` / `notifyAdmins` helpers in each controller, `BE/utils/defaulters.js`, `BE/jobs/defaulterJob.js`, `BE/utils/reportPipeline.js` | Create the `Notification` document and call `sendNotification` |
| Frontend | `FE/lib/socket.js` | `getSocket()` singleton |
| Frontend | each `FE/pages/<Role>Dashboard.tsx` | `join` + `notification:new` listener; Patient `› notifications:2749`, Lawyer `› notifications:635`; Admin, Lab and Doctor in a top-bar bell dropdown (`showNotifDropdown`) |

**End to end:** a controller or the job saves a `Notification` → `sendNotification` emits to room `<userId>` → the dashboard's listener adds it to the list and reloads the data it affects (receipts, plans, bookings…).

---

## 5. Doctor profile, availability & appointments

**Purpose:** doctors set their profile, clinic, fee, weekly hours and consultation length. Patients book free slots in the next 14 days (confirmed at once). Either side can cancel; the doctor closes the visit as completed or no-show.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/doctor.js` | `/profile`, `/availability`, `/fee`, `/appointments…`, `/patients` |
| Route | `BE/routes/patient.js` | `GET/POST /appointments`, `PUT /appointments/:id/cancel` |
| Route | `BE/routes/public.js` | `GET /doctors:56`, `GET /doctors/:doctorId/slots:138` (inline handlers) |
| Controller | `BE/controllers/doctorController.js` | `getProfile:28`, `updateProfile:38`, `getAvailability:56`, `updateAvailability:72`, `updateFee:99`, `getAppointments:180`, `cancelAppointment:196`, `closeAppointment:227` → `completeAppointment` / `markNoShow:244`, `getPatients:249` |
| Controller | `BE/controllers/patientController.js` | `enrichAppointments:568`, `getAppointments:594`, `bookAppointment:607`, `cancelAppointment:670` |
| Models | `BE/models/DoctorProfile.js`, `BE/models/Appointment.js` | Availability ranges, `consultationDuration`; appointment with a unique partial index (doctor + date + time while `confirmed`) |
| Utils | `BE/utils/schedule.js` | `slotTimes`, `freeSlots`, `pktDate`, `pktInstant`, `isWithinBookingWindow`, `PATIENT_CANCEL_HOURS` |
| Utils | `BE/utils/slips.js` | `withSlipNumber` plugin gives each appointment an `AP-` number |
| Frontend | `FE/pages/PatientDashboard.tsx` | `› findDoctors:1457`, `› bookAppointment:1736` (`loadSlots:391`), `› appointments:1896` (`cancelMyAppointment:423`) |
| Frontend | `FE/pages/DoctorDashboard.tsx` | `› dashboard:513`, `› availability:674`, `› appointments:784`, `› patients:893`, `› profile:1083` |

**End to end:** Find Doctors → `GET /api/public/doctors` → choose a day → `GET /api/public/doctors/:id/slots` (availability × duration minus confirmed bookings) → `POST /api/patient/appointments` → `Appointment` saved (the index rejects double booking → 409) → `appointment_booked` sent to both sides. Cancel → `PUT …/cancel` → `status: cancelled` frees the slot. The doctor's `complete` / `no-show` → `status` changes.

---

## 6. Prescriptions

**Purpose:** after an appointment has started, the doctor prescribes tests (one prescription per appointment). The patient sees them and can jump to labs offering each test.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/doctor.js` | `POST/GET /prescriptions` |
| Route | `BE/routes/patient.js` | `GET /prescriptions` |
| Controller | `BE/controllers/doctorController.js` | `createPrescription:120`, `getPrescriptions:162` |
| Controller | `BE/controllers/patientController.js` | `getPrescriptions:223`; prescriptions also attached in `enrichAppointments:568` |
| Model | `BE/models/Prescription.js` | doctor, patient, `appointment`, `tests[]`, notes |
| Frontend | `FE/pages/DoctorDashboard.tsx › prescribe:925` | Pick a started appointment; test names suggested from `GET /api/public/tests` |
| Frontend | `FE/pages/PatientDashboard.tsx › myReports:2176`, `› appointments:1896` | Prescription list; "Find labs" → `findLabsFor:480` → Book Tests filtered |

**End to end:** Prescribe → `POST /api/doctor/prescriptions` (checks the appointment has started and is not cancelled / no-show) → `Prescription` → `prescription_issued` → patient `GET /api/patient/prescriptions`.

---

## 7. Lab profile, branches & test catalogue

**Purpose:** a lab chain manages its branches (address, hours, map pin), tests (price, category, which branches, installment settings) and its own payment details. Patients browse all of it.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/lab.js` | `/profile`, `/branches…`, `/tests…` |
| Route | `BE/routes/public.js` | `GET /tests:17` (active tests of active labs, grouped by lab, with branches) |
| Controller | `BE/controllers/labController.js` | `getProfile:20`, `updateProfile:30` (payment details, single-branch pin), `getTests:62`, `addTest:86`, `updateTest:113`, `deleteTest:143`, `getBranches:297`, `addBranch:308`, `updateBranch:327`, `deleteBranch:352` |
| Model | `BE/models/LabProfile.js` | `branches[]`, `tests[]` (installment config + `branches[]`), payment details, charity flags |
| Utils | `BE/utils/labBranches.js` | `offersTest`, `branchesOffering`, `branchView`, `cleanBranchInput`, `ensureBranch`, `backfillLabBranches` (startup) |
| Utils | `BE/utils/installmentPlan.js` | `hasPaymentDetails`, `labPaymentDetails`, `capInstallmentCounts` (startup) |
| Config | `BE/config/installments.js` | `MIN_INSTALLMENTS` / `MAX_INSTALLMENTS` (test installment settings are validated in `labController.js` around `:80`) |
| Frontend | `FE/components/LabBranches.tsx` | Branches page (cards + add / edit form) |
| Frontend | `FE/components/MapPicker.tsx` | Leaflet map pin + `currentPosition()` |
| Frontend | `FE/pages/LabDashboard.tsx` | `› branches:1056` (renders `LabBranches`), `› catalog:1072` (test table, "Offered at", Payment Details form) |
| Frontend | `FE/pages/PatientDashboard.tsx` | `› bookTests:1543` (one card per lab), `› labTests:1688` (one lab's tests) |

**End to end:** the lab edits → `POST/PUT /api/lab/tests|branches` → embedded subdocuments in `LabProfile` → patients read `GET /api/public/tests` → Book Tests cards. Deleting a branch switches off tests offered only there; renaming one updates open bookings.

---

## 8. Lab visits (bookings)

**Purpose:** the patient books a test visit for a day and a branch, paying at the lab or through an installment plan. The lab moves it through sample collected → completed. Visits can change branch or be cancelled.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/patient.js` | `GET/POST /lab-bookings`, `PUT /lab-bookings/:id/cancel`, `PUT /lab-bookings/:id/branch` |
| Route | `BE/routes/lab.js` | `GET /bookings`, `PUT /bookings/:id/sample-collected|complete|transfer`, `GET /patients` |
| Controller | `BE/controllers/patientController.js` | `getLabBookings:713`, `bookLabTest:725` (picks the branch, checks the plan), `changeLabBranch:802`, `cancelLabBooking:839` |
| Controller | `BE/controllers/labController.js` | `findBookings:381`, `getBookings:388`, `advanceBooking:398` → `markSampleCollected` / `completeBooking:429`, `transferBooking:435`, `getLabPatients:800` |
| Model | `BE/models/LabBooking.js` | snapshot of test / price / branch, `paymentMethod`, `wallet`, `status`, `transfers[]`, `report` |
| Utils | `BE/utils/labBranches.js`, `BE/utils/schedule.js`, `BE/utils/slips.js` (`LB-` number) | |
| Frontend | `FE/pages/PatientDashboard.tsx` | `› bookLabTest:1806` (day chips, branch list, pay method), `› appointments:1896` (lab visits, `cancelLabVisit:470`, "Change branch…") |
| Frontend | `FE/pages/LabDashboard.tsx › requests:748` | **Bookings** page: slip check, "Working at" branch, Take visit here / Move to…, Sample collected / Upload report / Mark completed |

**End to end:** `POST /api/patient/lab-bookings` → `LabBooking` (`confirmed`, `LB-` slip number, branch snapshot; `wallet` when paid by plan) → `lab_booking_created` → lab `PUT …/sample-collected` → uploading a report for the booking completes it (feature 9). Branch moves → `transfers[]` + `lab_booking_updated`.

---

## 9. Lab reports & report sharing

**Purpose:** the lab uploads a report file (on its own or for a booking). The patient reads it and chooses which visited or booked doctors may see it.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/lab.js` | `POST /reports/upload` (`uploadReport.single('report')`), `GET /reports`, `PUT /reports/:id/summary` |
| Route | `BE/routes/patient.js` | `GET /reports`, `PUT /reports/:id/read`, `GET /report-doctors`, `PUT /reports/:id/share`, `DELETE /reports/:id/share/:doctorId` |
| Route | `BE/routes/doctor.js` | `GET /reports` |
| Controller | `BE/controllers/labController.js` | `uploadReport:161`, `getReports:473`, `updateReportSummary:236` |
| Controller | `BE/controllers/patientController.js` | `getReports:244`, `shareableDoctorIds:258`, `getReportDoctors:263`, `shareReport:281`, `unshareReport:314`, `markReportRead:330` |
| Controller | `BE/controllers/doctorController.js` | `getReports:287` (only reports shared with this doctor) |
| Model | `BE/models/TestReport.js` | file URL, `booking`, summaries, `autoRead`, `sharedWith[]` |
| Storage | `BE/uploads/reports/` | Report files (served publicly by `/uploads`) |
| Frontend | `FE/pages/LabDashboard.tsx › upload:870` | Upload form (choose a booking or a patient), Recent Reports |
| Frontend | `FE/pages/PatientDashboard.tsx › myReports:2176` | Report list, share bar (`shareReportWith:894`, `shareBar:912`) |
| Frontend | `FE/pages/DoctorDashboard.tsx › reports:988` | Patient Reports (shared only) |

**End to end:** the lab uploads → multer writes `uploads/reports/<file>` → `TestReport` saved (the linked booking → `completed`) → `test_report_uploaded` to the patient → background reading (feature 10). Share → `PUT /api/patient/reports/:id/share` → `sharedWith.push` → `report_shared` to the doctor → the doctor's `GET /api/doctor/reports` now includes it.

---

## 10. Automatic report summary

**Purpose:** every uploaded report is read automatically (Azure Document Intelligence). Results are compared with the printed ranges, and the patient gets an English + Urdu summary of what is out of range.

| Layer | File | Role |
|---|---|---|
| Utils | `BE/utils/reportPipeline.js` | `processReport:21`, `processReportInBackground:75` — runs read → interpret → summary, stores `autoRead`, notifies |
| Utils | `BE/utils/reportReader.js` | `readReport:80` (2-page PDF pieces `pdfPieces:50`, image shrink `prepareImage:65`), `docIntelConfigured` |
| Utils | `BE/utils/reportInterpreter.js` | `interpretReport:267` (table / text rows, ranges, bands, sex) |
| Utils | `BE/utils/reportSummary.js` | `summarizeReport:84`, `urduName:59` (fixed English + Urdu templates) |
| Controller | `BE/controllers/labController.js` | `uploadReport:161` starts it; `readReportAgain:278` (`POST /reports/:id/read-again`) |
| Model | `BE/models/TestReport.js` | `autoRead {status, kind, findings[] …}`, `summary`, `summaryUrdu`, sources |
| Frontend | `FE/pages/PatientDashboard.tsx › myReports:2176` | Flagged results, summary + Listen, "see your doctor" box |
| Frontend | `FE/pages/LabDashboard.tsx › upload:870` | Reading status + Read again |
| Frontend | `FE/pages/DoctorDashboard.tsx › reports:988` | Out-of-range chips |
| Tests | `BE/tests/reportInterpreter.test.js` (`npm run test:unit`); `BE/tests/e2e.js` "Automatic report summary" `:1398` | |
| Samples | `lab-reports/` (gitignored, real data) | Reader development only |

**End to end:** `uploadReport` → `processReportInBackground(reportId)` → `readReport(file)` → Azure Document Intelligence (`prebuilt-layout`) → `interpretReport` → `summarizeReport` → `TestReport.autoRead` + `summary` / `summaryUrdu` (`source: auto`) → `report_summary_ready` to the patient. A summary written by the lab always takes priority.

---

## 11. Urdu translation & audio (TTS)

**Purpose:** Urdu versions of report summaries (Azure Translator; the lab can correct them) and of the agreement, read aloud with Azure Speech. Access is checked per document.

| Layer | File | Role |
|---|---|---|
| Config | `BE/config/azure.js` | Keys, regions, endpoints, voices, `SPEECH_*` chunking, audio cache directory |
| Utils | `BE/utils/azure.js` | `translateToUrdu:10`, `urduAudioFile:36` (chunks → MP3, cached in `BE/storage/audio/`) |
| Route | `BE/routes/tts.js` | `GET /status`, `POST /` |
| Controller | `BE/controllers/ttsController.js` | `agreementText:14`, `reportText:31`, `previewAgreementText:44`, `speak:60` (access check → audio stream) |
| Controller | `BE/controllers/labController.js` | `uploadReport:161` (translates the lab's summary), `updateReportSummary:236` (Urdu correction / re-translate) |
| Utils | `BE/utils/agreementPaper.js` | `agreementTextUr`, `agreementSpeech` (text for the agreement audio) |
| Frontend | `FE/components/Urdu.tsx` | `UrduText` (RTL Nastaliq), `ListenButton` (POST `/api/tts`, Uzma / Asad) |
| Frontend | used in `PatientDashboard.tsx` (`› applyPlan`, `› myWallet`, `› myReports`, `› appointments`), `LabDashboard.tsx › upload`, `DoctorDashboard.tsx › reports`, `LawyerDashboard.tsx › caseDetail` | |

**End to end:** Listen → `POST /api/tts {source, id, voice}` → `speak` loads the wallet / report and checks the user may see it (otherwise 404) → builds the Urdu text on the server → `urduAudioFile` (cache hit, or Azure Speech pieces joined) → `audio/mpeg` streamed to the browser. The browser never sends free text.

---

## 12. True Cost Analysis

**Purpose:** add round-trip travel cost (road distance × rate per km for the chosen way of travelling) to the test price, using the nearest branch of each lab.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/public.js` | `GET /true-cost:93` (inline handler) |
| Config | `BE/config/travel.js` | `TRAVEL_MODES` + rates, `OSRM_URL` |
| Utils | `BE/utils/travel.js` | `routeDistances:26` (one OSRM table request; straight line × 1.3 fallback), `haversineKm`, `isLatLng` |
| Utils | `BE/utils/labBranches.js` | Branch pins (`branches[].coordinates`) |
| Frontend | `FE/pages/PatientDashboard.tsx › bookTests:1543` | Location / map pin, travel mode chips, per-lab km / minutes / cost, Best value (request at `:322`) |
| Frontend | `FE/components/MapPicker.tsx` | Patient pin + `currentPosition()` |

**End to end:** the patient switches it on → browser location or a dropped pin (never stored) → `GET /api/public/true-cost?lat&lng&mode` → `routeDistances` → OSRM → nearest branch per lab with km, minutes and `travelCost` → the patient side adds the test price and sorts.

---

## 13. Installment plan application

**Purpose:** a patient applies to pay an installment-enabled test in parts: guarantor details, both addresses, four CNIC pictures, then reading and accepting the agreement. The plan waits for the admin (`pending_approval`).

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/patient.js` | `GET /installment-plans/config`, `POST /installment-plans/preview`, `POST /installment-plans` (`notRestricted`, `uploadCnicPictures`) |
| Controller | `BE/controllers/patientController.js` | `buildPlanApplication:80` (checks + terms), `getInstallmentConfig:360`, `previewInstallmentPlan:385`, `applyForInstallmentPlan:407` |
| Middleware | `BE/middleware/upload.js` | `uploadCnicPictures` → private `BE/storage/cnic/` |
| Model | `BE/models/Wallet.js` | Plan terms, `guarantor`, `cnicPictures`, `agreement {text, textUrdu, data, acceptedAt}` |
| Config | `BE/config/installments.js` | Fee, down-payment %, `MAX_OPEN_PLANS` |
| Utils | `BE/utils/installmentPlan.js` | `OPEN_PLAN_STATUSES`, `planAmounts`, `splitInstallments`, `hasPaymentDetails` |
| Utils | `BE/utils/agreementPaper.js` | `agreementData`, `agreementTextEn` / `Ur`, `paperFields` (feature 14) |
| Utils | `BE/utils/platformSettings.js` | CareFirst account shown in the config |
| Frontend | `FE/pages/PatientDashboard.tsx` | `› bookTests:1543` / `› labTests:1688` "Installments" button → `› applyPlan:2047` (`submitPlanApplication:557`, `loadPlanConfig:272`) |
| Frontend | `FE/components/CnicPictures.tsx` | `CnicPicturePicker`, `checkCnicPicture` |
| Frontend | `FE/components/AgreementPaper.tsx`, `FE/components/Urdu.tsx` | Agreement preview (English / Urdu + Listen) |

**End to end:** Apply page → `POST /api/patient/installment-plans/preview` (terms + agreement) → the patient accepts → multipart `POST /api/patient/installment-plans` (`data` JSON + 4 pictures) → the server rebuilds the agreement and compares it word for word (409 if the terms changed) → `Wallet` saved (`pending_approval`, pictures in `storage/cnic/`) → `plan_submitted` to admins.

---

## 14. Installment agreement — the stamp paper

**Purpose:** the agreement is the lab stamp-paper picture with its blanks filled in. It is shown in the browser, offered as a PDF download, given in Urdu, and read aloud.

| Layer | File | Role |
|---|---|---|
| Utils | `BE/utils/agreementPaper.js` | `agreementData:39`, `liveFor:54`, `paperFields:107`, `agreementTextEn:187`, `agreementTextUr:233`, `agreementSpeech:281`, `buildAgreementPdf:285`, `bookingsFor:314`, `withAgreementPaper:322` |
| Assets | `BE/assets/agreement-stamp-paper.jpeg`, `FE/assets/agreement-stamp-paper.jpeg`, originals in `agreement/` | The picture (1024 × 1536) |
| Route | `BE/routes/documents.js` | `GET /agreements/:walletId` |
| Controller | `BE/controllers/documentController.js` | `getAgreementPdf:59` (patient, the plan's lab, admin, assigned lawyer) |
| Controllers using it | `patientController.js` (`getWallets:346`, preview / apply), `adminController.js` (`enrichWallets:30`), `lawyerController.js`, `ttsController.js` | Add `agreementPaper` / `agreementUrdu`, or the Urdu speech text |
| Lab side | `labController.js › getInstallmentPlans:604` | Only sets `hasAgreementPdf`; the lab downloads the PDF from `/api/documents` |
| Legacy | `BE/utils/legalAgreementTemplate.js` | `generateLegalAgreement` — the **legal notice** for the lawyer (feature 19), not the agreement |
| Frontend | `FE/components/AgreementPaper.tsx` | Draws the fields over the picture; Download PDF |
| Frontend | `PatientDashboard.tsx › applyPlan:2047`, `› myWallet:2312`; `AdminDashboard.tsx › wallets:1117` ("CNICs & agreement"); `LawyerDashboard.tsx › caseDetail:410`; `LabDashboard.tsx › plans:1467` (PDF) | |

**End to end:** `agreementData` is fixed when the patient applies (`wallet.agreement.data`) → on every read `liveFor(wallet, booking)` adds the live details (acceptance, approval, due dates, paid ticks, visit date) → `paperFields` produces positioned text → the browser (`AgreementPaper.tsx`) or `buildAgreementPdf` (pdf-lib) draws it over the same picture.

---

## 15. Plan review, service fee & activation

**Purpose:** the admin approves or rejects an application after comparing the CNIC pictures. The patient pays CareFirst's service fee and uploads a screenshot. When the admin verifies it, the plan becomes `active` and the schedule is generated.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/admin.js` | `GET /wallets`, `GET /wallets/:id`, `PUT /wallets/:id/approve|reject`, `PUT /wallets/:id/service-fee/verify|reject` |
| Route | `BE/routes/patient.js` | `GET /wallets`, `POST /wallets/:walletId/service-fee/receipt` (`uploadReceipt`) |
| Route | `BE/routes/documents.js` | `GET /wallets/:walletId/cnic/:picture` |
| Controller | `BE/controllers/adminController.js` | `getWallets:277`, `getWalletById:300`, `approvePlan:314` (also verifies the CNIC), `rejectPlan:361`, `verifyServiceFee:392` (→ `active` + `buildSchedule`), `rejectServiceFee:442` |
| Controller | `BE/controllers/patientController.js` | `getWallets:346`, `uploadServiceFeeReceipt:523` |
| Controller | `BE/controllers/documentController.js` | `getCnicPicture:31` (owner, admin, assigned lawyer; `no-store`) |
| Model | `BE/models/Wallet.js` | `status`, `serviceFee`, `planApprovedAt/By`, `rejection*`, `activatedAt`, `downPayment`, `installments[]` |
| Utils | `BE/utils/installmentPlan.js` | `buildSchedule:52` |
| Utils | `BE/utils/platformSettings.js` | Account the fee is paid to |
| Storage | `BE/uploads/receipts/` | Screenshots |
| Frontend | `FE/pages/AdminDashboard.tsx › wallets:1117` | Applications → Service Fees → payments to verify → all plans |
| Frontend | `FE/pages/PatientDashboard.tsx › myWallet:2312` | Status banners, service-fee card (`uploadReceipt:369`) |
| Frontend | `FE/components/CnicPictures.tsx` | `CnicPictureGallery` (fetches the private pictures with the token) |

**End to end:** `pending_approval` → admin `approve` → `awaiting_fee` (+ CNIC `verified`, `plan_approved`) → the patient uploads the fee screenshot → `service_fee_uploaded` → admin `service-fee/verify` → `active`, `downPayment` + `installments[]` with due dates → `plan_activated` to the patient and the lab.

---

## 16. Receipt chain: down payment & installments

**Purpose:** the patient pays the lab directly and uploads proof. The lab confirms the money arrived, then the admin verifies. Either can reject with a reason. The installment becomes `paid` and the balance drops.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/patient.js` | `POST /wallets/:walletId/installments/:instIndex/receipt`, `POST /wallets/:walletId/down-payment/receipt` (`uploadReceipt.single('receipt')`) |
| Route | `BE/routes/lab.js` | `GET /receipts`, `PUT /receipts/:walletId/(installments/:instIndex|down-payment)/approve|reject` |
| Route | `BE/routes/admin.js` | `PUT /wallets/:walletId/(installments/:instIndex|down-payment)/verify|reject` |
| Controller | `BE/controllers/patientController.js` | `uploadPaymentReceipt:474` |
| Controller | `BE/controllers/labController.js` | `getReceiptsPendingApproval:486`, `approveReceipt:513`, `rejectReceipt:561` |
| Controller | `BE/controllers/adminController.js` | `verifyInstallment:473`, `rejectLabPayment:517` |
| Utils | `BE/utils/installmentPlan.js` | `findLabPayment:62` (one handler for both routes), `labPaymentDetails` |
| Utils | `BE/utils/defaulters.js` | `clearDefaultIfPaid` (after verifying on an escalated plan) |
| Model | `BE/models/Wallet.js` | `receiptUrl`, `labApproved`, `adminVerified`, `rejectionReason/At/By`, pre-save `remainingBalance`, `isFullyPaid()` |
| Storage | `BE/uploads/receipts/` | |
| Frontend | `FE/pages/PatientDashboard.tsx › myWallet:2312` | Down-payment card, schedule, receipt log (`uploadReceipt:369`) |
| Frontend | `FE/pages/LabDashboard.tsx › receipts:1652` | Approve / Reject |
| Frontend | `FE/pages/AdminDashboard.tsx › wallets:1117` | Verify / Reject |

**End to end:** upload → `receiptUrl` set, rejection cleared → `receipt_uploaded` to the lab → lab approve → `labApproved` → `receipt_lab_approved` → admin verify → `adminVerified`, installment `paid` → `receipt_admin_verified`; when everything is paid the wallet becomes `completed`. A rejection → `receipt_rejected` and the receipt is cleared.

---

## 17. Lab finance: Installment Plans page & earnings

**Purpose:** the lab sees every activated plan with its money (collected, remaining, overdue, next due) and what it received this month on CareFirst.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/lab.js` | `GET /installment-plans`, `GET /earnings` |
| Controller | `BE/controllers/labController.js` | `paymentState:596`, `getInstallmentPlans:604`, `getEarnings:670` |
| Models | `BE/models/Wallet.js`, `BE/models/LabBooking.js` | Plans; completed at-lab visits |
| Frontend | `FE/pages/LabDashboard.tsx` | `› plans:1467` (totals, table, schedule, agreement PDF), `› revenue:1309`, `› dashboard:636` ("Received This Month") |

**End to end:** `GET /api/lab/installment-plans` → wallets of this lab in `active|defaulter|completed` + linked visits → per-payment `state` → table. `GET /api/lab/earnings` → down payments / installments the lab confirmed + completed `at_lab` visits for this and last month (Pakistan months).

---

## 18. Due-soon reminders

**Purpose:** remind patients 3 days and 1 day before each installment is due.

| Layer | File | Role |
|---|---|---|
| Job | `BE/jobs/defaulterJob.js` | `runDueReminders:135` (run after the defaulter check by `startDefaulterJob:175`, daily 00:05 PKT) |
| Config | `BE/config/installments.js` | `REMINDER_DAYS` [3, 1] |
| Model | `BE/models/Wallet.js` | `installments[].remindersSent` |
| Frontend | patient notifications | `installment_due_soon` |

**End to end:** cron → `active` wallets → pending installments with no receipt → due in 3 / 1 Pakistan days and not already sent → `Notification` + socket → `remindersSent` updated.

---

## 19. Defaulters: escalation, restriction & lawyer cases

**Purpose:** installments overdue past the 3 grace days escalate the plan to the least-loaded lawyer. The patient is restricted to paying until the overdue installments are verified, or until the lawyer closes the case as settled.

| Layer | File | Role |
|---|---|---|
| Job | `BE/jobs/defaulterJob.js` | `runDefaulterCheck:11` (overdue → `defaulter`, creates / updates `DefaulterCase`, assigns the lawyer, notifies), `startDefaulterJob:175` |
| Utils | `BE/utils/defaulters.js` | `restrictionFor:20`, `notRestricted:32` (route guard, 403), `clearDefaultIfPaid:46` |
| Utils | `BE/utils/legalAgreementTemplate.js` | `generateLegalAgreement` — the legal notice text on the case |
| Route | `BE/routes/lawyer.js` | `GET /` (alias), `GET /defaulter-cases[/:id]`, `PUT /defaulter-cases/:id/close` |
| Route | `BE/routes/admin.js` | `GET /defaulter-cases` |
| Route | `BE/routes/patient.js` | `notRestricted` on booking, plan preview / apply, community |
| Controller | `BE/controllers/lawyerController.js` | `withLabNames:11`, `getDefaulterCases:25`, `getDefaulterCaseById:38`, `closeCase:57` |
| Controller | `BE/controllers/adminController.js` | `getDefaulterCases:558`, `getUsers:132` (`isDefaulter`), `verifyInstallment:473` (→ `clearDefaultIfPaid`) |
| Controller | `BE/controllers/patientController.js` | `getProfile:161` (returns `restriction`) |
| Models | `BE/models/DefaulterCase.js`, `BE/models/Wallet.js` (`status: defaulter`, `installments[].status: overdue`, `settledOffline`) | |
| Frontend | `FE/pages/PatientDashboard.tsx` | `LOCKED_WHEN_RESTRICTED:51`, red banner, `› myWallet:2312` |
| Frontend | `FE/pages/LawyerDashboard.tsx` | `› defaulters:282` (Open / Closed, stats), `› caseDetail:410` (agreement, CNIC pictures, "Close this case") |
| Frontend | `FE/pages/AdminDashboard.tsx` | `› defaulters:1413` (Restricted / Cleared / All), Defaulter tag in `› users:838` |

**End to end:** cron → pending installment past due + 3 days with no receipt → `overdue` → wallet `defaulter` + `DefaulterCase` (`active`, legal notice, lawyer) → `defaulter_escalated` to the lawyer, admins and patient → `notRestricted` blocks new bookings / plans / community → the patient pays the overdue installments through feature 16 → the admin verifies the last one → `clearDefaultIfPaid` → plan `active` / `completed`, case `resolved: paid` → `defaulter_cleared`. Or the lawyer's `close` → installments `settledOffline`, case `resolved: settled`.

---

## 20. Community Support

**Purpose:** a patient in need (verified CNIC) applies with documents. The admin approves and assigns a partner lab, which does the test free and marks it conducted. Labs join or leave the programme themselves. No money goes through CareFirst.

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/patient.js` | `GET/POST /community-applications` (`notRestricted`, `uploadCommunityDoc.array('documents', 5)`) |
| Route | `BE/routes/admin.js` | `GET /community-applications`, `PUT …/:id/approve|reject`, `GET /partner-labs` |
| Route | `BE/routes/lab.js` | `GET /needy-patients`, `PUT /needy-patients/:id/mark-conducted`, `PUT /community-support` |
| Controller | `BE/controllers/patientController.js` | `getCommunityApplications:868`, `createCommunityApplication:881` |
| Controller | `BE/controllers/adminController.js` | `getCommunityApplications:576`, `approveCommunityApplication:593` (partner labs only, `CS-` slip), `rejectCommunityApplication:632`, `getPartnerLabs:249` |
| Controller | `BE/controllers/labController.js` | `getNeedyPatients:649`, `setCommunitySupport:723`, `markTestConducted:768` |
| Models | `BE/models/CommunityApplication.js`, `BE/models/LabProfile.js` (`isCharityPartner`, `charityPartnerSince`) | |
| Utils | `BE/utils/slips.js` (`newSlipNumber`) | |
| Storage | `BE/uploads/community-docs/` | |
| Frontend | `FE/pages/PatientDashboard.tsx › community:2630` (`submitCommunityApplication:599`, `loadCommunity:261`) | |
| Frontend | `FE/pages/AdminDashboard.tsx › donations:956` (sidebar "Community Support") | Applications + Partner Labs |
| Frontend | `FE/pages/LabDashboard.tsx › needyPatients:1377` | Join / Leave card, needy patient list, Slip + documents |

**End to end:** apply → documents to `uploads/community-docs/` → `CommunityApplication` (`pending`) → `community_submitted` to admins → admin approve with a partner lab → `approved`, `slip.slipId` `CS-…` → `community_approved` → lab `mark-conducted` → `testConducted`. Join / leave → `LabProfile.isCharityPartner` → `community_partner_joined|left` to admins.

---

## 21. PDF slips

**Purpose:** a downloadable one-page slip for appointments, lab visits and approved community applications, with a unique number the doctor or lab can look up.

| Layer | File | Role |
|---|---|---|
| Utils | `BE/utils/slips.js` | `SLIP_PREFIX`, `newSlipNumber`, `withSlipNumber` (Mongoose plugin on `Appointment` / `LabBooking`), `backfillSlipNumbers` (startup) |
| Utils | `BE/utils/slipPdf.js` | `buildSlipPdf:163` (`drawSlipPage:47`, `appendDocuments:133` for community documents) |
| Asset | `BE/assets/carefirst-logo.png` | Logo on the slip |
| Route | `BE/routes/documents.js` | `GET /slips/appointment/:id`, `/slips/lab-booking/:id`, `/slips/community/:id` |
| Controller | `BE/controllers/documentController.js` | `getAppointmentSlip:125`, `getLabBookingSlip:177`, `getCommunitySlip:228` (+ `patientRows`, `labRows`, `branchRows`, `sendPdf`) |
| Frontend | `FE/lib/api.js` | `downloadSlip(kind, id)` |
| Frontend | `PatientDashboard.tsx › appointments:1896`, `› community:2630`; `DoctorDashboard.tsx › appointments:784`; `LabDashboard.tsx › requests:748`, `› needyPatients:1377`; `AdminDashboard.tsx › donations:956` | Slip buttons, "Check a slip number…" |

**End to end:** a new booking → plugin sets `slipNumber` → Slip button → `GET /api/documents/slips/<kind>/:id` (access per role; cancelled → 409) → `buildSlipPdf` → PDF attachment → `downloadFile` saves it.

---

## 22. Admin overview, monthly reports & settings

**Purpose:** real totals on the admin home page, a month-by-month activity report, and the platform settings (the CareFirst account that receives service fees, and the support e-mail).

| Layer | File | Role |
|---|---|---|
| Route | `BE/routes/admin.js` | `GET /overview`, `GET /reports?month=`, `GET/PUT /settings` |
| Controller | `BE/controllers/adminInsightsController.js` | `getOverview:134`, `getReports:89` (`monthMetrics:53`, `verifiedPayments:30`), `getSettings:176`, `updateSettings:189` |
| Model | `BE/models/PlatformSettings.js` | Single document `key: 'platform'` |
| Utils | `BE/utils/platformSettings.js` | `getPlatformSettings` (saved values, otherwise `.env`) — also read by patient installment config |
| Frontend | `FE/pages/AdminDashboard.tsx` | `› dashboard:586`, `› reports:1485`, `› settings:1557` |

**End to end:** dashboard → `GET /api/admin/overview` (counts across `User`, `Appointment`, `LabBooking`, `Wallet`… + latest activity; reloads on every admin notification). Settings → `PUT /api/admin/settings` → `PlatformSettings` → shown to patients on the service-fee card.

---

## 23. Landing page

**Purpose:** the public marketing page at `/`. It is static: no API calls, and its figures are written into the components.

| Layer | File |
|---|---|
| Page | `FE/App.jsx` (composes the sections) |
| Sections | `FE/components/{Navbar,Hero,StatsBand,Features,HowItWorks,TestCatalog,Roles,Testimonials,LedgerSection,CTABanner,Footer,Shared}.jsx` |
| Theme | `FE/theme/theme.jsx` (`T` tokens, `GLOBAL_CSS`, `IC` icons, `Logo`), `FE/hooks/useReveal.js` |
| Static | `carefirst-web-modified/public/{favicon.svg,icons.svg}` |

---

## 24. Demo data, Faisalabad dataset & tests

**Purpose:** fill a database for demos and check every feature through the API.

| Area | File | Role |
|---|---|---|
| Demo seed | `BE/scripts/seed.js` (`npm run seed`) | **Wipes** the DB + uploads, creates accounts in every workflow state |
| Dataset import | `BE/scripts/import-dataset.js` (`npm run import:dataset`) | Upserts `dataset/clean/*.csv` (5 lab chains, 28 doctors) |
| Dataset build | `dataset/scripts/{collect-lab-branches,collect-lab-prices,prepare-labs,prepare-doctors}.js`, `dataset/raw/*.csv`, `dataset/*_public.csv`, `dataset/README.md` | How `dataset/clean/` was made (not run by the app) |
| Startup backfills | `BE/utils/labBranches.js › backfillLabBranches`, `BE/utils/slips.js › backfillSlipNumbers`, `BE/utils/installmentPlan.js › capInstallmentCounts` | Bring older data up to date (`server.js`) |
| API test | `BE/tests/e2e.js` (`npm run test:e2e`) | Sections by feature, see below |
| Unit test | `BE/tests/reportInterpreter.test.js` (`npm run test:unit`) | Report reader layouts |

`tests/e2e.js` sections → features: Health & registration `:222`, Admin login & approvals `:258`, Logins & guards `:278` (2) · Patient profile & CNIC review `:304` (3) · Lab catalog, doctor, prescriptions, reports `:339` (6, 7, 9) · Doctor appointments `:387`, cancellation & closing `:451` (5) · Prescriptions from appointments `:504` (6) · Sharing reports `:524` (9) · Community support `:556` (20) · Installment receipt chain `:641` (16) · Installment plan application `:702` (13, 14) · Admin review, service fee & activation `:810` (15) · Down payment & plan completion `:934` (16) · Lab bookings `:989`, booking chain `:1039` (8) · True Cost Analysis `:1081` (12) · Defaulter escalation `:1136` (19) · Urdu agreement and report summaries `:1271` (11, 14) · Automatic report summary `:1398` (10) · CNIC pictures for the lawyer `:1478` (15, 19) · Slips `:1494` (21) · Due-soon reminders `:1567` (18) · Admin dashboard, reports & settings `:1607` (22) · Lab branches `:1678` (7, 8) · Notifications & error handling `:1761` (4).

---

## Model → features

| Model (`BE/models/`) | Features |
|---|---|
| `User` | 2, and every feature (owner / role) |
| `PatientProfile` | 2, 3, 13, 15, 20 |
| `DoctorProfile` | 2, 5, 21 |
| `LabProfile` | 2, 7, 8, 12, 16, 17, 20 |
| `LawyerProfile` | 2, 19 |
| `Appointment` | 5, 6, 9 (who can be shared with), 21, 22 |
| `Prescription` | 6 |
| `LabBooking` | 8, 9, 14 (visit date), 17, 21, 22 |
| `TestReport` | 9, 10, 11 |
| `Wallet` | 13–19, 22 |
| `DefaulterCase` | 19 (+ access checks in 11, 14, 15) |
| `CommunityApplication` | 20, 21 |
| `Notification` | 4 |
| `PlatformSettings` | 22 (+ 13, 15 via `getPlatformSettings`) |
