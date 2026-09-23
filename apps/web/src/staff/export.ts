/** Exports run in the browser from rows the server already filtered by permission. */
type Row = Record<string, unknown>;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  // Quote, and neutralise spreadsheet formula injection (=, +, -, @ at the start).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function save(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function toCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

export function downloadCsv(rows: Row[], filename: string) {
  save(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename);
}

export async function downloadXlsx(rows: Row[], filename: string, sheet: string) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  if (!rows.length) rows = [{ Note: 'No rows' }];
  const cols = Object.keys(rows[0]);
  const data = [
    cols.map((c) => ({ value: c, fontWeight: 'bold' as const })),
    ...rows.map((r) => cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return { type: Number, value: v };
      if (typeof v === 'boolean') return { type: String, value: v ? 'Yes' : 'No' };
      return { type: String, value: String(v) };
    })),
  ];
  await writeXlsxFile(data as never, { fileName: filename, sheet, columns: cols.map((c) => ({ width: Math.min(60, Math.max(12, c.length + 4)) })) } as never);
}
