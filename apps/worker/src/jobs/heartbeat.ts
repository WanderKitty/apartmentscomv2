import type PgBoss from 'pg-boss'

export const HEARTBEAT = 'heartbeat'

export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(HEARTBEAT)
}
