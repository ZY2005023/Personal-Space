import { defineConfig } from "prisma/config";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "postgresql://unconfigured:unconfigured@127.0.0.1:5432/unconfigured" } });
