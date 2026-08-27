import PgBoss from 'pg-boss'

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({ connectionString })
}
