// LHDN e-invoice field rules, written once and shared by the composer,
// the buyer request page and the simulated MyInvois validation.
import type { DocType, Line, Party, TaxCode } from '../types';

export const RM10K = 10_000;
export const GENERAL_PUBLIC_TIN = 'EI00000000010';

export const CLASSIFICATIONS: { code: string; label: string }[] = [
  { code: '001', label: 'Breastfeeding equipment' },
  { code: '002', label: 'Child care centres and kindergartens fees' },
  { code: '003', label: 'Computer, smartphone or tablet' },
  { code: '004', label: 'Consolidated e-Invoice' },
  { code: '005', label: 'Construction materials' },
  { code: '006', label: 'Disbursement' },
  { code: '007', label: 'Donation' },
  { code: '008', label: 'e-Commerce - e-Invoice to buyer / purchaser' },
  { code: '009', label: 'e-Commerce - Self-billed e-Invoice to seller, logistics, etc.' },
  { code: '010', label: 'Education fees' },
  { code: '011', label: 'Goods on consignment (Consignor)' },
  { code: '012', label: 'Goods on consignment (Consignee)' },
  { code: '013', label: 'Gym membership' },
  { code: '014', label: 'Insurance - Education and medical benefits' },
  { code: '015', label: 'Insurance - Takaful or life insurance' },
  { code: '016', label: 'Interest and financing expenses' },
  { code: '017', label: 'Internet subscription' },
  { code: '018', label: 'Land and building' },
  { code: '019', label: 'Medical examination for learning disabilities and early intervention' },
  { code: '020', label: 'Medical examination or vaccination expenses' },
  { code: '021', label: 'Medical expenses for serious diseases' },
  { code: '022', label: 'Others' },
  { code: '023', label: 'Petroleum operations' },
  { code: '024', label: 'Private retirement scheme or deferred annuity scheme' },
  { code: '025', label: 'Motor vehicle' },
  { code: '026', label: 'Subscription of books, journals, magazines, newspapers' },
  { code: '027', label: 'Reimbursement' },
  { code: '028', label: 'Rental of motor vehicle' },
  { code: '029', label: 'EV charging facilities' },
  { code: '030', label: 'Repair and maintenance' },
  { code: '031', label: 'Research and development' },
  { code: '032', label: 'Foreign income' },
  { code: '033', label: 'Self-billed - Betting and gaming' },
  { code: '034', label: 'Self-billed - Importation of goods' },
  { code: '035', label: 'Self-billed - Importation of services' },
  { code: '036', label: 'Self-billed - Others' },
  { code: '037', label: 'Self-billed - Monetary payment to agents, dealers or distributors' },
  { code: '038', label: 'Sports equipment, facilities and training fees' },
  { code: '039', label: 'Supporting equipment for disabled person' },
  { code: '040', label: 'Voluntary contribution to approved provident fund' },
  { code: '041', label: 'Dental examination or treatment' },
  { code: '042', label: 'Fertility treatment' },
  { code: '043', label: 'Treatment and home care nursing, daycare and residential care' },
  { code: '044', label: 'Vouchers, gift cards, loyalty points, etc' },
  { code: '045', label: 'Self-billed - Non-monetary payment to agents, dealers or distributors' },
];

const SHORT: Record<string, string> = {
  '002': 'Childcare',
  '003': 'Computer',
  '004': 'Consolidated',
  '010': 'Education',
  '013': 'Gym',
  '022': 'Others',
  '030': 'Repair',
  '041': 'Dental',
};

