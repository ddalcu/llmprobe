import { createApp } from "./app";
import { prisma } from "./db";

const port = Number(process.env.PORT ?? 3000);
createApp(prisma, process.env.UPLOAD_TOKEN).listen(port, () =>
  console.log(`llmprobe-server on :${port}`),
);
