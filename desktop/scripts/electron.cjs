// Starts Electron as an app even when launched from a terminal that inherited
// ELECTRON_RUN_AS_NODE (VS Code's integrated terminal sets it).
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: require('node:path').join(__dirname, '..') });
child.on('close', (code) => process.exit(code ?? 0));
