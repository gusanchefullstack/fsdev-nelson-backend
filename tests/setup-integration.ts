import { loadEnvFile } from 'node:process';

// Integration tests run against the Neon `test` branch configured in .env.test
loadEnvFile('.env.test');
