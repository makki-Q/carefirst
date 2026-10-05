// Collects test prices of the lab chains that have Faisalabad branches, from InstaCare's
// public per-test pages (https://instacare.pk/book-tests/lab/<chain>/<test>).
//
//   node dataset/scripts/collect-lab-prices.js            → dataset/raw/instacare_lab_prices.csv
//
// Rules we keep (robots.txt, 2026-10-05): only normal pages — never InstaCare's /api/,
// /sitemap/ or search pages — one request at a time with a pause between them.
// A test a chain doesn't offer redirects to /book-tests and is skipped.
// Prices are the chain's national InstaCare prices (the same at every branch we checked).
const fs   = require('fs');
const path = require('path');

const PAUSE_MS = 3000;
const UA = 'Mozilla/5.0 (compatible; CareFirst-FYP-data-collection; FAST-NUCES Chiniot student project)';
const OUT = path.join(__dirname, '..', 'raw', 'instacare_lab_prices.csv');

// Chains with Faisalabad branches on InstaCare (checked 2026-10-05) → their /book-tests/lab/ name
const CHAINS = [
  { chain: 'Chughtai Lab',                       slug: 'chughtai-lab-11081' },
  { chain: 'Islamabad Diagnostic Centre (IDC)',  slug: 'islamabad-diagnostic-centre-idc' },
  { chain: 'Citilab & Research Centre',          slug: 'citilab-research-centre' },
  { chain: 'Excel Labs',                         slug: 'excel-labs' },
  { chain: 'Innova Labs and Diagnostics',        slug: 'innova-labs-and-diagnostics' },
];

// InstaCare test names: the common tests from its test index and category pages, plus
// expensive tests (scans, PCR, genetics) so installment plans have real tests.
// The same test can have a different name at another chain, so several spellings are tried.
const TESTS = [
  // common tests (InstaCare test index + categories)
  '17-oh-progesterone', '25-oh-vitamin-d-total', 'ag-ratio', 'alkaline-phosphatase', 'anti-hbs', 'anti-hcv',
  'anti-hiv-1-2', 'anti-mullerian-hormone-amh', 'anti-musk-antibodies', 'basic-health-profile',
  'basic-thyroid-profile-ft3-ft4-tsh', 'beta-hcg', 'bilirubin-conjugated-1', 'bilirubin-total',
  'bilirubin-unconjugated-1', 'blood-ce-complete-cbc', 'blood-glucose-random', 'cholesterol',
  'chromosomal-analysis--karyotyping-from-blood', 'cytology-body-fluid', 'free-psa', 'free-t3', 'free-t4', 'ggt',
  'glucose-fasting-1', 'hb', 'hba1c-glycosylated-hemoglobin', 'hbsag', 'hbv-pcr-viral-load-quantitation', 'lh',
  'lipid-profile', 'liver-function-test-with-ggt', 'pap-smear', 'pap-smear-for-lbc', 'plasma-glucose-fasting',
  'platelet-count', 'psa', 'psa-total', 'renal-function-tests', 'semen-for-analysis', 'serum-creatinine-for-ct-scan',
  'thyroid-function-test-t3-t4-tsh', 'total-protein', 'total-t3', 'total-t4', 'triglycerides', 'tsh',
  'uric-acid-serum', 'urine-ce', 'vitamin-b12', 'wbc-count-tlc', 'ecg', 'stool-re', 'typhidot', 'ck-mb',
  'g6-pd-test', 'dengue-ns1-antigen', 'esr',
  // imaging
  'x-ray-chest-pa-view', 'ultra-sound-usg-abdomen-pelvis', 'ultra-sound-usg-pelvis',
  'ultrasound-abdomen--pelvis-two-region', 'ultra-sound-usg-obstetrical-usg-2nd-trimester-with-anomaly-scan',
  'mri-brain-with-contrast', 'mri-brain', 'mri-knee-joint-with-contrast', 'mri-knee-joint', 'mri-lumber-spine-screening',
  'mri-lumbar-spine', 'mri-cervical-spine', 'mri-cervical-spine-with-contrast', 'mrcp-mri-pancreas-with-contrast',
  'mr-mammography-with-contrast', 'ct-angiography-neck-and-brain', 'ct-scan-cervical-spine-3d', 'ct-scan-brain',
  'ct-scan-abdomen', 'ct-scan-chest',
  // molecular / specialised
  'hcv-pcr-quantitative', 'hcv-rna-by-pcr-qualitative', 'biopsy-small', 'biopsy-medium',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const readTest = (html, chainName) => {
  const title = decode((html.match(/<title>([^<]*)/) || [])[1] || '');
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let name = '', alternate = '';
  for (const block of ld) {
    try {
      const j = JSON.parse(block);
      if (j['@type'] === 'MedicalTest') { name = decode(j.name || ''); alternate = decode(j.alternateName || ''); break; }
    } catch { /* some blocks are not strict JSON */ }
  }
  if (!name) name = title.replace(chainName, '').replace(/ Test Price and Details.*$/, '').trim();
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  // "<name> at <chain> Known as: … Rs. 1800 Rs. 2400 25% off" (one price when there is no discount)
  const at = text.indexOf(' at ');
  const m = text.slice(Math.max(0, at)).match(/Rs\. ([0-9][0-9,.]*)(?: Rs\. ([0-9][0-9,.]*))?/);
  if (!m) return null;
  const num = (s) => Math.round(Number(String(s).replace(/,/g, '')));
  const discounted = num(m[1]);
  const regular = m[2] ? num(m[2]) : discounted;
  return { name, alternate, discounted: Math.min(discounted, regular), regular: Math.max(discounted, regular) };
};

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const rows = [['chain', 'chain_slug', 'test_slug', 'test_name', 'also_known_as', 'discounted_price_pkr', 'regular_price_pkr', 'source_url', 'collected_on']];
  let found = 0, missing = 0, failed = 0;
  for (const { chain, slug } of CHAINS) {
    const seen = new Set(); // one row per test name (several spellings can lead to the same test)
    for (const test of TESTS) {
      const url = `https://instacare.pk/book-tests/lab/${slug}/${test}`;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (!res.ok || !res.url.includes(`/book-tests/lab/${slug}/`)) { missing++; }
        else {
          const t = readTest(await res.text(), chain);
          if (t && !seen.has(t.name.toLowerCase())) {
            seen.add(t.name.toLowerCase());
            rows.push([chain, slug, test, t.name, t.alternate, t.discounted, t.regular, url, today]);
            found++;
          }
        }
      } catch (err) {
        failed++;
        console.error(`  ! ${url}: ${err.message}`);
      }
      process.stdout.write(`\r${chain.padEnd(36)} ${test.padEnd(60).slice(0, 60)} found ${found} · not offered ${missing} · errors ${failed}`);
      await sleep(PAUSE_MS);
    }
    process.stdout.write('\n');
  }
  fs.writeFileSync(OUT, rows.map(r => r.map(csv).join(',')).join('\n') + '\n');
  console.log(`\nWrote ${rows.length - 1} prices to ${path.relative(process.cwd(), OUT)}`);
})();
