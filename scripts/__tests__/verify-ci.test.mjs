import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { cleanupFixture, createFixture, runCommand, verifyCi } from '../verify-ci.mjs'

// These are filesystem/child-process integration tests. The sole replaceable
// collaborator is our own runCommand port; no Node, Git or Prisma API is mocked.
function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentboard-ci-test-'))
  const cwd = join(root, 'checkout with spaces')
  const tempParent = join(root, 'owned fixtures')
  mkdirSync(cwd)
  mkdirSync(tempParent)
  t.after(() => {
    assert.equal(resolve(root), root)
    assert.ok(root.startsWith(join(tmpdir(), 'agentboard-ci-test-')))
    rmSync(root, { recursive: true, force: true })
  })
  return { root, cwd, tempParent }
}

function installedPrisma(cwd) {
  const cli = join(cwd, 'node_modules', 'prisma', 'build', 'index.js')
  mkdirSync(dirname(cli), { recursive: true })
  writeFileSync(cli, '// Local CLI fixture; command seam controls execution.\n')
}

function commandSequence(entries) {
  const queue = [...entries]
  return async command => {
    const entry = queue.shift()
    assert.equal(command.label, entry.label)
    return entry.result
  }
}

test('verifyCi, inherited database URL, refuses without touching the external database', async t => {
  const context = workspace(t)
  const database = join(context.root, 'external.sqlite')
  writeFileSync(database, 'external database sentinel')

  const operation = verifyCi({ ...context, env: { DATABASE_URL: `file:${database}` } })

  await assert.rejects(operation, /inherited DATABASE_URL/)
  assert.equal(readFileSync(database, 'utf8'), 'external database sentinel')
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, dotenv loading file, refuses without reading or rewriting it', async t => {
  const context = workspace(t)
  const dotenv = join(context.cwd, '.env.production.local')
  writeFileSync(dotenv, 'DO_NOT_DISCLOSE=private-value')

  const operation = verifyCi({ ...context, env: {} })

  await assert.rejects(operation, /dotenv file present.*\.env\.production\.local/)
  assert.equal(readFileSync(dotenv, 'utf8'), 'DO_NOT_DISCLOSE=private-value')
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, absent Node executable, reports runtime failure and cleans its fixture', async t => {
  const context = workspace(t)

  const operation = verifyCi({ ...context, env: {}, nodeExecutable: join(context.root, 'missing-node') })

  await assert.rejects(operation, { label: 'runtime:node', exitCode: 127 })
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, absent Bun executable and allowed env example, fails clearly after Node check', async t => {
  const context = workspace(t)
  writeFileSync(join(context.cwd, '.env.example'), 'EXAMPLE=placeholder')

  const operation = verifyCi({ ...context, env: { PATH: process.env.PATH }, nodeExecutable: 'node', bunExecutable: join(context.root, 'missing-bun') })

  await assert.rejects(operation, { label: 'runtime:bun', exitCode: 127 })
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, unsupported Node major, stops before running tooling', async t => {
  const context = workspace(t)
  const execute = commandSequence([{ label: 'runtime:node', result: 'v20.19.0\n' }])

  const operation = verifyCi({ ...context, env: {}, runCommand: execute })

  await assert.rejects(operation, /Node 22/)
})

test('verifyCi, unsupported Bun version, stops before schema setup', async t => {
  const context = workspace(t)
  const execute = commandSequence([
    { label: 'runtime:node', result: 'v22.15.0\n' },
    { label: 'runtime:bun', result: '1.3.4\n' },
  ])

  const operation = verifyCi({ ...context, env: {}, runCommand: execute })

  await assert.rejects(operation, /Bun 1\.3\.13/)
})

