import { ok, problem, readJson, requireAdmin } from "@/lib/http";
import { adminTopics, saveTopic, topicInput, topicUpdate } from "@/lib/interest-topics";

export async function GET(request: Request) {
  try { await requireAdmin(request); return ok(await adminTopics()); }
  catch (error) { return problem(error); }
}
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    const input = topicInput.parse(await readJson(request));
    return ok(await saveTopic({ ...input, isPublic: false }), 201);
  } catch (error) { return problem(error); }
}
export async function PUT(request: Request) {
  try {
    await requireAdmin(request);
    const { id, version, ...input } = topicUpdate.parse(await readJson(request));
    return ok(await saveTopic(input, { id, version }));
  } catch (error) { return problem(error); }
}
