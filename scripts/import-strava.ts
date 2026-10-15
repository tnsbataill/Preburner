import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { readArchive, toRideRecords } from '../src/training/history/strava';
import type { ArchiveReader } from '../src/training/history/strava';
import { readZipStream } from '../src/training/history/zip';

// Strava archive (zip or extracted folder) -> snapshots/history.json
//   npx vite-node scripts/import-strava.ts <export.zip | folder> [timezone] [fallbackFtp]
// Everything stays local: snapshots/ is gitignored.

const [src, tz = Intl.DateTimeFormat().resolvedOptions().timeZone, ftpArg = '250'] = process.argv.slice(2);
if (!src || !existsSync(src)) {
  console.error('Usage: npx vite-node scripts/import-strava.ts <export.zip | folder> [timezone] [fallbackFtp]');
  process.exit(1);
}

async function open(): Promise<ArchiveReader> {
  if (statSync(src).isDirectory()) {
    const csvPath = [join(src, 'activities.csv'), ...readdirSync(src).map((d) => join(src, d, 'activities.csv'))].find(existsSync);
    if (!csvPath) throw new Error(`No activities.csv under ${src}`);
    const root = csvPath.replace(/activities\.csv$/, '');
    return { csv: readFileSync(csvPath, 'utf8'), file: (p) => (existsSync(join(root, p)) ? new Uint8Array(readFileSync(join(root, p))) : undefined) };
  }
  let read = 0;
  const total = statSync(src).size;
  return readZipStream(Readable.toWeb(createReadStream(src)) as ReadableStream<Uint8Array>, (n) => {
    read += n;
    process.stdout.write(`\rreading ${(read / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
  });
}

const reader = await open();
console.log('\nparsing activities…');
const header = reader.csv.split('\n')[0];
console.log(`activities.csv columns: ${header}`);
const { activities, report } = readArchive(reader, tz);
const rides = toRideRecords(activities, Number(ftpArg));
mkdirSync('snapshots', { recursive: true });
writeFileSync('snapshots/history.json', JSON.stringify({ source: 'strava', importedAt: new Date().toISOString(), timezone: tz, report, rides }));
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${rides.length} rides to snapshots/history.json`);
