// Builds the UBL 2.1 JSON document MyInvois expects, and the Submit Documents
// request body around it. Every value sits in an array of {"_": value} objects,
// as the MyInvois SDK specifies for JSON.
import type { Business, Doc, Line, Party } from '../types';
import { lineAmount, taxOf, totals } from './rules';

type Json = Record<string, unknown>;

const v = (value: string | number, attrs?: Record<string, string>) => [{ _: value, ...(attrs ?? {}) }];
const money = (n: number) => [{ _: n, currencyID: 'MYR' }];

// Tax type E needs a reason; the composer doesn't ask for one, so every exempt line carries this.
const EXEMPTION_REASON = 'Exempt from tax';

const taxCategory = (code: string): Json => ({
  ID: v(code),
  ...(code === 'E' ? { TaxExemptionReason: v(EXEMPTION_REASON) } : {}),
  TaxScheme: [{ ID: v('OTH', { schemeID: 'UN/ECE 5153', schemeAgencyID: '6' }) }],
});

function partyNode(p: Party, o: { msic?: { code: string; name: string }; sst?: string } = {}): Json {
  return {
    ...(o.msic ? { IndustryClassificationCode: v(o.msic.code, { name: o.msic.name }) } : {}),
    PartyIdentification: [
      { ID: v(p.tin, { schemeID: 'TIN' }) },
      { ID: v(p.idValue || 'NA', { schemeID: p.idType }) },
      { ID: v(o.sst?.trim() || 'NA', { schemeID: 'SST' }) },
      { ID: v('NA', { schemeID: 'TTX' }) },
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
    TaxCategory: [taxCategory(code)],
  }));
}

/**
 * The UBL document for one e-invoice. The version only labels it here: the server sets the
 * one it submits (1.1 when it holds a signing certificate, else 1.0) and signs 1.1 documents.
 */
export function buildUbl(doc: Doc, biz: Business, ref?: Doc, version: '1.0' | '1.1' = '1.1'): Json {
  const t = totals(doc.lines);
  const iso = new Date(doc.issuedAt).toISOString();
  const supplier: Party = {
    kind: 'company',
    name: biz.name,
    tin: biz.tin,
    idType: biz.idType ?? 'BRN',
    idValue: biz.brn,
    email: biz.email,
    phone: biz.phone,
    address: biz.address,
  };
  const invoice: Json = {
    ID: v(doc.number),
    IssueDate: v(iso.slice(0, 10)),
    IssueTime: v(iso.slice(11, 19) + 'Z'),
    InvoiceTypeCode: v(doc.type, { listVersionID: version }),
    DocumentCurrencyCode: v('MYR'),
    TaxCurrencyCode: v('MYR'),
  };
  if (ref) {
    invoice.BillingReference = [{ InvoiceDocumentReference: [{ ID: v(ref.number), UUID: v(ref.uuid ?? 'NA') }] }];
  }
  // State 17 ("not applicable") is only for consolidated e-invoices and foreign addresses, so a
  // general-public buyer on a single sale takes the supplier's state.
  const buyer =
    doc.buyer.kind === 'general' && !doc.consolidated && doc.buyer.address.state === '17'
      ? { ...doc.buyer, address: { ...doc.buyer.address, state: biz.address.state } }
      : doc.buyer;
  invoice.AccountingSupplierParty = [{ Party: [partyNode(supplier, { msic: { code: biz.msic, name: biz.msicName }, sst: biz.sst })] }];
  invoice.AccountingCustomerParty = [{ Party: [partyNode(buyer)] }];
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
              TaxCategory: [taxCategory(tx.code)],
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

/** The supplier and lines of a UBL JSON document as Get Document returns it. XML documents give no lines. */
export function readUbl(text: string): { supplier?: string; lines: { desc: string; qty: number; amount: number }[] } {
  const first = (x: unknown): unknown => (x as { _?: unknown }[] | undefined)?.[0]?._;
  try {
    const inv = (JSON.parse(text) as { Invoice?: Json[] }).Invoice?.[0] as Record<string, Json[]> | undefined;
    if (!inv) return { lines: [] };
    const party = (inv.AccountingSupplierParty?.[0]?.Party as Json[] | undefined)?.[0] as Record<string, Json[]> | undefined;
    const lines = (inv.InvoiceLine ?? []).map((l) => {
      const item = (l.Item as Json[] | undefined)?.[0];
      return {
        desc: String(first(item?.Description) ?? ''),
        qty: Number(first(l.InvoicedQuantity) ?? 1),
        amount: Number(first(l.LineExtensionAmount) ?? 0),
      };
    });
    return { supplier: party ? String(first(party.PartyLegalEntity?.[0]?.RegistrationName) ?? '') || undefined : undefined, lines };
  } catch {
    return { lines: [] };
  }
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

export async function submissionPreview(doc: Doc, biz: Business, ref?: Doc, version?: '1.0' | '1.1') {
  const ubl = buildUbl(doc, biz, ref, version);
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
