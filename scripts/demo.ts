import { createFakeProvider } from '../src/adapters/fake.js';
import { buildWindows } from '../src/calc/prescribe.js';
import { allocateWeeklyDeficits } from '../src/calc/weekly.js';
import { sampleProfile } from '../src/samples/profile.js';

interface CliOptions {
  startISO: string;
  endISO: string;
  omitPlannedKj: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    startISO: '2024-06-10T00:00:00.000Z',
    endISO: '2024-06-20T00:00:00.000Z',
    omitPlannedKj: false,
  };

  for (const arg of argv) {
    if (arg === '--omit-kj') {
      options.omitPlannedKj = true;
    } else if (arg.startsWith('--start=')) {
      options.startISO = normalizeISO(arg.slice('--start='.length));
    } else if (arg.startsWith('--end=')) {
      options.endISO = normalizeISO(arg.slice('--end='.length));
    }
  }

  if (process.env.FAKE_OMIT_KJ === '1') {
    options.omitPlannedKj = true;
  }

  return options;
}

function normalizeISO(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO date provided: ${value}`);
  }
  return new Date(ms).toISOString();
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const provider = createFakeProvider({ omitPlannedKj: args.omitPlannedKj });
  const workouts = await provider.getPlannedWorkouts(args.startISO, args.endISO);

  if (workouts.length === 0) {
    console.error('No workouts returned for the requested window.');
    process.exitCode = 1;
    return;
  }

  const windows = buildWindows(sampleProfile, workouts);
  const { windows: adjustedWindows, weekly } = allocateWeeklyDeficits(sampleProfile, windows, workouts);

  const output = {
    windows: adjustedWindows,
    weekly,
  };

  console.log(JSON.stringify(output, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
