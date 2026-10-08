// Headless live diagnostics. Runs the real pipeline (AniList, MusicBrainz, Deezer, optional
// Wikipedia+AI) for a list of titles and writes plain-text results to ./out/ so they can be
// committed to a branch and read from GitHub without copy-pasting.
//   DIAG_TITLES="slime,jujutsu kaisen"  DIAG_OFFLINE=1 (seeds only)  ANTHROPIC_API_KEY (optional)
//   node scripts/diagnose.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnoseTitle } from '../src/app/diagnose.ts';
import { deezerResolver } from '../src/links/platforms.ts';
import { aniListResolver } from '../src/providers/anilist.ts';
import { animeThemesProvider } from '../src/providers/animethemes.ts';
import { curatedProvider } from '../src/providers/curated.ts';
import { musicBrainzResolver } from '../src/providers/musicbrainz.ts';
import { loadSeeds, seedMediaResolver } from '../src/providers/seeds.ts';
import { anthropicComplete, wikiLlmProvider } from '../src/providers/wikiLlm.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const titles = (process.env.DIAG_TITLES || 'slime,jujutsu kaisen,attack on titan').split(',').map((t) => t.trim()).filter(Boolean);
const offline = process.env.DIAG_OFFLINE === '1';
const ua = `MMDE-prototype/0.1 (personal, non-commercial; github.com/${process.env.GITHUB_REPOSITORY ?? 'SaiTejaVoonna/MMDE'})`;

const seeds = await loadSeeds(join(root, 'data', 'seeds'));
const providers = seeds.map((s) => curatedProvider(s));
const mediaResolvers = [seedMediaResolver(seeds)];
if (!offline) {
  mediaResolvers.push(aniListResolver());
  providers.push(animeThemesProvider());
  if (process.env.ANTHROPIC_API_KEY) providers.push(wikiLlmProvider({ complete: anthropicComplete(process.env.ANTHROPIC_API_KEY, process.env.MMDE_MODEL), userAgent: ua }));
}
const run = { providers, recordingResolver: offline ? undefined : musicBrainzResolver(ua), linkResolvers: offline ? [] : [deezerResolver()] };
const modeLabel = offline ? 'headless, OFFLINE (seeds only)' : `headless Node ${process.version} on ${process.platform}, live providers`;

const out = join(root, 'out');
await mkdir(out, { recursive: true });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rows: string[] = [];
const parts: string[] = [];
for (const t of titles) {
  console.log(`diagnosing "${t}" ...`);
  const d = await diagnoseTitle(t, { mediaResolvers, run, modeLabel, live: !offline });
  await writeFile(join(out, `${slug(t)}.txt`), d.text + '\n');
  const s = d.summary;
  rows.push(`| ${t} | ${s.title} | ${s.tracks} | ${s.confirmed} | ${s.suggested} | ${s.unverified} | ${s.errors} |`);
  parts.push(`## ${t}\n\n\`\`\`\n${d.text}\n\`\`\`\n`);
}
const head = `# MMDE live diagnostics\n\nGenerated ${new Date().toISOString()} - ${modeLabel}\n\n| query | resolved to | tracks | confirmed | suggested | unverified | errors |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n`;
const md = head + parts.join('\n');
await writeFile(join(out, 'latest.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
console.log(head);
