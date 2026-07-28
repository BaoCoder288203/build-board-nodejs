import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createServer } from "node:http";
import { initializeRealtime } from "./realtime/socket.js";

const app = createApp();
const httpServer = createServer(app);

initializeRealtime(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`🚀 ${env.APP_NAME} API running on ${env.APP_URL}`);
  console.log(`   Health: ${env.APP_URL}${env.API_PREFIX}/health`);
});
