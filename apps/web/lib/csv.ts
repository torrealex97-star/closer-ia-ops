// Exportación a CSV desde el panel. Las celdas que empiezan por = + - @ se neutralizan para que Excel o Sheets
// no las ejecuten como fórmulas (inyección de fórmulas con contenido de terceros).
export type Column<T> = { header: string; value: (row: T) => string | number | null | undefined };

const cell = (raw: string | number | null | undefined) => {
  let text = raw == null ? '' : String(raw).replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv<T>(rows: T[], columns: Array<Column<T>>): string {
  return '﻿' + [columns.map(c => cell(c.header)).join(','), ...rows.map(r => columns.map(c => cell(c.value(r))).join(','))].join('\r\n') + '\r\n';
}

export function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
