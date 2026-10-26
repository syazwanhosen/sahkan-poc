import QRCode from 'qrcode';

interface Matrix {
  size: number;
  dark: (x: number, y: number) => boolean;
}

const cache = new Map<string, Matrix>();

export function qrMatrix(text: string): Matrix {
  const hit = cache.get(text);
  if (hit) return hit;
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  const m: Matrix = { size, dark: (x, y) => !!data[y * size + x] };
  cache.set(text, m);
  return m;
}

/** One SVG path for all dark modules, run-length encoded per row. */
export function qrPath(text: string): { size: number; d: string } {
  const m = qrMatrix(text);
  let d = '';
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.dark(x, y)) {
        x++;
        continue;
      }
      let len = 1;
      while (x + len < m.size && m.dark(x + len, y)) len++;
      d += `M${x} ${y}h${len}v1h-${len}z`;
      x += len;
    }
  }
  return { size: m.size, d };
}

export const qrText = (number: string, uuid?: string) =>
  `SAHKAN DEMO e-invoice ${number}${uuid ? ` UUID ${uuid}` : ''}. Sample data, not issued through LHDN.`;
