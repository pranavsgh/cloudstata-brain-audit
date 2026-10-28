// Checks the web page's logic gives byte-identical results to brain_audit.py
const fs = require('fs'), { execFileSync } = require('child_process'), path = require('path');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const logic = html.split('// ==LOGIC==')[1].replace(/^[^\n]*/, '').split('// ==END LOGIC==')[0];
const { audit, parseDate } = new Function(logic + '; return { audit, parseDate };')();
const py = '/tmp/work/brain-audit/brain_audit.py';
const cases = [
  ['/tmp/work/brain-audit/sample_inventory.csv', '2026-10-27'],
  ['/tmp/work/brain-audit/sample_inventory.csv', '2027-04-01'],
  ['/tmp/work/brain-audit/sample_inventory.csv', '2028-06-15'],
  [__dirname + '/edge.csv', '2026-10-27'],
];
let ok = true;
for (const [csv, asof] of cases) {
  const dir = fs.mkdtempSync('/tmp/work/web/run-'); const copy = path.join(dir, 'in.csv');
  fs.copyFileSync(csv, copy);
  execFileSync('python3', [py, copy, '--as-of', asof], { stdio: 'pipe' });
  const pyRep = fs.readFileSync(path.join(dir, 'brain_audit_report.csv'), 'utf8');
  const pyIdx = fs.readFileSync(path.join(dir, 'brain_index_v1.csv'), 'utf8');
  const res = audit(fs.readFileSync(csv, 'utf8'), parseDate(asof));
  const same = res.reportCSV === pyRep && res.indexCSV === pyIdx;
  console.log((same ? 'MATCH   ' : 'DIFFER  ') + path.basename(csv) + ' as of ' + asof);
  if (!same) { ok = false; fs.writeFileSync(dir + '/js_report.csv', res.reportCSV); fs.writeFileSync(dir + '/js_index.csv', res.indexCSV); console.log('  see ' + dir); }
}
process.exit(ok ? 0 : 1);
