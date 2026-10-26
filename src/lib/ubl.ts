// Builds the UBL 2.1 JSON document MyInvois expects, and the Submit Documents
// request body around it. Every value sits in an array of {"_": value} objects,
// as the MyInvois SDK specifies for JSON.
import type { Business, Doc, Line, Party } from '../types';
import { lineAmount, taxOf, totals } from './rules';

type Json = Record<string, unknown>;

const v = (value: string | number, attrs?: Record<string, string>) => [{ _: value, ...(attrs ?? {}) }];
const money = (n: number) => [{ _: n, currencyID: 'MYR' }];

function partyNode(p: Party, msic?: { code: string; name: string }): Json {
  return {
    ...(msic ? { IndustryClassificationCode: v(msic.code, { name: msic.name }) } : {}),
    PartyIdentification: [
      { ID: v(p.tin, { schemeID: 'TIN' }) },
      { ID: v(p.idValue || 'NA', { schemeID: p.idType }) },
      { ID: v('NA', { schemeID: 'SST' }) },
    ],
    PostalAddress: [
      {
        CityName: v(p.address.city || 'NA'),
        PostalZone: v(p.address.postcode || ''),
        CountrySubentityCode: v(p.address.state || '17'),
        AddressLine: [{ Line: v(p.address.line1 || 'NA') }],
        Country: [{ IdentificationCode: v('MYS', { listID: 'ISO3166-1', listAgencyID: '6' }) }],
      },
    ],
    PartyLegalEntity: [{ RegistrationName: v(p.name) }],
    Contact: [{ Telephone: v(p.phone || 'NA'), ...(p.email ? { ElectronicMail: v(p.email) } : {}) }],
  };
}

function taxSubtotals(lines: Line[]): Json[] {
  const byCode = new Map<string, { taxable: number; tax: number; rate: number }>();
  for (const l of lines) {
    const t = taxOf(l.tax);
    const cur = byCode.get(t.code) ?? { taxable: 0, tax: 0, rate: t.rate };
    const amt = lineAmount(l);
    cur.taxable += amt;
    cur.tax += Math.round(amt * t.rate) / 100;
    byCode.set(t.code, cur);
  }
  return [...byCode.entries()].map(([code, x]) => ({
    TaxableAmount: money(Math.round(x.taxable * 100) / 100),
    TaxAmount: money(Math.round(x.tax * 100) / 100),
    Percent: v(x.rate),
    TaxCategory: [{ ID: v(code), TaxScheme: [{ ID: v('OTH', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }) }] }],
  }));
}

export function buildUbl(doc: Doc, biz: Business, ref?: Doc): Json {
  const t = totals(doc.lines);
  const iso = new Date(doc.issuedAt).toISOString();
  const supplier: Party = {
    kind: 'company',
    name: biz.name,
    tin: biz.tin,
    idType: 'BRN',
    idValue: biz.brn,
    email: biz.email,
    phone: biz.phone,
    address: biz.address,
  };
  const invoice: Json = {
    ID: v(doc.number),
    IssueDate: v(iso.slice(0, 10)),
    IssueTime: v(iso.slice(11, 19) + 'Z'),
    InvoiceTypeCode: v(doc.type, { listVersionID: '1.1' }),
    DocumentCurrencyCode: v('MYR'),
    TaxCurrencyCode: v('MYR'),
  };
  if (ref) {
    invoice.BillingReference = [{ InvoiceDocumentReference: [{ ID: v(ref.number), UUID: v(ref.uuid ?? 'NA') }] }];
  }
  invoice.AccountingSupplierParty = [{ Party: [partyNode(supplier, { code: biz.msic, name: biz.msicName })] }];
  invoice.AccountingCustomerParty = [{ Party: [partyNode(doc.buyer)] }];
  invoice.TaxTotal = [{ TaxAmount: money(t.tax), TaxSubtotal: taxSubtotals(doc.lines) }];
  invoice.LegalMonetaryTotal = [
    {
      LineExtensionAmount: money(t.subtotal),
      TaxExclusiveAmount: money(t.subtotal),
      TaxInclusiveAmount: money(t.total),
      PayableAmount: money(t.total),
    },
  ];
  invoice.InvoiceLine = doc.lines.map((l, i) => {
    const amt = lineAmount(l);
    const tx = taxOf(l.tax);
    return {
      ID: v(String(i + 1)),
      InvoicedQuantity: v(l.qty, { unitCode: 'C62' }),
      LineExtensionAmount: money(amt),
      TaxTotal: [
        {
          TaxAmount: money(Math.round(amt * tx.rate) / 100),
          TaxSubtotal: [
            {
              TaxableAmount: money(amt),
              TaxAmount: money(Math.round(amt * tx.rate) / 100),
              Percent: v(tx.rate),
              TaxCategory: [{ ID: v(tx.code), TaxScheme: [{ ID: v('OTH', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }) }] }],
            },
          ],
        },
      ],
      Item: [
        {
          CommodityClassification: [{ ItemClassificationCode: v(l.cls || '', { listID: 'CLASS' }) }],
          Description: v(l.desc),
        },
      ],
      Price: [{ PriceAmount: money(l.price) }],
      ItemPriceExtension: [{ Amount: money(amt) }],
    };
  });
  return {
    _D: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    _A: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    _B: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    Invoice: [invoice],
  };
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function sha256Hex(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export async function submissionPreview(doc: Doc, biz: Business, ref?: Doc) {
  const ubl = buildUbl(doc, biz, ref);
  const minified = JSON.stringify(ubl);
  const hash = await sha256Hex(minified);
  const b64 = toBase64(minified);
  return {
    ubl,
    pretty: JSON.stringify(ubl, null, 2),
    bytes: new TextEncoder().encode(minified).length,
    hash,
    body: {
      documents: [{ format: 'JSON', documentHash: hash, codeNumber: doc.number, document: b64 }],
    },
    b64,
  };
}
