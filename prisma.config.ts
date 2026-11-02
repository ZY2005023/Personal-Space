import { defineConfig } from "prisma/config";
export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: process.env.DATABASE_URL || "postgresql://unconfigured:unconfigured@127.0.0.1:5432/unconfigured" } });