test('verifyCi, dirty checkout, refuses before schema mutation', async t => {
  const context = workspace(t)
  const execute = commandSequence([
    { label: 'runtime:node', result: 'v22.15.0\n' },
    { label: 'runtime:bun', result: '1.3.13\n' },
    { label: 'checkout', result: ' M src/example.ts\n' },
  ])

  const operation = verifyCi({ ...context, env: {}, runCommand: execute })

  await assert.rejects(operation, /fresh, clean checkout/)
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('cleanupFixture, two owned runs, uses unique roots and permits repeated cleanup', t => {
  const context = workspace(t)
  const first = createFixture(context.tempParent)
  const second = createFixture(context.tempParent)

  cleanupFixture(first)
  cleanupFixture(first)

  assert.notEqual(first.root, second.root)
  assert.equal(existsSync(first.root), false)
  assert.equal(existsSync(second.root), true)
  cleanupFixture(second)
})

test('cleanupFixture, forged sibling handle, refuses and preserves its sentinel', t => {
  const context = workspace(t)
  const sibling = join(context.tempParent, 'agentboard-ci-forged')
  mkdirSync(sibling)
  writeFileSync(join(sibling, 'sentinel'), 'keep sibling')

  const operation = () => cleanupFixture({ root: sibling })

  assert.throws(operation, /unowned fixture/)
  assert.equal(readFileSync(join(sibling, 'sentinel'), 'utf8'), 'keep sibling')
})

test('cleanupFixture, forged parent traversal target, refuses the parent directory', t => {
  const context = workspace(t)

  const operation = () => cleanupFixture({ root: join(context.tempParent, '..') })

  assert.throws(operation, /unowned fixture/)
  assert.equal(existsSync(context.cwd), true)
})

test('cleanupFixture, owned root replaced by a junction, refuses without following it', t => {
  const context = workspace(t)
  const fixture = createFixture(context.tempParent)
  const original = join(context.tempParent, 'original-fixture')
  const external = join(context.root, 'external-directory')
  mkdirSync(external)
  writeFileSync(join(external, 'sentinel'), 'keep external')
  renameSync(fixture.root, original)
  symlinkSync(external, fixture.root, 'junction')

  const operation = () => cleanupFixture(fixture)

  assert.throws(operation, /fixture identity changed|linked fixture/)
  assert.equal(readFileSync(join(external, 'sentinel'), 'utf8'), 'keep external')
})

test('cleanupFixture, nested directory junction, refuses recursive deletion', t => {
  const context = workspace(t)
  const fixture = createFixture(context.tempParent)
  symlinkSync(context.cwd, join(fixture.root, 'linked-checkout'), 'junction')

  const operation = () => cleanupFixture(fixture)

  assert.throws(operation, /linked fixture/)
  assert.equal(existsSync(context.cwd), true)
})

test('cleanupFixture, dangling replacement junction, refuses instead of treating it as removed', t => {
  const context = workspace(t)
  const fixture = createFixture(context.tempParent)
  renameSync(fixture.root, join(context.tempParent, 'original-fixture'))
  symlinkSync(join(context.root, 'missing-target'), fixture.root, 'junction')

  const operation = () => cleanupFixture(fixture)

  assert.throws(operation, /fixture identity changed|linked fixture/)
})

test('verifyCi, failed schema child, preserves its exit code and cleans the private root', async t => {
  const context = workspace(t)
  installedPrisma(context.cwd)
  const execute = async command => {
    const outputs = { 'runtime:node': 'v22.15.0', 'runtime:bun': '1.3.13', checkout: '' }
    return outputs[command.label] ?? runCommand({ ...command, command: process.execPath, args: ['-e', 'process.exit(23)'] })
  }

  const operation = verifyCi({ ...context, env: {}, runCommand: execute })

  await assert.rejects(operation, { label: 'prisma:validate', exitCode: 23 })
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, changed dotenv between stages, stops before the next child', async t => {
  const context = workspace(t)
  const execute = async () => {
    writeFileSync(join(context.cwd, '.env.test'), 'PRIVATE=do-not-load')
    return 'v22.15.0'
  }

  const operation = verifyCi({ ...context, env: {}, runCommand: execute })

  await assert.rejects(operation, /dotenv file present/)
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, generation produces no client, refuses to run type checking against stale assumptions', async t => {
  const context = workspace(t)
  installedPrisma(context.cwd)
  const execute = commandSequence([
    { label: 'runtime:node', result: 'v22.15.0' },
    { label: 'runtime:bun', result: '1.3.13' },
    { label: 'checkout', result: '' },
    { label: 'prisma:validate', result: '' },
    { label: 'prisma:generate', result: '' },
  ])

  const operation = verifyCi({ ...context, env: {}, runCommand: execute })

  await assert.rejects(operation, /without the expected client.ts/)
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('verifyCi, successful isolated commands, excludes ambient credentials and uses unencoded spaced paths', async t => {
  const context = workspace(t)
  installedPrisma(context.cwd)
  const commands = []
  const execute = async command => {
    commands.push(command)
    mkdirSync(join(context.cwd, 'src', 'generated', 'prisma'), { recursive: true })
    writeFileSync(join(context.cwd, 'src', 'generated', 'prisma', 'client.ts'), '// generated fixture')
    return { 'runtime:node': 'v22.15.0', 'runtime:bun': '1.3.13', checkout: '' }[command.label] ?? ''
  }

  await verifyCi({ ...context, env: { PATH: process.env.PATH, PRIVATE_SECRET: 'private', AGENTBOARD_ADMIN_PASSWORD: 'live-password', NODE_OPTIONS: '--require private.js', GIT_CONFIG_COUNT: '9' }, runCommand: execute })

  assert.deepEqual(commands.map(command => command.label), [
    'runtime:node', 'runtime:bun', 'checkout', 'prisma:validate', 'prisma:generate', 'prisma:db-push',
    'type-check', 'lint', 'test', 'doctor', 'build',
  ])
  assert.match(commands[3].env.DATABASE_URL, /^file:(?:[A-Z]:\/|\/).*owned fixtures\/agentboard-ci-.*\/fixture\.sqlite$/i)
  assert.equal(commands[3].env.DATABASE_URL.includes('%20'), false)
  assert.equal(commands[3].env.PRIVATE_SECRET, undefined)
  assert.equal(commands[3].env.NODE_OPTIONS, undefined)
  assert.notEqual(commands[3].env.AGENTBOARD_ADMIN_PASSWORD, 'live-password')
  assert.match(commands[3].env.AGENTBOARD_ADMIN_PASSWORD, /^[a-f0-9]{48}$/)
  assert.match(commands[3].env.AGENTBOARD_ADMIN_SESSION_SECRET, /^[a-f0-9]{48}$/)
  assert.match(commands[3].env.AGENTBOARD_WS_SECRET, /^[a-f0-9]{48}$/)
  assert.match(commands[3].env.AGENTBOARD_WS_INTERNAL_SECRET, /^[a-f0-9]{48}$/)
  assert.equal(commands[3].env.GIT_CONFIG_COUNT, '1')
  assert.deepEqual(commands[5].args.slice(-2), ['db', 'push'])
  assert.deepEqual(commands[8].args, ['--no-env-file', '--no-install', 'run', 'test'])
  assert.deepEqual(commands[9].args, ['--no-env-file', '--no-install', 'run', 'doctor', '--offline', '--json'])
  assert.deepEqual(commands[10].args, ['--no-env-file', '--no-install', 'run', 'build'])
  assert.deepEqual(readdirSync(context.tempParent), [])
})

test('runCommand, script and working directory with spaces, invokes a real child without a shell', async t => {
  const context = workspace(t)
  const script = join(context.cwd, 'child with spaces.mjs')
  writeFileSync(script, 'console.log(process.argv[2]); console.log(process.cwd().endsWith("checkout with spaces"))')

  const output = await runCommand({ label: 'fixture:child', command: process.execPath, args: [script, 'literal $value & argument'], cwd: context.cwd, env: {}, capture: true })

  assert.equal(output.trim().replaceAll('\r', ''), 'literal $value & argument\ntrue')
})

test('fixture database URL, real Node Prisma and SQLite with spaces, creates only the owned database', async t => {
  const context = workspace(t)
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const fixture = createFixture(context.tempParent)
  t.after(() => cleanupFixture(fixture))
  const env = { PATH: process.env.PATH, DATABASE_URL: fixture.databaseUrl, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1', CHECKPOINT_DISABLE: '1' }
  const reader = join(context.cwd, 'read-sqlite.cjs')
  writeFileSync(reader, 'const Database = require(process.argv[2]); const db = new Database(process.argv[3].slice(5), {readonly:true}); console.log(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name = ?").get("Project").count); db.close()')

  await runCommand({ label: 'fixture:prisma', command: 'node', args: [join(projectRoot, 'node_modules/prisma/build/index.js'), 'db', 'push'], cwd: projectRoot, env, capture: true })
  const output = await runCommand({ label: 'fixture:sqlite', command: 'node', args: [reader, join(projectRoot, 'node_modules/better-sqlite3'), fixture.databaseUrl], cwd: context.cwd, env, capture: true })

  assert.equal(output.trim(), '1')
  assert.equal(existsSync(join(fixture.root, 'fixture.sqlite')), true)
  assert.equal(existsSync(join(context.cwd, 'fixture.sqlite')), false)
})
