import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DomainError } from "./domain";
const globalDb = globalThis as unknown as { prisma?: PrismaClient };
export function db() {
  if (!process.env.DATABASE_URL) throw new DomainError(503, "SERVICE_UNAVAILABLE", "存储服务尚未配置");
  if (!globalDb.prisma) globalDb.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  return globalDb.prisma;
}
