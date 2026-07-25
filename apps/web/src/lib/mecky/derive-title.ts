const MAX_TITLE = 48;

export function deriveTitle(firstUserContent: string): string {
  const clean = (firstUserContent ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Neuer Chat';
  if (clean.length <= MAX_TITLE) return clean;
  const slice = clean.slice(0, MAX_TITLE);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}
