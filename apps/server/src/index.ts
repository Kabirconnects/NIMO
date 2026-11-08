import { env } from "./lib/env.js";
import { createApp } from "./app.js";

export async function startServer() {
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    console.log(`Nimo API running at http://${env.HOST}:${env.PORT}`);
  });

  return {
    server,

    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

// Start application
startServer().catch((error) => {
  console.error("Failed to start Nimo API:", error);
  process.exitCode = 1;
});
