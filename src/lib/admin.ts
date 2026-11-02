import { auth } from "@/auth";
import { redirect } from "next/navigation";
export function configurationMissing() { return ["DATABASE_URL", "AUTH_SECRET", "TOTP_ENCRYPTION_KEY"].filter(key => !process.env[key]); }
export async function ensureAdmin() {
  if (configurationMissing().length) redirect("/login");
  const session = await auth(); if (!session?.user?.id) redirect("/login"); return session;
}
