import { createApp, lakebase, server } from '@databricks/appkit';
import { setupFacilityRoutes } from './routes/lakebase/facility-routes';

createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupFacilityRoutes(appkit);
  },
}).catch(console.error);
