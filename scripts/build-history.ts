import { writeFileSync } from 'node:fs';
import { buildHistory } from './strava-mcp-history';

// snapshots/strava-mcp/*.tsv -> snapshots/history.json (gitignored)
const rides = buildHistory();
writeFileSync('snapshots/history.json', JSON.stringify({ source: 'strava-mcp', builtAt: new Date().toISOString(), rides }));
console.log(`${rides.length} records -> snapshots/history.json`);
