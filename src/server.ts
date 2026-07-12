import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`🚀 ${env.APP_NAME} API running on ${env.APP_URL}`);
  console.log(`   Health: ${env.APP_URL}${env.API_PREFIX}/health`);
});
