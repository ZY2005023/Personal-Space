import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { setTimeout as delay } from "node:timers/promises";
import { AuthClient, base } from "./http-client";
import { db } from "../src/lib/db";
import { runMediaJob } from "../src/lib/media-worker";
import { runOutboxEvent } from "../src/lib/outbox-worker";
import { runMediaGc } from "../src/lib/media-gc";
import { exportRuntime } from "../src/lib/export-artifacts";
import { runExportJob } from "../src/lib/export-worker";
import { runBackupJob } from "../src/lib/backup-worker";
import { backupRuntime } from "../src/lib/backup-runtime";
import { executeRestoreDrill } from "../src/lib/restore-drill";
import { checksum, objectStore } from "../src/lib/object-store";
const client=new AuthClient(), run=randomUUID().slice(0,8), checks:string[]=[], state:Record<string,any>={run};
const pass=(name:string)=>{checks.push(name);console.log(`PASS ${checks.length}: ${name}`);};
const payload=(model:any,patch:any)=>{const {taxonomySnapshot,...body}=model.draft.payload;return {...body,...patch};};
const requestKey=()=>({"Idempotency-Key":randomUUID()});
async function upload(bytes:Buffer,key=randomUUID()) { const body=new FormData();body.append("file",new File([new Uint8Array(bytes)],"integration.png",{type:"image/png"}));return (await client.json("/api/v1/admin/media","POST",body,202,{"Idempotency-Key":key})).value.data; }
async function main(){
  if(process.env.PERSONAL_SPACE_INTEGRATION!=="true")throw new Error("Isolated integration environment required");
  await db().loginThrottle.updateMany({data:{attempts:0,windowStart:new Date(Date.now()-16*60000)}});
  await client.login();pass("real Auth.js password + TOTP login and session");
  // Repeated local runs may leave due events from earlier assertions; drain them first.
  for(let i=0;i<1000&&await runOutboxEvent();i++){}
  assert.equal((await fetch(base+"/api/v1/admin/contents")).status,401);pass("anonymous administrator API denied");
  const category=(await client.json("/api/v1/admin/categories","POST",{name:`联调知识 ${run}`,slug:`integration-knowledge-${run}`,module:"KNOWLEDGE",parentId:null,sortOrder:0},201,requestKey())).value.data;
  const life=(await client.json("/api/v1/admin/categories","POST",{name:`联调生活 ${run}`,slug:`integration-life-${run}`,module:"LIFE",parentId:null,sortOrder:0},201,requestKey())).value.data;
  const tag=(await client.json("/api/v1/admin/tags","POST",{name:`联调标签 ${run}`,slug:`integration-tag-${run}`},201,requestKey())).value.data;state.categoryId=category.id;state.tagId=tag.id;pass("real category and tag creation");
  let model=(await client.json("/api/v1/admin/contents","POST",{type:"ARTICLE",module:"KNOWLEDGE"},201,requestKey())).value.data;state.contentId=model.state.id;
  const initial=model.draft.etag, oldPath=`/knowledge/integration-${run}`;
  await client.json(`/api/v1/admin/contents/${state.contentId}/draft`,"PUT",payload(model,{title:`联调文章 ${run}`,summary:"真实数据库与S3联调",bodyMarkdown:"## 联调正文\n\n发布前后的内容应保持独立。",desiredPath:oldPath,desiredVisibility:"PUBLIC",categoryId:category.id,tagIds:[tag.id]}),200,{"If-Match":initial});
  await client.json(`/api/v1/admin/contents/${state.contentId}/draft`,"PUT",payload(model,{}),412,{"If-Match":initial});pass("draft save and stale ETag rejection");
  const load=async()=> (await client.json(`/api/v1/admin/contents/${state.contentId}`)).value.data;model=await load();
  const snapshot=(await client.json(`/api/v1/admin/contents/${state.contentId}/revisions`,"POST",undefined,201,{...requestKey(),"If-Match":model.draft.etag})).value.data;state.snapshotId=snapshot.id;
  let publication=(await client.json(`/api/v1/admin/contents/${state.contentId}/publish`,"POST",{expectedStateEtag:model.state.stateEtag},200,{...requestKey(),"If-Match":model.draft.etag})).value.data;
  assert.equal(publication.revision.versionNumber,2);assert.equal(publication.revision.publishedEditionNumber,1);pass("manual snapshot and independent publication numbering");
  let publicItem=await(await fetch(base+`/api/v1/contents/${state.contentId}`)).json();assert.equal(publicItem.data.payload.title,`联调文章 ${run}`);
  const search=await(await fetch(base+"/api/v1/search?q="+encodeURIComponent("联调"))).json();assert.ok(search.data.some((row:any)=>row.id===state.contentId));pass("public detail and Chinese search from PostgreSQL");
  const tagRead=await client.json(`/api/v1/admin/tags/${tag.id}`);await client.json(`/api/v1/admin/tags/${tag.id}`,"PUT",{name:`新标签 ${run}`,slug:`integration-tag-${run}`},200,{"If-Match":tagRead.etag!});
  const renamed=await(await fetch(base+"/api/v1/search?q="+encodeURIComponent(`新标签 ${run}`))).json();assert.ok(renamed.data.some((row:any)=>row.id===state.contentId));pass("taxonomy rename updates live search projection");
  model=await load();const newPath=`/knowledge/updated-${run}`;
  await client.json(`/api/v1/admin/contents/${state.contentId}/draft`,"PUT",payload(model,{title:`新版联调 ${run}`,desiredPath:newPath}),200,{"If-Match":model.draft.etag});
  publicItem=await(await fetch(base+`/api/v1/contents/${state.contentId}`)).json();assert.equal(publicItem.data.payload.title,`联调文章 ${run}`);pass("unpublished draft does not alter current public content");
  model=await load();publication=(await client.json(`/api/v1/admin/contents/${state.contentId}/publish`,"POST",{expectedStateEtag:model.state.stateEtag},200,{...requestKey(),"If-Match":model.draft.etag})).value.data;
  const alias=await fetch(base+"/api/v1/routes/resolve?path="+encodeURIComponent(oldPath),{redirect:"manual"});assert.equal(alias.status,308);assert.equal(alias.headers.get("location"),newPath);pass("published path change preserves permitted alias redirect");
  model=await load();await client.json(`/api/v1/admin/contents/${state.contentId}/make-private`,"POST",undefined,200,{...requestKey(),"If-Match":model.state.stateEtag});assert.equal((await fetch(base+`/api/v1/contents/${state.contentId}`)).status,404);assert.equal((await fetch(base+"/api/v1/routes/resolve?path="+encodeURIComponent(oldPath))).status,404);pass("privacy revocation blocks details and old aliases");
  model=await load();await client.json(`/api/v1/admin/contents/${state.contentId}/trash`,"POST",undefined,200,{...requestKey(),"If-Match":model.state.stateEtag});model=await load();
  await client.json(`/api/v1/admin/contents/${state.contentId}/restore`,"POST",undefined,200,{...requestKey(),"If-Match":model.state.stateEtag});model=await load();assert.equal(model.state.publicationState,"UNPUBLISHED");assert.equal(model.draft.payload.desiredVisibility,"PRIVATE");pass("recycle-bin recovery defaults to unpublished/private");
  const restored=(await client.json(`/api/v1/admin/contents/${state.contentId}/revisions/${snapshot.id}/restore`,"POST",undefined,200,{...requestKey(),"If-Match":model.draft.etag})).value.data;assert.equal(restored.basedOnRevisionId,snapshot.id);assert.equal((await load()).state.publicationState,"UNPUBLISHED");pass("historical recovery changes only the working draft");
  const png=await sharp({create:{width:80,height:60,channels:3,background:"#456789"}}).withMetadata().png().toBuffer(), uploadKey=randomUUID(), uploaded=await upload(png,uploadKey), repeated=await upload(png,uploadKey);state.mediaId=uploaded.media.id;assert.equal(repeated.media.id,uploaded.media.id);
  await runMediaJob();const media=(await client.json(`/api/v1/admin/media/${state.mediaId}`)).value.data;assert.equal(media.processingStatus,"READY");pass("real HTTPS S3 upload, idempotency and media worker");
  let album=(await client.json("/api/v1/admin/contents","POST",{type:"ALBUM",module:"LIFE"},201,requestKey())).value.data;state.albumId=album.state.id;
  const cover=randomUUID(), photo=randomUUID();state.photoPlacement=photo;
  await client.json(`/api/v1/admin/contents/${album.state.id}/draft`,"PUT",payload(album,{title:`联调相册 ${run}`,desiredVisibility:"PUBLIC",desiredPath:`/life/album-${run}`,categoryId:life.id,tagIds:[tag.id],coverMediaId:state.mediaId,placements:[{placementId:cover,mediaId:state.mediaId,role:"COVER",caption:"封面",altText:"联调封面"},{placementId:photo,mediaId:state.mediaId,role:"ALBUM_PHOTO",caption:"相册照片",altText:"联调照片"}]}),200,{"If-Match":album.draft.etag});
  album=(await client.json(`/api/v1/admin/contents/${album.state.id}`)).value.data;await client.json(`/api/v1/admin/contents/${album.state.id}/publish`,"POST",{expectedStateEtag:album.state.stateEtag},200,{...requestKey(),"If-Match":album.draft.etag});
  const image=await fetch(base+`/api/v1/contents/${album.state.id}/placements/${photo}/image?variant=DISPLAY`);assert.equal(image.status,200);const displayed=await image.arrayBuffer(), metadata=await sharp(Buffer.from(displayed)).metadata();assert.equal(metadata.exif,undefined);assert.equal(image.headers.get("cache-control"),"private, no-store");pass("published album serves sanitized authorized derivative");
  const original=await client.raw(`/api/v1/admin/media/${state.mediaId}/original`);assert.equal(original.status,200);assert.equal(checksum(Buffer.from(await original.arrayBuffer())),checksum(png));await client.json(`/api/v1/admin/media/${state.mediaId}`,"DELETE",undefined,409,requestKey());pass("private original download and referenced-media deletion protection");
  const settings=await client.json("/api/v1/admin/settings");await client.json("/api/v1/admin/settings","PUT",{siteTitle:"Personal Space 联调",siteIntro:"真实数据联调已接通"},200,{"If-Match":settings.etag!});const homepage=await(await fetch(base)).text();assert.match(homepage,/Personal Space 联调/);pass("settings save reaches real public layout and metadata");
  const disposable=await upload(png);await runMediaJob();await client.json(`/api/v1/admin/media/${disposable.media.id}`,"DELETE",undefined,204,requestKey());
  for(let i=0;i<500;i++){const event=await db().outboxEvent.findFirst({where:{eventType:"MEDIA_DELETED",aggregateId:disposable.media.id}});if(event?.status==="PROCESSED")break;await runOutboxEvent();await delay(20);}
  await delay(1100);
  for(let i=0;i<20;i++){await runMediaGc(1000);await delay(50);}
  const deleted=await db().media.findUniqueOrThrow({where:{id:disposable.media.id}});await assert.rejects(objectStore().get(deleted.storageKey,100000));pass("Outbox-to-GC removes only unreferenced deleted S3 objects");
  console.log("Waiting for a fresh MFA window for export creation");const exportProof=await client.proof("EXPORT_CREATE"), exportKey=randomUUID(), exportJob=(await client.json("/api/v1/admin/exports","POST",{includeMedia:true},202,{"Idempotency-Key":exportKey,"X-Reauth-Token":exportProof})).value.data;
  const exportRetry=(await client.json("/api/v1/admin/exports","POST",{includeMedia:true},202,{"Idempotency-Key":exportKey,"X-Reauth-Token":exportProof})).value.data;assert.equal(exportRetry.id,exportJob.id);
  const runtime=exportRuntime();await runExportJob(runtime.store,runtime.config);const job=(await client.json(`/api/v1/admin/jobs/${exportJob.id}`)).value.data;assert.equal(job.status,"SUCCEEDED");
  const download=await client.raw(`/api/v1/admin/exports/${job.resultResourceId}/download`);assert.equal(download.status,200);assert.equal(download.headers.get("content-type"),"application/zip");state.exportJobId=exportJob.id;pass("reauthenticated export creates once, runs and downloads verified ZIP");
  const exported=await db().operationJob.findUniqueOrThrow({where:{id:exportJob.id}});await db().operationJob.update({where:{id:exportJob.id},data:{result:{...(exported.result as Record<string,any>),expiresAt:new Date(0).toISOString()}}});assert.equal((await client.raw(`/api/v1/admin/exports/${job.resultResourceId}/download`)).status,404);pass("expired export download is refused");
  console.log("Waiting for a fresh MFA window for manual backup");const backupProof=await client.proof("BACKUP_CREATE"), backupJob=(await client.json("/api/v1/admin/backups","POST",undefined,202,{...requestKey(),"X-Reauth-Token":backupProof})).value.data;state.backupJobId=backupJob.id;
  const backup = backupRuntime();
  const jobUrl = `/api/v1/admin/jobs/${backupJob.id}`;
  let completed = (await client.json(jobUrl)).value.data;
  const deadline = Date.now() + 300_000;
  while (completed.status === "PENDING" && !completed.errorCode && Date.now() < deadline) {
    if (!await runBackupJob(backup.config, backup.tools)) break;
    completed = (await client.json(jobUrl)).value.data;
  }
  if (completed.status !== "SUCCEEDED") throw new Error(`Backup did not succeed: ${completed.status} ${completed.errorCode ?? ""}`.trim());
  state.backupId = completed.resultResourceId;
  const backupRecord=(await client.json(`/api/v1/admin/backups/${state.backupId}`)).value.data;assert.equal(backupRecord.localStatus,"SUCCEEDED");assert.equal(backupRecord.integrityStatus,"SUCCEEDED");assert.equal(backupRecord.offsiteStatus,"SUCCEEDED");pass("real pg_dump snapshot and restic S3 backup/check complete independently");
  const stored=await db().backupRun.findUniqueOrThrow({where:{id:state.backupId}});const directory=(await import("node:path")).dirname(stored.manifestPath!);const restoreStartedAt = Date.now(); const drill = await executeRestoreDrill(directory); state.drillId = drill.drillId; state.restoreStartedAt = new Date(restoreStartedAt).toISOString(); state.restoreDurationMs = Date.now() - restoreStartedAt; console.log(`Isolated database and media restore: ${state.restoreDurationMs} ms`);pass("real isolated PostgreSQL and S3 restore drill passes counts and reference checks");
  const logs=(await client.json("/api/v1/admin/audit-logs?limit=100")).value.data;assert.ok(logs.some((row:any)=>row.action==="BACKUP_CREATED"));pass("audit API exposes actual task activity summaries");
  state.passed=true;
}
void main().catch(error=>{state.passed=false;state.error=error instanceof Error?error.message:"unknown";console.error(state.error);process.exitCode=1;}).finally(async()=>{state.checks=checks;state.completedAt=new Date().toISOString();await mkdir("work/integration/evidence",{recursive:true});await writeFile("work/integration/evidence/main-flow.json",JSON.stringify(state,null,2));await db().$disconnect();});
