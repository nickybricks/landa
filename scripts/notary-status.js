const { spawn } = require('child_process');

function redactSecrets(text) {
  let output = String(text || '');
  for (const secret of [
    process.env.APPLE_ID,
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    process.env.APPLE_TEAM_ID,
  ]) {
    if (secret) {
      output = output.split(secret).join('[REDACTED]');
    }
  }
  return output;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code) => {
      const output = redactSecrets(`${stdout}${stderr}`.trim());
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(output || `Command failed with exit code ${code}`));
    });
  });
}

function getAuthArgs() {
  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    throw new Error(
      'APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must be set before checking notarization status.'
    );
  }

  return [
    '--apple-id',
    process.env.APPLE_ID,
    '--password',
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id',
    process.env.APPLE_TEAM_ID,
  ];
}

async function getHistory() {
  const raw = await runCommand('xcrun', [
    'notarytool',
    'history',
    ...getAuthArgs(),
    '--output-format',
    'json',
  ]);

  return JSON.parse(raw).history || [];
}

async function getInfo(submissionId) {
  const raw = await runCommand('xcrun', [
    'notarytool',
    'info',
    submissionId,
    ...getAuthArgs(),
    '--output-format',
    'json',
  ]);

  return JSON.parse(raw);
}

async function main() {
  const limit = Number(process.argv[2] || 5);
  const history = await getHistory();

  if (history.length === 0) {
    console.log('No notarization submissions found.');
    return;
  }

  const recent = history.slice(0, limit);
  for (const item of recent) {
    const info = await getInfo(item.id);
    console.log([
      `id: ${info.id}`,
      `created: ${info.createdDate}`,
      `name: ${info.name}`,
      `status: ${info.status}`,
    ].join('\n'));
    console.log('');
  }
}

main().catch((error) => {
  console.error(redactSecrets(error?.stack || error?.message || String(error)));
  process.exit(1);
});
