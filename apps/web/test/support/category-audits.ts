const DELETE_TRIGGER_SQL = `
  CREATE TRIGGER category_audits_no_delete
  BEFORE DELETE ON category_audits
  BEGIN
    SELECT RAISE(ABORT, 'category audits are append-only');
  END
`;

export async function clearCategoryAudits(database: D1Database): Promise<void> {
  await database.prepare("DROP TRIGGER IF EXISTS category_audits_no_delete").run();
  await database.prepare("DELETE FROM category_audits").run();
  await database.prepare(DELETE_TRIGGER_SQL).run();
}
