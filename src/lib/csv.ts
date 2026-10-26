import type { Receipt } from '../types';
import { myt } from './clock';
import { periodMonth } from './format';

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return myt(+m[1], +m[2], +m[3], 12);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return myt(+m[3], +m[2], +m[1], 12);
  return null;
}

export interface ParsedSales {
  rows: Receipt[];
  skipped: number;
  error?: string;
}

/** Reads a sales export with receipt, date and amount columns, keeping only the given month. */
export function parseSalesCsv(text: string, period: string): ParsedSales {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const month = periodMonth(period);
  if (!lines.length) return { rows: [], skipped: 0, error: 'This file is empty.' };

  const header = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  let iR = header.findIndex((h) => /receipt|^no\.?$|number|bill/.test(h));
  let iD = header.findIndex((h) => /date/.test(h));
  let iA = header.findIndex((h) => /amount|total|value/.test(h));
  let start = 1;
  if (iR < 0 || iA < 0) {
    iR = 0;
    iD = 1;
    iA = 2;
    start = 0;
  }

  const [py, pm] = period.split('-').map(Number);
  const rows: Receipt[] = [];
  let skipped = 0;
  lines.slice(start).forEach((line, idx) => {
    const cols = splitLine(line);
    const no = (cols[iR] ?? '').trim();
    const amount = parseFloat((cols[iA] ?? '').replace(/[^0-9.-]/g, ''));
    if (!no || !Number.isFinite(amount) || amount <= 0) {
      skipped++;
      return;
    }
    const at = iD >= 0 ? parseDate(cols[iD]) : null;
    if (at !== null) {
      const d = new Date(at + 8 * 3_600_000);
      if (d.getUTCFullYear() !== py || d.getUTCMonth() + 1 !== pm) {
        skipped++;
        return;
      }
    }
    const seq = no.match(/(\d+)\D*$/);
    rows.push({
      no,
      seq: seq ? parseInt(seq[1], 10) : idx,
      at: at ?? myt(py, pm, 15, 12),
      cents: Math.round(amount * 100),
    });
  });

  if (!rows.length) {
    return {
      rows,
      skipped,
      error: `We couldn't find any ${month} sales in this file. It needs receipt, date and amount columns.`,
    };
  }
  rows.sort((a, b) => a.seq - b.seq);
  return { rows, skipped };
}

export function templateCsv(prefix: string): string {
  return [
    'receipt,date,amount,description',
    `${prefix}09001,2026-10-01,129.90,Phone case and screen protector`,
    `${prefix}09002,2026-10-01,2349.00,"Smartphone, 6.7-inch"`,
    `${prefix}09003,2026-10-02,189.00,Wireless earbuds`,
    `${prefix}09004,2026-10-02,12990.00,Laptops for an office (above RM10000)`,
    '',
  ].join('\n');
}
