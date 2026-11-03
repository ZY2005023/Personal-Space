import { z } from "zod";
import { requestHash } from "./domain";
export const SiteSettingsInput = z.strictObject({ siteTitle: z.string().trim().min(1).max(100), siteIntro: z.string().max(500) });
export type SiteProfile = z.infer<typeof SiteSettingsInput>;
export const defaultSiteProfile: SiteProfile = { siteTitle: "Personal Space", siteIntro: "记录生活，也整理所知。" };
export type SiteSettings = SiteProfile & { uploadMaxBytes: number | null; allowedMimeTypes: string[] };
export const settingsEtag = (data: SiteSettings, updatedAt: Date | null) => `"settings-${requestHash({ data, updatedAt: updatedAt?.toISOString() || null })}"`;
