// A4 PDF of an e-invoice, drawn with jsPDF's built-in Helvetica. Every page is
// marked as a sample so the file can't be mistaken for a real validated e-invoice.
import { jsPDF } from 'jspdf';
import type { Business, Doc } from '../types';
import { DOC_LABEL, lineAmount, stateName, taxOf, totals } from './rules';
import { dateTime } from './format';
import { qrMatrix, qrText } from './qr';

type RGB = [number, number, number];
const INK: RGB = [29, 41, 36];
const MUTED: RGB = [91, 104, 98];
const RULE: RGB = [214, 219, 211];
const GREEN: RGB = [14, 107, 80];
const RED: RGB = [163, 34, 26];

const fmt = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => fmt.format(n);

export function docPdf(doc: Doc, biz: Business, ref?: Doc): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  const R = W - M;

  const watermark = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(96);
    pdf.setTextColor(239, 241, 237);
    pdf.text('SAMPLE', 36, 222, { angle: 35 });
  };
  const footer = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...MUTED);
    pdf.text(
      'Sample document from the Sahkan proof-of-concept demo. It was not submitted to or validated by LHDN.',
      M,
      288,
    );
  };
  const ink = (c: RGB) => pdf.setTextColor(...c);

  watermark();
  let y = 22;

  // Supplier
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  ink(INK);
  pdf.text(biz.name, M, y);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  ink(MUTED);
  pdf.text(`${biz.address.line1}, ${biz.address.postcode} ${biz.address.city}, ${stateName(biz.address.state)}`, M, y + 5.5);
  pdf.text(`TIN ${biz.tin}    BRN ${biz.brn}    MSIC ${biz.msic}`, M, y + 10);

  // Title
  const title = doc.consolidated ? 'Consolidated e-Invoice' : doc.type === '01' ? 'e-Invoice' : DOC_LABEL[doc.type];
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  ink(INK);
  pdf.text(title, R, y, { align: 'right' });
  pdf.setFontSize(10);
  pdf.text(doc.number, R, y + 6, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  ink(MUTED);
  pdf.text(`Issued ${dateTime(doc.issuedAt)}`, R, y + 11, { align: 'right' });

  // Buyer
  y += 25;
  pdf.setFontSize(8);
  ink(MUTED);
  pdf.text('Bill to', M, y);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10.5);
  ink(INK);
  pdf.text(doc.buyer.name, M, y + 5.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  ink(MUTED);
  if (doc.buyer.kind !== 'general') {
    const a = doc.buyer.address;
    pdf.text(`${a.line1}, ${a.postcode} ${a.city}`, M, y + 10.5);
    pdf.text(`TIN ${doc.buyer.tin}    ${doc.buyer.idType} ${doc.buyer.idType === 'NRIC' ? '********' + doc.buyer.idValue.slice(-4) : doc.buyer.idValue}`, M, y + 15);
  } else {
    pdf.text(`TIN ${doc.buyer.tin}`, M, y + 10.5);
  }
  if (ref) {
    pdf.text('Original e-invoice', 128, y);
    pdf.setFont('helvetica', 'bold');
    ink(INK);
    pdf.text(ref.number, 128, y + 5.5);
    pdf.setFont('helvetica', 'normal');
    ink(MUTED);
    pdf.text(ref.uuid ?? '', 128, y + 10.5);
  }

  // Lines
  y += 25;
  const cols = { cls: 118, qty: 142, unit: 166, amt: R };
  const head = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    ink(MUTED);
    pdf.text('Description', M, y);
    pdf.text('Class.', cols.cls, y);
    pdf.text('Qty', cols.qty, y, { align: 'right' });
    pdf.text('Unit price', cols.unit, y, { align: 'right' });
    pdf.text('Amount (RM)', cols.amt, y, { align: 'right' });
    pdf.setDrawColor(...INK);
    pdf.setLineWidth(0.3);
    pdf.line(M, y + 2.2, R, y + 2.2);
    y += 7.5;
  };
  head();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  for (const l of doc.lines) {
    const wrapped = pdf.splitTextToSize(l.desc || '-', cols.cls - M - 6) as string[];
    const h = wrapped.length * 4.2 + 3;
    if (y + h > 262) {
      footer();
      pdf.addPage();
      watermark();
      y = 22;
      head();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
    }
    ink(INK);
    pdf.text(wrapped, M, y);
    pdf.text(l.cls || '-', cols.cls, y);
    pdf.text(String(l.qty), cols.qty, y, { align: 'right' });
    pdf.text(money(l.price), cols.unit, y, { align: 'right' });
    pdf.text(money(lineAmount(l)), cols.amt, y, { align: 'right' });
    pdf.setDrawColor(...RULE);
    pdf.setLineWidth(0.2);
    pdf.line(M, y + h - 3.2, R, y + h - 3.2);
    y += h;
  }

  // Totals
  const t = totals(doc.lines);
  y += 3;
  const taxLabel = taxOf(doc.lines[0]?.tax ?? '06').label;
  const row = (label: string, value: string, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(bold ? 11 : 9);
    ink(bold ? INK : MUTED);
    pdf.text(label, 128, y);
    ink(INK);
    pdf.text(value, R, y, { align: 'right' });
    y += bold ? 7 : 5.5;
  };
  row('Subtotal', money(t.subtotal));
  row(t.tax ? 'Tax' : `Tax (${taxLabel.toLowerCase()})`, money(t.tax));
  row(doc.type === '02' ? 'Total credited' : doc.type === '04' ? 'Total refunded' : 'Total (RM)', money(t.total), true);

  // Validation
  y = Math.max(y + 8, 200);
  if (y > 250) {
    footer();
    pdf.addPage();
    watermark();
    y = 30;
  }
  pdf.setDrawColor(...RULE);
  pdf.setLineDashPattern([1.2, 1.2], 0);
  pdf.line(M, y, R, y);
  pdf.setLineDashPattern([], 0);
  y += 7;
  if (doc.status === 'valid' && doc.uuid) {
    const m = qrMatrix(qrText(doc.number, doc.uuid));
    const size = 28;
    const cell = size / m.size;
    pdf.setFillColor(...INK);
    for (let yy = 0; yy < m.size; yy++) {
      for (let xx = 0; xx < m.size; xx++) {
        if (m.dark(xx, yy)) pdf.rect(M + xx * cell, y + yy * cell, cell + 0.02, cell + 0.02, 'F');
      }
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    ink(GREEN);
    pdf.text('Validated (simulated in this demo)', M + size + 7, y + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    ink(MUTED);
    pdf.text(`UUID ${doc.uuid}`, M + size + 7, y + 11);
    pdf.text(`Validated ${dateTime(doc.validatedAt ?? doc.issuedAt)}`, M + size + 7, y + 16);
    pdf.text('Sample QR code. In the live app it links to the e-invoice on MyInvois.', M + size + 7, y + 21);
  } else {
    const status =
      doc.status === 'cancelled'
        ? `Cancelled ${dateTime(doc.cancelledAt ?? doc.issuedAt)}`
        : doc.status === 'invalid'
          ? 'Not valid. LHDN rejected this e-invoice.'
          : doc.status === 'submitted'
            ? 'Waiting for LHDN validation.'
            : 'Draft. Not sent to LHDN.';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    ink(doc.status === 'invalid' || doc.status === 'cancelled' ? RED : MUTED);
    pdf.text(status, M, y + 5);
  }

  footer();
  return pdf.output('blob');
}
