const DELETE_TRIGGER_SQL = `
  CREATE TRIGGER transfer_match_audits_no_delete
  BEFORE DELETE ON transfer_match_audits
  BEGIN
    SELECT RAISE(ABORT, 'transfer match audits are append-only');
  END
`;

export async function clearTransferMatchAudits(database: D1Database): Promise<void> {
  await database.prepare("DROP TRIGGER IF EXISTS transfer_match_audits_no_delete").run();
  await database.prepare("DELETE FROM transfer_match_audits").run();
  await database.prepare(DELETE_TRIGGER_SQL).run();
}
