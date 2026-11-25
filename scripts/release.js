// Publie la version actuelle (package.json) sur GitHub Releases avec gh.
// Prérequis : `npm run dist` déjà lancé et `gh auth login` fait.
// Usage : npm run release -- [notes.md]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');

const files = [
  `InputMemory-Setup-${version}.exe`,
  `InputMemory-Setup-${version}.exe.blockmap`,
  `InputMemory-Portable-${version}.exe`,
  'latest.yml', // lu par la mise à jour automatique
].map((f) => path.join(dist, f));

const missing = files.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error('Fichiers manquants (lance d\'abord `npm run dist`) :\n' + missing.join('\n'));
  process.exit(1);
}
const latest = fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8');
if (!latest.includes(`version: ${version}`)) {
  console.error(`latest.yml ne correspond pas à la version ${version} : relance \`npm run dist\`.`);
  process.exit(1);
}

const gh = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'].find((cmd) => {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
});
if (!gh) {
  console.error('gh introuvable : installe GitHub CLI puis fais `gh auth login`.');
  process.exit(1);
}

const notes = process.argv[2];
const args = ['release', 'create', `v${version}`, ...files, '--target', 'main', '--title', `InputMemory ${version}`];
args.push(...(notes ? ['--notes-file', notes] : ['--generate-notes']));
execFileSync(gh, args, { stdio: 'inherit', cwd: root });
