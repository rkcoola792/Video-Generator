import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isWindowsArm64 = process.platform === 'win32' && process.arch === 'arm64';
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const command = isWindowsArm64 ? 'powershell.exe' : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = isWindowsArm64
  ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${projectRoot}scripts\\dev-x64.ps1`]
  : ['run', 'dev:server'];
const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32' && !isWindowsArm64 });

child.on('error', (error) => {
  console.error(`Could not start the video studio: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
