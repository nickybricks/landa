const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function isNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    message.includes('internet connection appears to be offline') ||
    message.includes('nsurlerrordomain code=-1009') ||
    message.includes('no network route') ||
    message.includes('network') ||
    message.includes('timed out')
  );
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
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
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), output });
        return;
      }

      reject(new Error(`${command} ${args[0] || ''} failed with exit code ${code}\n${output}`.trim()));
    });
  });
}

function getAuthArgs() {
  return [
    '--apple-id',
    process.env.APPLE_ID,
    '--password',
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    '--team-id',
    process.env.APPLE_TEAM_ID,
  ];
}

async function zipApp(appPath, zipPath) {
  await runCommand(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', path.basename(appPath), zipPath],
    { cwd: path.dirname(appPath) }
  );
}

async function submitForNotarization(filePath) {
  const result = await runCommand('xcrun', [
    'notarytool',
    'submit',
    filePath,
    ...getAuthArgs(),
    '--no-progress',
    '--output-format',
    'json',
  ]);

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse notarization submit response\n${result.output}`);
  }
}

async function getNotarizationInfo(submissionId) {
  const result = await runCommand('xcrun', [
    'notarytool',
    'info',
    submissionId,
    ...getAuthArgs(),
    '--output-format',
    'json',
  ]);

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Failed to parse notarization status response\n${result.output}`);
  }
}

async function getNotarizationLog(submissionId) {
  try {
    const result = await runCommand('xcrun', [
      'notarytool',
      'log',
      submissionId,
      '-',
      ...getAuthArgs(),
    ]);
    return result.output;
  } catch (error) {
    return redactSecrets(error?.message || error);
  }
}

async function stapleApp(appPath) {
  await runCommand('xcrun', ['stapler', 'staple', '-v', appPath]);
  await runCommand('xcrun', ['stapler', 'validate', '-v', appPath]);
}

async function notarizeApp(appPath, timeoutMs) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'landa-notarize-'));
  const zipPath = path.join(tempDir, `${path.parse(appPath).name}.zip`);

  try {
    await zipApp(appPath, zipPath);
    const submission = await submitForNotarization(zipPath);
    const submissionId = submission.id;

    if (!submissionId) {
      throw new Error(`Notary submission did not return an id\n${redactSecrets(JSON.stringify(submission, null, 2))}`);
    }

    console.log(`Notary submission created: ${submissionId}`);

    const deadline = Date.now() + timeoutMs;
    const pollIntervalMs = 30000;

    while (Date.now() < deadline) {
      const info = await getNotarizationInfo(submissionId);
      const status = String(info.status || '');
      console.log(`Notary status: ${status}`);

      if (status === 'Accepted') {
        await stapleApp(appPath);
        return;
      }

      if (status === 'Invalid' || status === 'Rejected') {
        const logOutput = await getNotarizationLog(submissionId);
        throw new Error(
          `Notarization failed with status ${status} for submission ${submissionId}\n` +
          `${redactSecrets(JSON.stringify(info, null, 2))}\n\n` +
          `Notary log:\n${logOutput}`
        );
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(
      `Notarization timed out after ${Math.round(timeoutMs / 60000)} minute(s) for submission ${submissionId}. ` +
      'The submission may still finish on Apple’s side; you can inspect it with `xcrun notarytool info <submission-id> ...`.'
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = async function afterSign(context) {
  if (process.platform !== 'darwin') return;

  if (process.env.LANDA_REQUIRE_NOTARIZATION !== '1') {
    console.log('Skipping notarization: LANDA_REQUIRE_NOTARIZATION is not set to 1');
    return;
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    throw new Error(
      'Notarization required because LANDA_REQUIRE_NOTARIZATION=1, but APPLE_ID / ' +
      'APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID are not all set. ' +
      'For a local unsigned build, run without LANDA_REQUIRE_NOTARIZATION. ' +
      'For a notarized build, export the Apple credentials first.'
    );
  }

  if (!context.appOutDir || !context.packager?.appInfo?.productFilename) {
    throw new Error('Notarization required, but the packaged app path could not be determined');
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;
  const notarizeTimeoutMs = Number(process.env.LANDA_NOTARIZE_TIMEOUT_MS || 20 * 60 * 1000);

  console.log(`Notarizing ${appPath}...`);

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await notarizeApp(appPath, notarizeTimeoutMs);
      console.log('Notarization complete.');
      return;
    } catch (error) {
      const finalAttempt = attempt === attempts;
      const retryable = isNetworkError(error);

      if (retryable && !finalAttempt) {
        const delayMs = attempt * 15000;
        console.warn(`Notarization attempt ${attempt} failed with a network error. Retrying in ${delayMs / 1000}s...`);
        await sleep(delayMs);
        continue;
      }

      if (retryable) {
        throw new Error(
          `Notarization failed after ${attempts} attempts because Apple notary services were unreachable. ` +
          'The app was signed, but the mac release cannot be published as notarized.\n' +
          redactSecrets(String(error?.stack || error))
        );
      }

      throw error;
    }
  }

  throw new Error('Notarization exited unexpectedly');
};
