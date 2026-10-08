import { loadSeed, curatedProvider } from '../providers/curated.ts';
import { discover } from './discover.ts';
import { render } from './organize.ts';

// Usage: node src/app/cli.ts <seed.json>
// Offline run: curated seed only, no recording resolver -> everything is "unverified".
// Live providers (MusicBrainz, AniList, ...) plug in through the same interfaces.
const path = process.argv[2];
if (!path) {
  console.error('usage: node src/app/cli.ts <seed.json>');
  process.exit(2);
}
const seed = await loadSeed(path);
if (seed._status) console.error(`NOTE: ${seed._status}\n`);
const { tracks, errors } = await discover(seed.media, [curatedProvider(seed)]);
console.log(render(seed.media, tracks));
if (errors.length) console.error('\nerrors:\n' + errors.join('\n'));
