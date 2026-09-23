import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function globalSetup() {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  execSync(`${root}scripts/dev/setup-dev-db.sh`, { stdio: 'inherit', env: { ...process.env, IMPORT_SQL: '' } });
}
