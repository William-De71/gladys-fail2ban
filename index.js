// -----------------------------------------------------------------------------
// Entry point of the Fail2Ban external integration.
//
// Brings Fail2Ban into Gladys, over an SSH connection to the machine running
// it (the integration calls `fail2ban-client` there):
//   - devices: the server (IPs banned now, failures, bans since start, jails)
//     and one device per jail (src/device.js);
//   - scene triggers: IP banned, IP unbanned, Fail2Ban down, Fail2Ban back;
//   - scene actions: ban an IP, unban an IP, check an IP, read a summary;
//   - dashboard widgets: overview (ban / unban forms), recent bans.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Fail2Ban integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
