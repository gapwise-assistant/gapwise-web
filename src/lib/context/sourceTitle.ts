export function humanizeSourceTitle(filename: string): string {
  const basename = filename.split(/[\\/]/).filter(Boolean).at(-1) ?? filename;
  const withoutExtension = basename.replace(/\.[a-z0-9]{1,5}$/i, '').trim();
  const title = withoutExtension
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([0-9])/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return 'Context source';
  if (/\s/.test(title) && /[A-Z]/.test(title)) return title;
  return title.replace(/\b\w/g, (character) => character.toUpperCase());
}
