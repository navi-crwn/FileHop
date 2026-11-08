// Runs FileHop the way it will run on file.hel.ink, on one machine: the Go
// server (web/dist embedded) on :8095 and the hub stub on :8097 standing in for
// hub.hel.ink and Imperium. Both share a throwaway secret kept in .run/dev.env.
//
//   npm run build && npm run local        → http://localhost:8095
//
// Needs Go (on PATH, in ~/.local/go, or GO=/path/to/go). Stop with Ctrl+C.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url))); // the repository root, wherever this was started from
mkdirSync('.run', { recursive: true });
if (!existsSync('.run/dev.env')) writeFileSync('.run/dev.env', `FILEHOP_SSO_SECRET=${randomBytes(24).toString('base64url')}\n`);
const secret = readFileSync('.run/dev.env', 'utf8').match(/FILEHOP_SSO_SECRET=(\S+)/)[1];
const exe = process.platform === 'win32' ? '.exe' : '';
// GO=/path/to/go wins; else a user-level install in ~/.local/go; else go on PATH
const userGo = join(homedir(), '.local', 'go', 'bin', 'go' + exe);
const go = process.env.GO ?? (existsSync(userGo) ? userGo : 'go');

for (const [out, pkg] of [[`.run/filehop${exe}`, './cmd/filehop'], [`.run/hubstub${exe}`, './tools/hubstub']]) {
  execFileSync(go, ['build', '-ldflags', '-X main.version=dev-local', '-o', out, pkg], { stdio: 'inherit' });
}

const env = {
  ...process.env,
  FILEHOP_SSO_SECRET: secret,
  FILEHOP_SSO_URL: 'http://localhost:8097',
  FILEHOP_BASE_URL: 'http://localhost:8095',
  FILEHOP_ADDR: '127.0.0.1:8095',
  FILEHOP_DB: '.run/filehop.db',
  FILEHOP_URL: 'http://localhost:8095',
  STUB_ADDR: '127.0.0.1:8097'
};
const kids = [spawn(`.run/filehop${exe}`, [], { env, stdio: 'inherit' }), spawn(`.run/hubstub${exe}`, [], { env, stdio: 'inherit' })];
const stop = () => { for (const k of kids) k.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const k of kids) k.on('exit', code => { if (code) { console.error(`a process exited with ${code}`); stop(); } });
console.log('\nFileHop  http://localhost:8095   (sign in → the stub hub on http://localhost:8097)\n');
