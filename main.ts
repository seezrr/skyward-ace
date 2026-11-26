// Halcyon hand-in (repository: skyward-ace). The game itself lives in game/ as static files; this
// Node 22 program copies those files and the captured screenshots to /output
// and builds the dossier the bounty's judge reads. Standard library only.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

// Fail fast rather than hand in a game with no browser captures to show.
if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error('game/index.html is missing');
}

mkdirSync(output, { recursive: true });
cpSync(gameDir, join(output, 'game'), { recursive: true });
mkdirSync(join(output, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(output, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(output, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(output, 'dossier.json'), dossier);
console.log('Halcyon: wrote game/, screenshots/ and dossier.json to', output);
