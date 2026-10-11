export const FIELDS = [
  { key: 'points', label: 'Points', short: 'Points', color: '#317b58', aliases: ['points', 'totalpoints'] },
  { key: 'petage_carrots', label: 'Petage / carrots', short: 'Petage', color: '#b77b39', aliases: ['petagecarrots', 'petage', 'carrots'] },
  { key: 'lootboxes', label: 'Lootboxes', short: 'Lootboxes', color: '#7b71ab', integer: true, aliases: ['lootboxes', 'lootboxesopened', 'lootboxcount'] },
  { key: 'staked_fp', label: 'Staked FP', short: 'Staked FP', color: '#537dae', aliases: ['stakedfp', 'fpstaked'] },
  { key: 'explorer_points', label: 'Explorer points', short: 'Explorer', color: '#b2a04b', aliases: ['explorerpoints'] },
  { key: 'potion_use', label: 'Potion use', short: 'Potion', color: '#bd718b', binary: true, aliases: ['potionuse', 'usedpotion', 'potionused'] },
  { key: 'training_camps', label: 'Training camps', short: 'Training', color: '#748f4d', integer: true, aliases: ['trainingcamps', 'trainingcampcount'] },
  { key: 'shields_bought', label: 'Shields bought in shop', short: 'Shields', color: '#538d96', integer: true, aliases: ['shieldsbought', 'shieldsboughtinshop', 'shieldspurchased', 'shopshields'] },
  { key: 'revives_bought', label: 'Revives bought', short: 'Revives', color: '#bc7350', integer: true, aliases: ['revivesbought', 'revivespurchased'] },
];
const MAX_DIGITS = 36;
export function fieldInputTotals(weights,mode) {
  const entered=FIELDS.map(f=>decimal(String(weights[f.key]??'').trim()||'0',f.label+' weight'));
  const weight=entered.reduce(add,fraction());
  const pool=mode==='weights'?(weight.n?fraction(100n):fraction()):weight;
  const shares=entered.map(v=>mode==='weights'?(weight.n?mul(div(v,weight),fraction(100n)):fraction()):v);
  return {weight,pool,shares};
}
export function sortWalletRows(rows, sourceRows, key, direction='desc') {
  if (!FIELDS.some(f=>f.key===key)) return rows;
  const values=new Map(sourceRows.map(r=>[r.wallet,r[key]==null?null:decimal(r[key])]));
  return [...rows].sort((a,b)=>{
    const x=values.get(a.wallet),y=values.get(b.wallet);
    if(!x||!y)return x?-1:y?1:a.wallet.localeCompare(b.wallet);
    const delta=x.n*y.d-y.n*x.d;
    return (delta===0n?0:delta>0n?1:-1)*(direction==='asc'?1:-1)||a.wallet.localeCompare(b.wallet);
  });
}
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
export function fraction(n = 0n, d = 1n) {
  if (d <= 0n) throw new Error('Invalid denominator');
  const g = gcd(n < 0n ? -n : n, d) || 1n;
  return { n: n / g, d: d / g };
}
export const add = (a, b) => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const mul = (a, b) => fraction(a.n * b.n, a.d * b.d);
export const div = (a, b) => { if (!b.n) throw new Error('Division by zero'); return fraction(a.n * b.d, a.d * b.n); };
export const asNumber = a => Number(a.n) / Number(a.d);
export function decimal(value, label = 'Value') {
  const s = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error(`${label}: enter a nonnegative number (no commas or exponents).`);
  const [whole = '0', part = ''] = s.split('.');
  if (whole.replace(/^0+/, '').length > MAX_DIGITS || part.length > 18) throw new Error(`${label}: maximum 36 whole digits and 18 decimal places.`);
  return fraction(BigInt((whole || '0') + part), 10n ** BigInt(part.length));
}
export function formatFraction(a, places = 12) {
  const scale = 10n ** BigInt(places);
  const v = (a.n * scale * 2n + a.d) / (2n * a.d);
  return formatUnits(v, places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
export function formatUnits(n, places) {
  if (!places) return String(n);
  const s = String(n).padStart(places + 1, '0');
  return `${s.slice(0, -places)}.${s.slice(-places)}`;
}
export function canonical(value, field) {
  const s = String(value ?? '').trim();
  if (!s) throw new Error(`${field.label}: a blank value is not a verified zero.`);
  if (field.binary) {
    if (/^(yes|true|1)$/i.test(s)) return '1';
    if (/^(no|false|0)$/i.test(s)) return '0';
    throw new Error(`${field.label} must be Yes/No, True/False, or 1/0; counts above 1 are not accepted.`);
  }
  const d = decimal(s, field.label);
  if (field.integer && d.d !== 1n) throw new Error(`${field.label}: enter a whole count.`);
  return formatFraction(d, 18);
}
export function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100000) throw new Error('Use at most 100,000 wallet rows.');
  const merged = new Map(); let duplicates = 0;
  rows.forEach((row, index) => {
    const wallet = String(row.wallet ?? '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error(`Row ${index + 1}: wallet must be a 0x address with 40 hexadecimal characters.`);
    const clean = { wallet };
    FIELDS.forEach(f => { try { clean[f.key] = canonical(row[f.key], f); } catch (e) { throw new Error(`Row ${index + 1}: ${e.message}`); } });
    if (merged.has(wallet)) {
      const prior = merged.get(wallet); duplicates++;
      FIELDS.forEach(f => { prior[f.key] = f.binary ? String(Math.max(Number(prior[f.key]), Number(clean[f.key]))) : formatFraction(add(decimal(prior[f.key]), decimal(clean[f.key])), 18); });
    } else merged.set(wallet, clean);
  });
  return { rows: [...merged.values()], duplicates };
}
export function calculate(rows, config) {
  if (!['weights', 'percent'].includes(config.mode)) throw new Error('Unknown allocation mode.');
  const precision = Number(config.precision);
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new Error('Amount decimals must be from 0 to 18.');
  const pool = decimal(config.pool, 'Distribution pool');
  const scale = 10n ** BigInt(precision);
  if (pool.n * scale % pool.d) throw new Error(`Pool has more than ${precision} decimal places. Increase amount decimals.`);
  const weights = FIELDS.map(f => decimal(config.weights[f.key], `${f.label} weight`));
  const sum = weights.reduce(add, fraction());
  if (!sum.n) throw new Error('Set at least one field weight above zero.');
  if (config.mode === 'percent' && sum.n > 100n * sum.d) throw new Error('Field percentages exceed 100%. Reduce them before exporting.');
  const factors = FIELDS.map((f, j) => {
    const total = rows.reduce((a, r) => add(a, decimal(r[f.key])), fraction());
    const share = div(weights[j], config.mode === 'weights' ? sum : fraction(100n));
    return { ...f, total, share, budget: mul(pool, share), active: Boolean(total.n), participants: rows.filter(r => decimal(r[f.key]).n > 0n).length };
  });
  const allocatedShare = factors.filter(f => f.active).reduce((a, f) => add(a, f.share), fraction());
  const budget = mul(pool, allocatedShare);
  const targetUnits = budget.n * scale / budget.d;
  let output = rows.map(row => {
    let share = fraction();
    const breakdown = factors.map(f => {
      const within = f.active ? div(decimal(row[f.key]), f.total) : fraction();
      const overall = mul(f.share, within);
      share = add(share, overall);
      return { key: f.key, count: row[f.key], within, overall, amount: mul(pool, overall) };
    });
    const exact = mul(pool, share);
    const units = exact.n * scale / exact.d;
    const remainder = fraction(exact.n * scale % exact.d, exact.d);
    return { ...row, share, exact, units, remainder, breakdown };
  });
  let remaining = targetUnits - output.reduce((a, r) => a + r.units, 0n);
  const ranked = [...output].sort((a, b) => {
    const delta = a.remainder.n * b.remainder.d - b.remainder.n * a.remainder.d;
    return delta > 0n ? -1 : delta < 0n ? 1 : a.wallet.localeCompare(b.wallet);
  });
  for (const row of ranked) { if (remaining <= 0n) break; row.units++; remaining--; }
  output.sort((a, b) => a.units > b.units ? -1 : a.units < b.units ? 1 : a.wallet.localeCompare(b.wallet));
  const poolUnits = pool.n * scale / pool.d;
  return { rows: output, factors, pool, allocatedShare, allocatedUnits: targetUnits, unallocatedUnits: poolUnits - targetUnits, precision, weightSum: sum };
}
export function parseDelimited(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) throw new Error('Paste a CSV or tab-separated table first.');
  if (text.length > 25000000) throw new Error('File is too large; limit is 25 MB.');
  const firstLine = text.split('\n')[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const records = []; let row = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { row.push(cell); cell = ''; closed = false; };
  const pushRow = () => { pushCell(); if (row.some(c => c.trim())) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === delimiter) pushCell();
    else if (c === '\n') pushRow();
    else if (c === '"' && !cell && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Malformed CSV quoting.'); cell += c; }
  }
  if (quoted) throw new Error('CSV has an unclosed quote.');
  if (cell || row.length || closed) pushRow();
  if (records.length < 2) throw new Error('Include a header row and at least one wallet row.');
  const headers = records.shift().map(h => h.trim());
  if (headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Column headers must be nonempty and unique.');
  records.forEach((r, i) => { if (r.length !== headers.length) throw new Error(`Data row ${i + 1} has ${r.length} cells; expected ${headers.length}.`); });
  return { headers, records };
}
export function suggestMapping(headers) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return Object.fromEntries([{ key: 'wallet', aliases: ['wallet', 'address', 'walletaddress', 'owner'] }, ...FIELDS].map(f => [f.key, headers.findIndex(h => f.aliases.includes(norm(h)))]));
}
export function importMapped(parsed, mapping, allowZero = false) {
  const all = ['wallet', ...FIELDS.map(f => f.key)];
  if (Number(mapping.wallet) < 0 || mapping.wallet === undefined) throw new Error('Map the wallet column.');
  const used = all.map(k => Number(mapping[k])).filter(i => i >= 0);
  if (new Set(used).size !== used.length) throw new Error('Each source column can map to only one field.');
  if (!allowZero && all.some(k => !(Number(mapping[k]) >= 0))) throw new Error('Map every field, or explicitly allow unmapped fields to be zero.');
  if (used.some(i => !Number.isInteger(i) || i >= parsed.headers.length)) throw new Error('Invalid column mapping.');
  return normalizeRows(parsed.records.map(r => Object.fromEntries(all.map(k => [k, Number(mapping[k]) >= 0 ? r[Number(mapping[k])] : '0']))));
}
export function csv(headers, rows) {
  const safe = value => {
    let s = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers, ...rows].map(r => r.map(safe).join(',')).join('\r\n');
}
export function allocationCSV(result, unit = 'tokens') {
  const headers = ['wallet', 'total_share_pct', `allocation_${unit}`, 'exact_allocation_before_rounding', ...FIELDS.flatMap(f => [`${f.key}_count`, `${f.key}_within_field_pct`, `${f.key}_total_distro_pct`, `${f.key}_allocation_before_rounding`])];
  return csv(headers, result.rows.map(r => [r.wallet, formatFraction(mul(r.share, fraction(100n))), formatUnits(r.units, result.precision), formatFraction(r.exact, 18), ...r.breakdown.flatMap(b => [b.count, formatFraction(mul(b.within, fraction(100n))), formatFraction(mul(b.overall, fraction(100n))), formatFraction(b.amount, 18)])]));
}
export const inputCSV = rows => csv(['wallet', ...FIELDS.map(f => f.key)], rows.map(r => [r.wallet, ...FIELDS.map(f => r[f.key])]));
export function defaultConfig() { return { pool: '250000', unit: 'IMD', precision: 6, mode: 'weights', weights: Object.fromEntries(FIELDS.map(f => [f.key, '10'])) }; }
export function integerSqrt(n) {
  if (n < 0n) throw new Error('Square root requires a nonnegative number.');
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  let y = (x + n / x) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
// Applied once to combined wallet shares. Roots use 60 fixed decimal places.
export function sqrtComparison(result) {
  const rootScale = 10n ** 60n, payoutScale = 10n ** BigInt(result.precision);
  const roots = result.rows.map(r => integerSqrt(r.share.n * rootScale * rootScale / r.share.d));
  const rootSum = roots.reduce((a, b) => a + b, 0n);
  const rows = result.rows.map((r, i) => {
    const share = rootSum ? mul(result.allocatedShare, fraction(roots[i], rootSum)) : fraction();
    const exact = mul(result.pool, share), units = exact.n * payoutScale / exact.d;
    return { wallet: r.wallet, share, exact, units, remainder: fraction(exact.n * payoutScale % exact.d, exact.d) };
  });
  let left = result.allocatedUnits - rows.reduce((a, r) => a + r.units, 0n);
  const sorted = [...rows].sort((a, b) => { const d = a.remainder.n * b.remainder.d - b.remainder.n * a.remainder.d; return d > 0n ? -1 : d < 0n ? 1 : a.wallet.localeCompare(b.wallet); });
  for (const row of sorted) { if (left <= 0n) break; row.units++; left--; }
  return new Map(rows.map(r => [r.wallet, r]));
}
export function comparisonCSV(result, selected = 'none', coverage = {}) {
  const smoothed = sqrtComparison(result);
  const headers = ['wallet', 'selected_method', 'selected_allocation', 'unsmoothed_pct', 'unsmoothed_allocation', 'sqrt_pct', 'sqrt_allocation', ...FIELDS.flatMap(f => [`${f.key}_count`, `${f.key}_within_field_pct`, `${f.key}_pool_contribution_pct`])];
  return csv(headers, result.rows.map(r => { const s = smoothed.get(r.wallet); return [r.wallet, selected, formatUnits(selected === 'sqrt' ? s.units : r.units, result.precision), formatFraction(mul(r.share, fraction(100n))), formatUnits(r.units, result.precision), formatFraction(mul(s.share, fraction(100n))), formatUnits(s.units, result.precision), ...r.breakdown.flatMap(b => coverage[b.key]?.available === false ? ['unavailable', '', ''] : [b.count, formatFraction(mul(b.within, fraction(100n))), formatFraction(mul(b.overall, fraction(100n)))])]; }));
}
export function demoRows() {
  const values = [
    [48000, 680, 32, 4200, 1250, 1, 18, 14, 3, 40],
    [32000, 420, 48, 2700, 2200, 1, 24, 8, 1, 28],
    [21500, 910, 16, 1800, 750, 0, 10, 22, 5, 65],
    [16250, 180, 65, 6100, 1650, 1, 6, 6, 2, 15],
    [10500, 350, 24, 950, 3100, 1, 30, 12, 4, 32],
    [7750, 260, 10, 1250, 1050, 0, 12, 18, 1, 20]
  ];
  return values.map((v, i) => ({ wallet: '0x' + (161 + i).toString(16).padStart(40, '0'), ...Object.fromEntries(FIELDS.map((f, j) => [f.key, String(v[j])])) }));
}
