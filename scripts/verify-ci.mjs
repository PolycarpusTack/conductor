import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ownedFixtures = new WeakMap()
const FIXTURE_PREFIX = 'agentboard-ci-'

class VerificationError extends Error {
  constructor(label, detail, exitCode = 1) {
    super(`[verify-ci:${label}] ${detail}`)
    this.label = label
    this.exitCode = exitCode
  }
}

function assertNoDotenv(cwd) {
  // Bun and Next have independent dotenv loaders. Check names only: a clean
  // child environment alone does not keep the build away from a live database.
  const filename = readdirSync(cwd).find(name =>
    name !== '.env.example' && (name === '.env' || name.startsWith('.env.')),
  )
  if (filename) throw new VerificationError('inputs', `dotenv file present: ${filename}; use a fresh checkout`)
}

function assertInputs(cwd, env) {
  const inheritedDatabase = Object.entries(env).some(([key, value]) =>
    key.toUpperCase() === 'DATABASE_URL' && value !== undefined && String(value).length > 0,
  )
  if (inheritedDatabase) throw new VerificationError('inputs', 'inherited DATABASE_URL is forbidden; use a clean job environment')
  assertNoDotenv(cwd)
}

/** Opaque, immutable handle: cleanup never accepts a caller-supplied path. */
export function createFixture(tempParent = tmpdir()) {
  const parent = realpathSync(tempParent)
  const root = realpathSync(mkdtempSync(join(parent, FIXTURE_PREFIX)))
  const handle = Object.freeze({ root, databaseUrl: `file:${join(root, 'fixture.sqlite').replaceAll('\\', '/')}` })
  const identity = lstatSync(root)
  ownedFixtures.set(handle, { root, parent, dev: identity.dev, ino: identity.ino, removed: false })
  try {
    mkdirSync(join(root, 'home'))
    mkdirSync(join(root, 'tmp'))
    mkdirSync(join(root, 'git-template'))
    mkdirSync(join(root, 'git-hooks'))
    writeFileSync(join(root, 'git-config'), '')
    return handle
  } catch (error) {
    cleanupFixture(handle)
    throw error
  }
}

function assertUnlinkedTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name)
    const stat = lstatSync(child)
    if (stat.isSymbolicLink()) throw new VerificationError('cleanup', 'linked fixture entry; refusing recursive deletion')
    if (stat.isDirectory()) assertUnlinkedTree(child)
  }
}

/** Refuse sibling paths, replacement roots, symlinks and Windows junctions. */
export function cleanupFixture(handle) {
  const owned = ownedFixtures.get(handle)
  if (!owned) throw new VerificationError('cleanup', 'unowned fixture; refusing deletion')
  if (owned.removed) return
  const { root, parent } = owned
  const stat = lstatSync(root, { throwIfNoEntry: false })
  if (!stat) {
    owned.removed = true
    return
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(root) !== root ||
      dirname(root) !== parent || realpathSync(parent) !== parent || !basename(root).startsWith(FIXTURE_PREFIX) ||
      stat.dev !== owned.dev || stat.ino !== owned.ino) {
    throw new VerificationError('cleanup', 'fixture identity changed; refusing deletion')
  }
  assertUnlinkedTree(root)
  // The resolved absolute target is a direct child of the canonical temp parent
  // created by this process. No shell, glob, caller-supplied path or other root.
  rmSync(root, { recursive: true, force: false })
  owned.removed = true
}

