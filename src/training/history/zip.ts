import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import type { ArchiveReader } from './strava';

// Stream a (possibly multi-GB) Strava archive and keep only what we need:
// activities.csv and the per-activity files. Photos and media are skipped
// without being inflated. Works on any web ReadableStream (browser File.stream()
// or Node's Readable.toWeb()).

const WANT = /(^|\/)activities\.csv$|(^|\/)activities\/[^/]+\.(fit|tcx|gpx)(\.gz)?$/i;

export async function readZipStream(stream: ReadableStream<Uint8Array>, onBytes?: (n: number) => void): Promise<ArchiveReader> {
  const files = new Map<string, Uint8Array>();
  const pending: Array<Promise<void>> = [];
  const unzip = new Unzip((entry) => {
    if (!WANT.test(entry.name)) return;
    const chunks: Uint8Array[] = [];
    pending.push(
      new Promise<void>((resolve, reject) => {
        entry.ondata = (err, chunk, final) => {
          if (err) return reject(err);
          chunks.push(chunk);
          if (final) {
            const size = chunks.reduce((s, c) => s + c.length, 0);
            const out = new Uint8Array(size);
            let off = 0;
            for (const c of chunks) {
              out.set(c, off);
              off += c.length;
            }
            files.set(entry.name.replace(/^.*?(activities)/i, '$1'), out);
            resolve();
          }
        };
        entry.start();
      }),
    );
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onBytes?.(value.length);
    unzip.push(value);
  }
  unzip.push(new Uint8Array(0), true);
  await Promise.all(pending);
  const csvKey = [...files.keys()].find((k) => /activities\.csv$/i.test(k));
  if (!csvKey) throw new Error('No activities.csv in this archive. Is it the Strava "Download your archive" zip?');
  return {
    csv: new TextDecoder().decode(files.get(csvKey)!),
    file: (path) => files.get(path) ?? files.get(path.replace(/^.*?(activities\/)/i, '$1')),
  };
}
