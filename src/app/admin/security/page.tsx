import { ensureAdmin } from "@/lib/admin";
import { SecurityManager } from "@/components/security-manager";
import { SettingsManager } from "@/components/settings-manager";
export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ recovery?: string }> }) {
  await ensureAdmin(); const params = await searchParams;
  return <><SecurityManager recoveryLoginRequested={params.recovery === "1"}/><SettingsManager/></>;
}
