import { createApp, lakebase, server } from '@databricks/appkit';
import { setupFacilityRoutes } from './routes/lakebase/facility-routes';
import { setupPrioritizationRoutes } from './routes/prioritization/pipeline-routes';

createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    await setupFacilityRoutes(appkit);
    await setupPrioritizationRoutes(appkit);
  },
}).catch(console.error);