function childEnvironment(inherited, fixture) {
  const allowed = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'])
  const env = {}
  for (const [key, value] of Object.entries(inherited)) {
    if (allowed.has(key.toUpperCase()) && value !== undefined) env[key.toUpperCase()] = String(value)
  }
  return {
    ...env,
    CI: '1',
    DATABASE_URL: fixture.databaseUrl,
    // Satisfy actual production validation without bypassing it or inheriting
    // credentials. These values exist only in this run's disposable children.
    AGENTBOARD_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
    AGENTBOARD_ADMIN_SESSION_SECRET: randomBytes(24).toString('hex'),
    AGENTBOARD_WS_SECRET: randomBytes(24).toString('hex'),
    AGENTBOARD_WS_INTERNAL_SECRET: randomBytes(24).toString('hex'),
    HOME: join(fixture.root, 'home'),
    USERPROFILE: join(fixture.root, 'home'),
    TMPDIR: join(fixture.root, 'tmp'),
    TEMP: join(fixture.root, 'tmp'),
    TMP: join(fixture.root, 'tmp'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(fixture.root, 'git-config'),
    GIT_CONFIG_SYSTEM: join(fixture.root, 'git-config'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: join(fixture.root, 'git-hooks'),
    GIT_TEMPLATE_DIR: join(fixture.root, 'git-template'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Conductor CI',
    GIT_AUTHOR_EMAIL: 'conductor-ci@example.invalid',
    GIT_COMMITTER_NAME: 'Conductor CI',
    GIT_COMMITTER_EMAIL: 'conductor-ci@example.invalid',
    NEXT_TELEMETRY_DISABLED: '1',
    CHECKPOINT_DISABLE: '1',
    PRISMA_HIDE_UPDATE_MESSAGE: '1',
    PRISMA_GENERATE_SKIP_AUTOINSTALL: '1',
    npm_config_offline: 'true',
  }
}

/** Application-owned process port. Never shell-interpolate args or print env. */
export function runCommand({ label, command, args, cwd, env, capture = false }) {
  return new Promise((fulfill, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let overflow = false
    child.stdout.on('data', chunk => {
      if (!capture) process.stdout.write(chunk)
      else if (stdout.length + chunk.length <= 65_536) stdout += chunk.toString()
      else {
        overflow = true
        child.kill()
      }
    })
    child.stderr.on('data', chunk => {
      if (!capture) process.stderr.write(chunk)
    })
    child.on('error', () => reject(new VerificationError(label, 'could not start required executable', 127)))
    child.on('close', (code, signal) => {
      if (overflow) reject(new VerificationError(label, 'captured output exceeded its safety limit'))
      else if (code !== 0) reject(new VerificationError(label, signal ? 'child terminated by signal' : `child exited with code ${code}`, code || 1))
      else fulfill(stdout)
    })
  })
}

/** Fresh-checkout verification; local development diagnostics remain separate. */
export async function verifyCi({
  cwd = process.cwd(),
  env = process.env,
  tempParent = tmpdir(),
  nodeExecutable = process.execPath,
  bunExecutable = 'bun',
  runCommand: execute = runCommand,
} = {}) {
  cwd = realpathSync(cwd)
  assertInputs(cwd, env)
  const fixture = createFixture(tempParent)
  const childEnv = childEnvironment(env, fixture)
  let failure
  const run = async (label, command, args, capture = false) => {
    assertNoDotenv(cwd)
    console.log(`[verify-ci:${label}] starting`)
    return execute({ label, command, args, cwd, env: childEnv, capture })
  }
  try {
    const nodeVersion = (await run('runtime:node', nodeExecutable, ['--version'], true)).trim()
    if (!/^v22\.\d+\.\d+$/.test(nodeVersion)) throw new VerificationError('runtime:node', 'Node 22.x is required')
    const bunVersion = (await run('runtime:bun', bunExecutable, ['--no-env-file', '--no-install', '--version'], true)).trim()
    if (bunVersion !== '1.3.13') throw new VerificationError('runtime:bun', 'Bun 1.3.13 is required')
    const status = await run('checkout', 'git', ['status', '--porcelain', '--untracked-files=all'], true)
    if (status.trim() || existsSync(join(cwd, '.next'))) {
      throw new VerificationError('checkout', 'a fresh, clean checkout without .next build output is required')
    }

    const prismaCli = join(cwd, 'node_modules', 'prisma', 'build', 'index.js')
    if (!existsSync(prismaCli)) throw new VerificationError('prisma', 'installed Prisma CLI is missing; install the frozen lockfile first')
    await run('prisma:validate', nodeExecutable, [prismaCli, 'validate'])
    await run('prisma:generate', nodeExecutable, [prismaCli, 'generate'])
    if (!existsSync(join(cwd, 'src', 'generated', 'prisma', 'client.ts'))) {
      throw new VerificationError('prisma:generate', 'generation finished without the expected client.ts output')
    }
    // A brand-new owned database only. This is fixture setup, not a migration
    // check or an upgrade procedure. No --accept-data-loss, reset, or download.
    await run('prisma:db-push', nodeExecutable, [prismaCli, 'db', 'push'])
    const bunRun = ['--no-env-file', '--no-install', 'run']
    await run('type-check', bunExecutable, [...bunRun, 'type-check'])
    await run('lint', bunExecutable, [...bunRun, 'lint'])
    await run('test', bunExecutable, [...bunRun, 'test'])
    await run('doctor', bunExecutable, [...bunRun, 'doctor', '--offline', '--json'])
    await run('build', bunExecutable, [...bunRun, 'build'])
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      cleanupFixture(fixture)
    } catch (error) {
      if (!failure) throw error
      // Preserve the original stage's nonzero result; never conceal an unsafe
      // cleanup failure behind it and never print the inherited environment.
      console.error('[verify-ci:cleanup] cleanup refused or failed; inspect the owned fixture manually')
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCi().then(() => console.log('[verify-ci] all required checks passed')).catch(error => {
    console.error(error instanceof VerificationError ? error.message : '[verify-ci] unexpected failure; verification did not pass')
    process.exitCode = error instanceof VerificationError ? error.exitCode : 1
  })
}
