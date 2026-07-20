import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "node:path";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { router } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      credentials: true,
    }),
  );
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(
    "/uploads",
    express.static(path.resolve(process.cwd(), env.UPLOAD_DIR), {
      fallthrough: true,
      maxAge: "7d",
    }),
  );

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      message: `${env.APP_NAME} API`,
      docs: env.API_PREFIX,
    });
  });

  app.use(env.API_PREFIX, router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
