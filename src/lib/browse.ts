import { z } from "zod";
import { DomainError } from "./domain";
import type { PublicFilters } from "./public-store";
export type BrowseParams = Record<string, string | string[] | undefined>;
export type BrowseScope = { module?: "LIFE" | "KNOWLEDGE"; type?: "ALBUM"; search?: boolean };
export function browseFilters(raw: BrowseParams, scope: BrowseScope = {}): PublicFilters {
  const get = (name: string) => {
    const value = raw[name];
    if (Array.isArray(value)) throw new DomainError(400, "INVALID_INPUT", "筛选条件重复，请重新选择");
    return value || undefined;
  };
  const module = get("module"), type = get("type"), categoryId = get("categoryId"), tagId = get("tagId"), cursor = get("cursor");
  const q = scope.search ? (get("q") || "").normalize("NFKC").trim() : "";
  if (module && !["LIFE", "KNOWLEDGE"].includes(module) || type && !["ARTICLE", "MOMENT", "ALBUM"].includes(type) || categoryId && !z.uuid().safeParse(categoryId).success || tagId && !z.uuid().safeParse(tagId).success || cursor && cursor.length > 2048 || q.length > 100) throw new DomainError(400, "INVALID_INPUT", "筛选条件无效，请重新选择");
  if (scope.module && module && scope.module !== module || scope.type && type && scope.type !== type) throw new DomainError(400, "INVALID_INPUT", "筛选条件与当前页面不一致");
  const selectedModule = scope.module || module as PublicFilters["module"], selectedType = scope.type || type as PublicFilters["type"];
  if (selectedModule === "KNOWLEDGE" && selectedType && selectedType !== "ARTICLE") throw new DomainError(400, "INVALID_INPUT", "知识模块仅支持文章");
  return { module: selectedModule, type: selectedType, categoryId: categoryId?.toLowerCase(), tagId: tagId?.toLowerCase(), q, cursor };
}
export function browseValues(filters: PublicFilters): Record<string, string> {
  return Object.fromEntries(["q", "module", "type", "categoryId", "tagId"].flatMap(key => filters[key as keyof PublicFilters] ? [[key, String(filters[key as keyof PublicFilters])]] : []));
}
export function browseHref(base: string, filters: PublicFilters, patch: Partial<PublicFilters> = {}) {
  const params = new URLSearchParams(browseValues({ ...filters, ...patch }));
  return base + (params.size ? "?" + params.toString() : "");
}
