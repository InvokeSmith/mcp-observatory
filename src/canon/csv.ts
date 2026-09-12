/**
 * Canonical CSV.
 *
 * Every field is quoted unconditionally. Quote-only-when-needed is a data-dependent branch, which
 * means the bytes of the output depend on the content in a second way beyond the content itself —
 * a reliable source of "why does this diff when nothing changed?" Unconditional quoting costs a few
 * bytes and removes the branch.
 *
 * LF endings, never os.EOL: the file must be identical on every machine, not native to each one.
 */

export function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',');
}

export function toCsv(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [csvRow(columns)];
  for (const row of rows) {
    if (row.length !== columns.length) {
      throw new Error(`CSV row has ${row.length} fields, expected ${columns.length}`);
    }
    lines.push(csvRow(row));
  }
  return `${lines.join('\n')}\n`;
}
