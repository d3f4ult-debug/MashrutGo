// Start the API for the browser end-to-end suite.
//
// Node rather than a shell script: Playwright already runs on Node, so this works the same on
// macOS, Linux and Windows. It also picks the interpreter carefully -- `python3` is 3.9 on stock
// macOS while the backend needs 3.10+, and a plain `python3 -m uvicorn` there fails in a way that
// looks like a broken test run.
//
// The API gets a throwaway SQLite file, Andijon demo data and the offline routing provider, so a
// run never touches the network or anyone's local app.db.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND = join(HERE, '..', 'backend')
const IS_WINDOWS = process.platform === 'win32'
const MIN_PYTHON = [3, 10]

function versionOf(executable) {
  const probe = spawnSync(executable, ['-c', "import sys;print('%d.%d' % sys.version_info[:2])"], {
    encoding: 'utf8',
  })
  if (probe.status !== 0 || !probe.stdout) return null
  const [major, minor] = probe.stdout.trim().split('.').map(Number)
  return Number.isInteger(major) && Number.isInteger(minor) ? [major, minor] : null
}

function atLeast(version, minimum) {
  return version[0] > minimum[0] || (version[0] === minimum[0] && version[1] >= minimum[1])
}

function hasBackendDeps(executable) {
  return spawnSync(executable, ['-c', 'import uvicorn, fastapi'], { stdio: 'ignore' }).status === 0
}

function findPython() {
  const venv = IS_WINDOWS
    ? join(BACKEND, '.venv', 'Scripts', 'python.exe')
    : join(BACKEND, '.venv', 'bin', 'python')

  const candidates = existsSync(venv) ? [venv] : []
  // `python3` first among the system ones: on CI that is the interpreter the workflow installed
  // the dependencies into, while a versioned `python3.12` may exist without them.
  candidates.push('python3', 'python', 'python3.13', 'python3.12', 'python3.11', 'python3.10')

  const newEnough = []
  for (const candidate of candidates) {
    const version = versionOf(candidate)
    if (!version || !atLeast(version, MIN_PYTHON)) continue
    newEnough.push(candidate)
    // Both conditions matter: the right version AND the backend's dependencies. Picking on
    // version alone lands on an interpreter that cannot import uvicorn, and Playwright then
    // just times out waiting for a server that was never going to start.
    if (hasBackendDeps(candidate)) return candidate
  }

  const hint = IS_WINDOWS ? 'start.cmd --backend-only' : './start.sh --backend-only'
  console.error(
    newEnough.length
      ? [
          '',
          `  Python ${MIN_PYTHON.join('.')}+ bor, lekin hech birida backend kutubxonalari yo'q.`,
          `  Ko'rilganlari: ${newEnough.join(', ')}`,
          '',
          '  Yeching:',
          `      ${hint}`,
          `  yoki: ${newEnough[0]} -m pip install -r backend/requirements.txt`,
          '',
        ].join('\n')
      : [
          '',
          `  Python ${MIN_PYTHON.join('.')}+ topilmadi.`,
          '',
          '  Eng oson yechim — loyihani bir marta ishga tushiring, u venv yaratadi:',
          `      ${hint}`,
          '',
        ].join('\n'),
  )
  process.exit(1)
}

const python = findPython()

const dbFile = process.env.E2E_DB_FILE || join(BACKEND, 'e2e.db')
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${dbFile}${suffix}`, { force: true })
}

const child = spawn(
  python,
  ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--log-level', 'warning'],
  {
    cwd: BACKEND,
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_ENV: 'test',
      DATABASE_URL: `sqlite:///${dbFile}`,
      AUTO_MIGRATE: 'true',
      SEED_DEMO_DATA: 'true',
      PAYMENTS_SANDBOX: 'true',
      ROUTING_PROVIDER: 'geodesic',
      MAPTILER_API_KEY: '',
      FCM_ENABLED: 'false',
      BACKGROUND_SWEEP_INTERVAL_SECONDS: '5',
      PYTHONUNBUFFERED: '1',
      // The suite drives the UI hard on purpose; per-address throttling would fail honest runs.
      LOGIN_MAX_ATTEMPTS: '100000',
      RATE_LIMIT_ROUTE_SEARCH_PER_MINUTE: '100000',
      RATE_LIMIT_ETA_PER_MINUTE: '100000',
      RATE_LIMIT_WATCH_START_PER_MINUTE: '100000',
    },
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code) => process.exit(code ?? 0))
