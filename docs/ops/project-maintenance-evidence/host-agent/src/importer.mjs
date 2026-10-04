// Seeded, isolated E6 baseline used to exercise a later actual repair.
export function importDevices(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines[0] !== 'device_id,label' || lines.length !== 2) throw new Error('line 1: expected header and one device');
  return lines.slice(1).map((line, i) => {
    const [rawId, rawLabel] = line.split(',');
    const id = Number(rawId);
    if (!/^[0-9]+$/.test(rawId.trim()) || !Number.isInteger(id) || id <= 0) throw new Error('line ' + (i + 2) + ': device_id must be a positive integer');
    const label = (rawLabel ?? '').trim();
    if (!label) throw new Error('line ' + (i + 2) + ': label required');
    return {device_id: id, label};
  });
}
