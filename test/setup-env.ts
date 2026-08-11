import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Jest globalSetup — runs once before all e2e test suites.
 * Loads .env.test so DATABASE_URL points at the test DB (port 5433).
 */
export default async function (): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });
}
