/**
 * Backfill: create one Host per legacy daemon (hostId = null), keyed by
 * normalized hostname within the daemon's workspace. Idempotent — re-running
 * upserts the same hosts and only links unlinked daemons.
 *
 * Usage: bun scripts/backfill-hosts.ts
 */
import { db } from '../src/lib/db'
import { upsertHostForDaemon } from '../src/lib/server/host-presence'

async function main() {
  const daemons = await db.daemon.findMany({
    where: { hostId: null },
    select: { id: true, workspaceId: true, hostname: true, platform: true },
  })

  if (daemons.length === 0) {
    console.log('No legacy daemons without a host — nothing to do.')
    return
  }

  let linked = 0
  for (const daemon of daemons) {
    const hostId = await upsertHostForDaemon({
      workspaceId: daemon.workspaceId,
      hostname: daemon.hostname,
      platform: daemon.platform,
    })
    await db.daemon.update({ where: { id: daemon.id }, data: { hostId } })
    linked++
    console.log(`linked daemon ${daemon.id} (${daemon.hostname}) -> host ${hostId}`)
  }

  console.log(`Done: ${linked} daemon(s) linked.`)
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
