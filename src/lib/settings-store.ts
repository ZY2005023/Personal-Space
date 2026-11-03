import { cache } from "react";
import { db } from "./db";
import { DomainError, requireMatch } from "./domain";
import { imageLimits } from "./image-processing";
import { defaultSiteProfile, SiteSettingsInput, settingsEtag, type SiteSettings } from "./site-settings";
import { previewEnabled } from "./preview";
const settingKey = "site.profile";
type Reader = Pick<ReturnType<typeof db>, "systemSetting">;
type Client = Pick<ReturnType<typeof db>, "$transaction">;
function view(value: unknown, updatedAt: Date | null) {
  const parsed = SiteSettingsInput.safeParse(value);
  if (!parsed.success) throw new DomainError(500, "INTERNAL_ERROR", "站点设置格式不正确");
  const data: SiteSettings = { ...parsed.data, uploadMaxBytes: imageLimits.bytes, allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] };
  return { data, etag: settingsEtag(data, updatedAt) };
}
export async function readSettings(client: Reader = db()) {
  const row = await client.systemSetting.findUnique({ where: { settingKey }, select: { settingValue: true, updatedAt: true } });
  return view(row ? row.settingValue : defaultSiteProfile, row?.updatedAt || null);
}
export async function writeSettings(adminId: string, input: unknown, match: string | null, client: Client = db()) {
  const value = SiteSettingsInput.parse(input);
  return client.$transaction(async tx => {
    // Serialize updates even before the first setting row exists.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"settings:site.profile"}, 0))::text`;
    const current = await tx.systemSetting.findUnique({ where: { settingKey }, select: { settingValue: true, updatedAt: true } });
    requireMatch(view(current ? current.settingValue : defaultSiteProfile, current?.updatedAt || null).etag, match, "STATE_CONFLICT");
    const updatedAt = new Date(Math.max(Date.now(), (current?.updatedAt.getTime() || 0) + 1));
    const row = await tx.systemSetting.upsert({ where: { settingKey }, create: { settingKey, settingValue: value, updatedBy: adminId, updatedAt }, update: { settingValue: value, updatedBy: adminId, updatedAt } });
    await tx.auditLog.create({ data: { actorId: adminId, action: "SETTINGS_UPDATED", targetType: "SETTINGS", metadata: { fields: ["siteTitle", "siteIntro"] } } });
    return view(row.settingValue, row.updatedAt);
  });
}
/** Request-local memoization only; the next page request reads current settings. */
export const publicSiteProfile = cache(async () => {
  if (!process.env.DATABASE_URL || previewEnabled()) return { ...defaultSiteProfile };
  const result = await readSettings(); return { siteTitle: result.data.siteTitle, siteIntro: result.data.siteIntro };
});
