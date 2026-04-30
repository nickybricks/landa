const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function () {
  const scriptsDir = __dirname;
  const repoRoot = path.dirname(scriptsDir);
  const constantsPath = path.join(repoRoot, 'backend', 'landa_constants.py');

  // Bake LANDA_PROXY_URL / LANDA_APP_SECRET into landa_constants.py as
  // Python string literals so PyInstaller embeds them in the bundled binary.
  // Restored to the env-reading version after the build finishes so local dev
  // state isn't dirtied.
  const originalContent = fs.readFileSync(constantsPath, 'utf8');
  const proxyUrl = process.env.LANDA_PROXY_URL || '';
  const appSecret = process.env.LANDA_APP_SECRET || '';
  if (!proxyUrl || !appSecret) {
    console.warn(
      '[before_build] LANDA_PROXY_URL and/or LANDA_APP_SECRET unset — bundling empty constants. Modes will be inert in the resulting build.',
    );
  }
  fs.writeFileSync(
    constantsPath,
    [
      '"""Auto-generated at build time. Do not edit."""',
      `LANDA_PROXY_URL = ${JSON.stringify(proxyUrl)}`,
      `LANDA_APP_SECRET = ${JSON.stringify(appSecret)}`,
      '',
    ].join('\n'),
  );

  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -ExecutionPolicy Bypass -File "${path.join(scriptsDir, 'build_backend.ps1')}"`,
        { stdio: 'inherit' },
      );
    } else {
      execSync(`bash "${path.join(scriptsDir, 'build_backend.sh')}"`, { stdio: 'inherit' });
    }
  } finally {
    fs.writeFileSync(constantsPath, originalContent);
  }
};
