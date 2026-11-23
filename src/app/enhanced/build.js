const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWatch = process.argv.includes('--watch');

function findLocalEsbuild() {
    const localBin = path.join(__dirname, 'node_modules', '.bin', 'esbuild');
    if (fs.existsSync(localBin)) {
        return JSON.stringify(localBin);
    }

    const npxCacheDir = path.join(os.homedir(), '.npm', '_npx');
    if (fs.existsSync(npxCacheDir)) {
        for (const entry of fs.readdirSync(npxCacheDir)) {
            const candidate = path.join(npxCacheDir, entry, 'node_modules', '.bin', 'esbuild');
            if (fs.existsSync(candidate)) {
                return JSON.stringify(candidate);
            }
        }
    }

    return 'npx -y esbuild';
}

const cmd = [
    findLocalEsbuild(),
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
