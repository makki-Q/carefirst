// Collects the Faisalabad branches of the lab chains from InstaCare's public city pages
// (https://instacare.pk/lab/<chain>/faisalabad) and looks up an approximate map position
// for each with OpenStreetMap's Nominatim (usage policy: ≤ 1 request / second, identified app).
//
//   node dataset/scripts/collect-lab-branches.js           → dataset/raw/instacare_lab_branches.csv
//
// The phone InstaCare shows on branch pages is its own booking line, so it is not kept;
// each chain's real number is added when the data is prepared for CareFirst.
const fs   = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (compatible; CareFirst-FYP-data-collection; FAST-NUCES Chiniot student project)';
const OUT = path.join(__dirname, '..', 'raw', 'instacare_lab_branches.csv');

const CHAINS = [
  { chain: 'Chughtai Lab',                      slug: 'chughtai-lab' },
  { chain: 'Islamabad Diagnostic Centre (IDC)', slug: 'islamabad-diagnostic-centre-idc' },
  { chain: 'Citilab & Research Centre',         slug: 'citilab-research-centre' },
  { chain: 'Excel Labs',                        slug: 'excel-labs' },
  { chain: 'Innova Labs and Diagnostics',       slug: 'innova-labs-and-diagnostics' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const csv = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
const field = (block, key) => decode((block.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`)) || [])[1]);

// Faisalabad's rough bounding box — results outside it are ignored
const IN_FAISALABAD = ({ lat, lon }) => lat > 31.2 && lat < 31.65 && lon > 72.85 && lon < 73.35;

const geocode = async (query) => {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pk&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  await sleep(1100);
  if (!res.ok) return null;
  const [hit] = await res.json();
  if (!hit) return null;
  const point = { lat: Number(hit.lat), lon: Number(hit.lon) };
  return IN_FAISALABAD(point) ? point : null;
};

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const rows = [['chain', 'branch_name', 'street_address', 'area', 'city', 'latitude', 'longitude', 'location_precision', 'source_url', 'collected_on']];

  for (const { chain, slug } of CHAINS) {
    const cityUrl = `https://instacare.pk/lab/${slug}/faisalabad`;
    const html = await (await fetch(cityUrl, { headers: { 'User-Agent': UA } })).text();
    await sleep(3000);
    // One schema.org DiagnosticLab block per branch (not always strict JSON, so read fields one by one)
    const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1]).filter(b => /"DiagnosticLab"/.test(b) && /"streetAddress"/.test(b));
    console.log(`${chain}: ${blocks.length} branches`);

    for (const b of blocks) {
      const name = field(b, 'name');
      const street = field(b, 'streetAddress');
      const area = field(b, 'addressLocality');
      const branchUrl = 'https://instacare.pk' + encodeURI(field(b, 'url').replace(/^https?:\/\/instacare\.pk/, ''));
      // Street + area first, then the area alone (approximate)
      let point = await geocode(`${street}, ${area}, Faisalabad, Pakistan`);
      let precision = point ? 'street' : '';
      if (!point) { point = await geocode(`${area}, Faisalabad, Pakistan`); precision = point ? 'area' : 'none'; }
      rows.push([chain, name, street, area, 'Faisalabad', point?.lat.toFixed(6) ?? '', point?.lon.toFixed(6) ?? '', precision, branchUrl, today]);
      console.log(`  ${name.padEnd(55)} ${precision}`);
    }
  }
  fs.writeFileSync(OUT, rows.map(r => r.map(csv).join(',')).join('\n') + '\n');
  console.log(`\nWrote ${rows.length - 1} branches to ${path.relative(process.cwd(), OUT)}`);
})();