export const clsLabel = (code: string) => CLASSIFICATIONS.find((c) => c.code === code)?.label ?? '';
export const clsShort = (code: string) => SHORT[code] ?? clsLabel(code).split(/[ ,(]/)[0];

export const TAX_TYPES: { code: TaxCode; label: string; rate: number }[] = [
  { code: '06', label: 'Not applicable', rate: 0 },
  { code: '02', label: 'Service tax 8%', rate: 8 },
  { code: '01', label: 'Sales tax 10%', rate: 10 },
  { code: 'E', label: 'Tax exempt', rate: 0 },
];
export const taxOf = (code: TaxCode) => TAX_TYPES.find((t) => t.code === code) ?? TAX_TYPES[0];

export const STATES: [string, string][] = [
  ['01', 'Johor'],
  ['02', 'Kedah'],
  ['03', 'Kelantan'],
  ['04', 'Melaka'],
  ['05', 'Negeri Sembilan'],
  ['06', 'Pahang'],
  ['07', 'Pulau Pinang'],
  ['08', 'Perak'],
  ['09', 'Perlis'],
  ['10', 'Selangor'],
  ['11', 'Terengganu'],
  ['12', 'Sabah'],
  ['13', 'Sarawak'],
  ['14', 'W.P. Kuala Lumpur'],
  ['15', 'W.P. Labuan'],
  ['16', 'W.P. Putrajaya'],
  ['17', 'Not applicable'],
];
export const stateName = (code: string) => STATES.find((s) => s[0] === code)?.[1] ?? '';

export const DOC_LABEL: Record<DocType, string> = {
  '01': 'Invoice',
  '02': 'Credit note',
  '03': 'Debit note',
  '04': 'Refund note',
};
export const DOC_PREFIX: Record<DocType, string> = { '01': 'INV-', '02': 'CN-', '03': 'DN-', '04': 'RN-' };

export interface FieldCheck {
  ok: boolean;
  message?: string;
  fix?: string;
}

const COMPANY_TIN = /^(CS|FA|PT|TA|TC|TN|TR|TP|LE|C|D|F|J)(\d+)$/;

export function checkTin(raw: string): FieldCheck {
  const tin = raw.trim().toUpperCase();
  if (!tin) return { ok: false, message: 'Add the tax number (TIN).' };
  if (/^EI000000000[1-4]0$/.test(tin)) return { ok: true };
  if (/^(SG|OG)\d+$/.test(tin)) {
    return { ok: false, message: 'Individual tax numbers now start with IG instead of SG or OG.', fix: 'IG' + tin.slice(2) };
  }
  if (tin.startsWith('IG')) {
    return /^IG\d{9,12}$/.test(tin)
      ? { ok: true }
      : { ok: false, message: 'Individual tax numbers look like IG12345678912.' };
  }
  const m = tin.match(COMPANY_TIN);
  if (m) {
    const [, prefix, digits] = m;
    if (digits.startsWith('0')) {
      const d = digits.replace(/^0+/, '');
      return { ok: false, message: 'Remove the zero right after the letters.', fix: prefix + (d.endsWith('0') ? d : d + '0') };
    }
    if (!digits.endsWith('0')) return { ok: false, message: 'Company tax numbers always end in 0.', fix: tin + '0' };
    if (digits.length < 8 || digits.length > 12) return { ok: false, message: 'This tax number has too few or too many digits.' };
    return { ok: true };
  }
  return { ok: false, message: 'Company tax numbers start with C. Individual ones start with IG.' };
}

export function checkPhone(raw: string): FieldCheck {
  const p = raw.trim();
  if (!p) return { ok: false, message: 'Add a phone number.' };
  if (/^\+?\d{8,20}$/.test(p)) return { ok: true };
  const digits = (p.startsWith('+') ? '+' : '') + p.replace(/\D/g, '');
  if (/^\+?\d{8,20}$/.test(digits)) return { ok: false, message: 'Use digits only, with no spaces or dashes.', fix: digits };
  return { ok: false, message: 'Phone numbers have 8 to 20 digits.' };
}

export function checkEmail(raw: string): FieldCheck {
  const e = raw.trim();
  if (!e) return { ok: true };
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? { ok: true } : { ok: false, message: 'Check the email address.' };
}

export function checkPostcode(raw: string): FieldCheck {
  return /^\d{5}$/.test(raw.trim()) ? { ok: true } : { ok: false, message: 'Malaysian postcodes have 5 digits.' };
}

export function checkMykad(raw: string): FieldCheck {
  const d = raw.replace(/\D/g, '');
  return d.length === 12 ? { ok: true } : { ok: false, message: 'MyKad numbers have 12 digits.' };
}

/** Field problems MyInvois would reject a buyer for. General-public buyers skip contact checks. */
export function partyProblems(p: Party): { field: string; message: string; fix?: string }[] {
  if (p.kind === 'general') return [];
  const out: { field: string; message: string; fix?: string }[] = [];
  const tin = checkTin(p.tin);
  if (!tin.ok) out.push({ field: 'tin', message: tin.message!, fix: tin.fix });
  if (!p.name.trim()) out.push({ field: 'name', message: 'Add the buyer name.' });
  const phone = checkPhone(p.phone);
  if (!phone.ok) out.push({ field: 'phone', message: phone.message!, fix: phone.fix });
  const email = checkEmail(p.email);
  if (!email.ok) out.push({ field: 'email', message: email.message! });
  const pc = checkPostcode(p.address.postcode);
  if (!pc.ok) out.push({ field: 'postcode', message: pc.message! });
  if (!p.address.line1.trim()) out.push({ field: 'address', message: 'Add the buyer address.' });
  return out;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineAmount(l: Line): number {
  return round2(l.qty * l.price);
}

export function totals(lines: Line[]): { subtotal: number; tax: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const amt = lineAmount(l);
    subtotal += amt;
    tax += round2((amt * taxOf(l.tax).rate) / 100);
  }
  subtotal = round2(subtotal);
  tax = round2(tax);
  return { subtotal, tax, total: round2(subtotal + tax) };
}

/** Totals with the document's sign: credit and refund notes count against income. */
export function signedTotal(type: DocType, lines: Line[]): number {
  const t = totals(lines).total;
  return type === '02' || type === '04' ? -t : t;
}
