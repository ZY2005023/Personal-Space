export type PhotoOrderCandidate = { id: string; capturedAt: string | null; captureTimeTrusted: boolean; uploadedAt: string };

/**
 * New album photos sort by trusted capture time first, then by stable upload order.
 * Existing album items keep their saved order; this only orders a newly added batch.
 */
export function orderNewAlbumPhotos<T extends PhotoOrderCandidate>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const at = a.captureTimeTrusted && a.capturedAt ? Date.parse(a.capturedAt) : null;
    const bt = b.captureTimeTrusted && b.capturedAt ? Date.parse(b.capturedAt) : null;
    if (at !== null && bt !== null && at !== bt) return at - bt;
    if (at !== null && bt === null) return -1;
    if (at === null && bt !== null) return 1;
    return a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id);
  });
}