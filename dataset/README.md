# CareFirst dataset (Faisalabad)

Data used to fill CareFirst with real Faisalabad labs and doctors for the demo and evaluation.

## Files

| File | What | Where it comes from |
|---|---|---|
| `faisalabad_doctors_public.csv` | 33 doctors (name, specialty, experience, rating, clinic address, phone) | Collected by the team from public Oladoc / InstaCare listings, 2026-10-02 |
| `faisalabad_lab_tests_public.csv` | First lab sample (2 chains, 11 tests) | Team, 2026-10-02 — **replaced** by the files below, kept for reference |
| `raw/instacare_lab_branches.csv` | Faisalabad branches of each lab chain + approximate map pin | `scripts/collect-lab-branches.js` |
| `raw/instacare_lab_prices.csv` | Each chain's test prices (discounted and regular) | `scripts/collect-lab-prices.js` |
| `clean/lab_chains.csv`, `clean/lab_branches.csv`, `clean/lab_tests.csv` | The lab files CareFirst imports | `scripts/prepare-labs.js` (from the raw files) |
| `clean/doctors.csv` | 28 doctors CareFirst imports | `scripts/prepare-doctors.js` (from `faisalabad_doctors_public.csv`) |

The original files are never changed: the scripts write new files next to them.

## Re-running

```bash
node dataset/scripts/collect-lab-branches.js   # ~1 minute
node dataset/scripts/collect-lab-prices.js     # ~40 minutes (one page at a time)
node dataset/scripts/prepare-labs.js           # instant
node dataset/scripts/prepare-doctors.js        # instant
```

## Importing into CareFirst

```bash
cd carefirst-backend
npm run import:dataset    # into the database in MONGO_URI (.env)
```

Adds the 5 lab chains (one account each, with their Faisalabad branches and tests) and the 28 doctors as
active accounts, password `password123`:

- labs: `<chain_id>@labs.carefirst.test`, e.g. `chughtai-lab@labs.carefirst.test`, `idc@labs.carefirst.test`
  (ids in `clean/lab_chains.csv`)
- doctors: `<first.middle.last>@doctors.carefirst.test` (title and "Dr." left out), e.g.
  `hafiz.muhammad.junaid@doctors.carefirst.test` — the import prints the first few

Nothing is deleted. Running it again updates the same accounts (matched by e-mail), branches and tests (matched
by name), so existing bookings keep their branch. Imported tests are offered at every branch of the chain; a lab
can limit a test to some branches in its Test Catalog. Run it after `npm run seed` (the seed wipes the database).

## How the data is collected (rules we keep)

- **Sources:** InstaCare public pages — each chain's Faisalabad page (branches) and each chain's test pages
  (`instacare.pk/book-tests/lab/<chain>/<test>`, prices). Map pins from OpenStreetMap (Nominatim).
- **robots.txt respected:** InstaCare's `/api/`, `/sitemap/` and search pages are never used; Oladoc asks for
  10 s between requests. We read one page at a time with a 3 s pause (Nominatim: ≤ 1 request / second).
- **Limits of what is public:** full catalogues (≈1,800 tests at Chughtai) and the list of every Faisalabad lab
  only load through InstaCare's API, so we collect a fixed set of tests (below) for the chains InstaCare lists with
  Faisalabad branches: Chughtai Lab, IDC, Citilab, Excel Labs, Innova.
- **Tests collected:** about 60 common tests (InstaCare's test index and categories: CBC, LFT, RFT, HbA1c, thyroid,
  hepatitis, vitamins, X-ray, ultrasound…) plus expensive tests (MRI, CT, MRCP, PCR, karyotyping…) so installment
  plans have real tests. A test a chain doesn't offer is skipped, never guessed.

## Real vs demo values

| Value | Real or demo |
|---|---|
| Chain and branch names, areas, test names | **Real** (InstaCare) |
| Test price | **Real** — the **regular** (walk-in) price. The discounted InstaCare price is kept in its own column. |
| Chain phone | **Real** — from the lab's own website or report (InstaCare / Oladoc only show their own booking helplines: `03171777509`, `0415068065`) |
| Branch phone / hours | **Real** only where the lab's own website lists the branch (`on_lab_website = yes`); otherwise the chain's number and no hours |
| Map pin | **Approximate** — `location_precision`: `street`, `area` (area centre), or `none`. Labs can move their pin in their CareFirst portal. |
| `on_lab_website` | `yes` = the lab's own website lists this branch; `no` = its website lists no Faisalabad branch; `not checked` |
| Bank / JazzCash / EasyPaisa | **Demo** — `DEMO Bank (not a real account)`. Real details can only come from the lab itself. |
| Installment plans | **Demo** (CareFirst's own idea): tests above PKR 10,000 → 2 installments up to 25,000, 3 up to 50,000, 4 above 50,000, every 30 days |
| Test category | Assigned by CareFirst from the test name |
| Doctor name, specialty, experience, rating, clinic address | **Real** (Oladoc / InstaCare listings). Online-only doctors and non-doctors (nutritionist, psychologist) are left out. |
| Doctor phone | **Real** where listed; helpline and placeholder numbers (`0415068065`, `04238900939`, `03001234567`) are dropped |
| Consultation fee, appointment length, clinic timings | **Filled in** (decided with Makki, shown in the app like any other doctor's): typical Faisalabad fee for the main specialty (GP / dentist 1,000 · physician / paediatrics 1,500 · gynae / ENT 2,000 · cardio / neuro / gastro / pulmo 2,500 · neurosurgery / oncology 3,000), 20 min (GP 15, dentist 30), Mon–Sat 5–9 PM. The `filled_in` column lists them; doctors change them in their portal. |

Real businesses and doctors are named in this data. Use it for local demos and the evaluation; anything shown
publicly must be clearly marked as sample data, and real partners replace it through onboarding.
