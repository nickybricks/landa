const { execSync } = require('child_process');
const path = require('path');

module.exports = async function() {
  const scriptsDir = __dirname;
  if (process.platform === 'win32') {
    execSync(
      `powershell -ExecutionPolicy Bypass -File "${path.join(scriptsDir, 'build_backend.ps1')}"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`bash "${path.join(scriptsDir, 'build_backend.sh')}"`, { stdio: 'inherit' });
  }
};
