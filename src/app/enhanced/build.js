const { execSync } = require('child_process');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const cmd = [
    'npx -y esbuild',
    JSON.stringify(path.join(__dirname, 'src', 'index.ts')),
    '--bundle',
    '--format=iife',
    '--loader:.html=text',
    '--target=es2020',
    `--outfile=${JSON.stringify(path.join(__dirname, 'enhanced.js'))}`,
    isWatch ? '--watch' : ''
].filter(Boolean).join(' ');

console.log('[Enhanced Builder] Compiling TypeScript & HTML templates into enhanced.js...');
try {
    execSync(cmd, { stdio: 'inherit', cwd: __dirname });
    console.log('[Enhanced Builder] Successfully built enhanced.js');
} catch (err) {
    console.error('[Enhanced Builder] Build failed:', err);
    process.exit(1);
}
