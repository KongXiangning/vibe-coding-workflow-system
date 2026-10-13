export function parseRecords(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.shift() !== 'id,value') throw new Error('header');
  return lines.map((line, index) => {
    const [id, value, ...extra] = line.split(',');
    if (!id || !value || extra.length) throw new Error(`row ${index + 2}`);
    return { id, value };
  });
}
