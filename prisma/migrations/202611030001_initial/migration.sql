-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "singleton_key" INTEGER NOT NULL DEFAULT 1,
    "username" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "totp_secret_encrypted" TEXT,
    "last_totp_step" BIGINT,
    "session_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_recovery_codes" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_challenges" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "purpose" VARCHAR(24) NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "session_hash" CHAR(64) NOT NULL,
    "session_version" INTEGER NOT NULL,
    "encrypted_payload" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),

    CONSTRAINT "security_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_throttles" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_start" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "publication_state" TEXT NOT NULL DEFAULT 'NEVER_PUBLISHED',
    "effective_visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "state_version" INTEGER NOT NULL DEFAULT 1,
    "published_revision_id" UUID,
    "first_published_at" TIMESTAMPTZ(3),
    "last_published_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_drafts" (
    "content_id" UUID NOT NULL,
    "draft_payload" JSONB NOT NULL,
    "payload_schema_version" INTEGER NOT NULL DEFAULT 1,
    "revision_number" INTEGER NOT NULL DEFAULT 1,
    "based_on_revision_id" UUID,
    "last_saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("content_id")
);

-- CreateTable
CREATE TABLE "content_revisions" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "published_edition_number" INTEGER,
    "revision_kind" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_schema_version" INTEGER NOT NULL DEFAULT 1,
    "restored_from_revision_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_publications" (
    "content_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "summary" TEXT,
    "category_id" UUID,
    "cover_media_id" UUID,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_publications_pkey" PRIMARY KEY ("content_id")
);

-- CreateTable
CREATE TABLE "content_routes" (
    "id" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "content_id" UUID,
    "route_kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "module" TEXT NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" UUID NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "captured_at" TIMESTAMPTZ(3),
    "capture_time_trusted" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_status" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "operation_scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_reference" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" UUID,
    "metadata" JSONB NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_variants" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "variant_type" VARCHAR(20) NOT NULL,
    "processing_version" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "metadata_sanitized" BOOLEAN NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_media" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "role" VARCHAR(24) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "caption" TEXT,
    "alt_text" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "draft_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_media" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "role" VARCHAR(24) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "caption" TEXT,
    "alt_text" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "revision_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_media" (
    "id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "placement_id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "role" VARCHAR(24) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "caption" TEXT,
    "alt_text" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "content_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_categories" (
    "content_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "draft_categories_pkey" PRIMARY KEY ("content_id")
);

-- CreateTable
CREATE TABLE "revision_categories" (
    "revision_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,

    CONSTRAINT "revision_categories_pkey" PRIMARY KEY ("revision_id")
);

-- CreateTable
CREATE TABLE "draft_tags" (
    "content_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "draft_tags_pkey" PRIMARY KEY ("content_id","tag_id")
);

-- CreateTable
CREATE TABLE "revision_tags" (
    "revision_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "revision_tags_pkey" PRIMARY KEY ("revision_id","tag_id")
);

-- CreateTable
CREATE TABLE "content_tags" (
    "content_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "content_tags_pkey" PRIMARY KEY ("content_id","tag_id")
);

-- CreateTable
CREATE TABLE "content_search_documents" (
    "content_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "searchable_text" TEXT NOT NULL,
    "category_text" TEXT NOT NULL,
    "tags_text" TEXT NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "content_type" VARCHAR(20) NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_search_documents_pkey" PRIMARY KEY ("content_id")
);

-- CreateTable
CREATE TABLE "operation_jobs" (
    "id" UUID NOT NULL,
    "job_type" VARCHAR(32) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" UUID,
    "error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "operation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" UUID,
    "next_attempt_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "backup_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "local_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "integrity_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "offsite_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "manifest_path" TEXT,
    "checksum" VARCHAR(64),
    "size_bytes" BIGINT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "error_summary" TEXT,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_copies" (
    "id" UUID NOT NULL,
    "backup_run_id" UUID NOT NULL,
    "copy_type" VARCHAR(20) NOT NULL,
    "location_key" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "checksum" VARCHAR(64),
    "verified_at" TIMESTAMPTZ(3),
    "error_summary" TEXT,

    CONSTRAINT "backup_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_drills" (
    "id" UUID NOT NULL,
    "backup_run_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "verification_summary" JSONB NOT NULL,
    "notes" TEXT,

    CONSTRAINT "restore_drills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "setting_key" VARCHAR(100) NOT NULL,
    "setting_value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("setting_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_singleton_key_key" ON "admin_users"("singleton_key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_recovery_codes_admin_id_code_hash_key" ON "admin_recovery_codes"("admin_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "security_challenges_token_hash_key" ON "security_challenges"("token_hash");

-- CreateIndex
CREATE INDEX "security_challenges_admin_id_purpose_expires_at_idx" ON "security_challenges"("admin_id", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "security_challenges_expires_at_idx" ON "security_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "contents_type_module_updated_at_id_idx" ON "contents"("type", "module", "updated_at", "id");

-- CreateIndex
CREATE INDEX "contents_deleted_at_idx" ON "contents"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_revisions_content_id_id_key" ON "content_revisions"("content_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "content_revisions_content_id_version_number_key" ON "content_revisions"("content_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "content_revisions_content_id_published_edition_number_key" ON "content_revisions"("content_id", "published_edition_number");

-- CreateIndex
CREATE INDEX "content_publications_published_at_content_id_idx" ON "content_publications"("published_at", "content_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_routes_path_key" ON "content_routes"("path");

-- CreateIndex
CREATE INDEX "content_routes_content_id_route_kind_idx" ON "content_routes"("content_id", "route_kind");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_module_id_key" ON "categories"("module", "id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_module_parent_id_slug_key" ON "categories"("module", "parent_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_module_parent_id_normalized_name_key" ON "categories"("module", "parent_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_normalized_name_key" ON "tags"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_provider_storage_key_key" ON "media"("storage_provider", "storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_admin_id_operation_scope_idempotency_ke_key" ON "idempotency_records"("admin_id", "operation_scope", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_storage_key_key" ON "media_variants"("storage_key");

-- CreateIndex
CREATE INDEX "media_variants_media_id_variant_type_is_active_idx" ON "media_variants"("media_id", "variant_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_media_id_variant_type_processing_version_key" ON "media_variants"("media_id", "variant_type", "processing_version");

-- CreateIndex
CREATE INDEX "draft_media_media_id_idx" ON "draft_media"("media_id");

-- CreateIndex
CREATE INDEX "draft_media_content_id_role_sort_order_idx" ON "draft_media"("content_id", "role", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "draft_media_content_id_placement_id_key" ON "draft_media"("content_id", "placement_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_media_content_id_sort_order_key" ON "draft_media"("content_id", "sort_order");

-- CreateIndex
CREATE INDEX "revision_media_media_id_idx" ON "revision_media"("media_id");

-- CreateIndex
CREATE INDEX "revision_media_revision_id_role_sort_order_idx" ON "revision_media"("revision_id", "role", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "revision_media_revision_id_placement_id_key" ON "revision_media"("revision_id", "placement_id");

-- CreateIndex
CREATE UNIQUE INDEX "revision_media_revision_id_sort_order_key" ON "revision_media"("revision_id", "sort_order");

-- CreateIndex
CREATE INDEX "content_media_media_id_idx" ON "content_media"("media_id");

-- CreateIndex
CREATE INDEX "content_media_content_id_role_sort_order_idx" ON "content_media"("content_id", "role", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "content_media_content_id_placement_id_key" ON "content_media"("content_id", "placement_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_media_content_id_sort_order_key" ON "content_media"("content_id", "sort_order");

-- CreateIndex
CREATE INDEX "draft_categories_category_id_idx" ON "draft_categories"("category_id");

-- CreateIndex
CREATE INDEX "revision_categories_category_id_idx" ON "revision_categories"("category_id");

-- CreateIndex
CREATE INDEX "draft_tags_tag_id_idx" ON "draft_tags"("tag_id");

-- CreateIndex
CREATE INDEX "revision_tags_tag_id_idx" ON "revision_tags"("tag_id");

-- CreateIndex
CREATE INDEX "content_tags_tag_id_idx" ON "content_tags"("tag_id");

-- CreateIndex
CREATE INDEX "content_search_documents_module_content_type_published_at_c_idx" ON "content_search_documents"("module", "content_type", "published_at", "content_id");

-- CreateIndex
CREATE INDEX "operation_jobs_status_next_attempt_at_idx" ON "operation_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_runs_job_id_key" ON "backup_runs"("job_id");

-- CreateIndex
CREATE INDEX "backup_runs_backup_type_started_at_idx" ON "backup_runs"("backup_type", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_copies_backup_run_id_copy_type_location_key_key" ON "backup_copies"("backup_run_id", "copy_type", "location_key");

-- AddForeignKey
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "security_challenges" ADD CONSTRAINT "security_challenges_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_id_published_revision_id_fkey" FOREIGN KEY ("id", "published_revision_id") REFERENCES "content_revisions"("content_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_content_id_based_on_revision_id_fkey" FOREIGN KEY ("content_id", "based_on_revision_id") REFERENCES "content_revisions"("content_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_content_id_restored_from_revision_id_fkey" FOREIGN KEY ("content_id", "restored_from_revision_id") REFERENCES "content_revisions"("content_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_content_id_revision_id_fkey" FOREIGN KEY ("content_id", "revision_id") REFERENCES "content_revisions"("content_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_routes" ADD CONSTRAINT "content_routes_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_module_parent_id_fkey" FOREIGN KEY ("module", "parent_id") REFERENCES "categories"("module", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "draft_media" ADD CONSTRAINT "draft_media_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_drafts"("content_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "draft_media" ADD CONSTRAINT "draft_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "revision_media" ADD CONSTRAINT "revision_media_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "content_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "revision_media" ADD CONSTRAINT "revision_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_media" ADD CONSTRAINT "content_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "draft_categories" ADD CONSTRAINT "draft_categories_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_drafts"("content_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "draft_categories" ADD CONSTRAINT "draft_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "revision_categories" ADD CONSTRAINT "revision_categories_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "content_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "revision_categories" ADD CONSTRAINT "revision_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "draft_tags" ADD CONSTRAINT "draft_tags_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content_drafts"("content_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "draft_tags" ADD CONSTRAINT "draft_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "revision_tags" ADD CONSTRAINT "revision_tags_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "content_revisions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "revision_tags" ADD CONSTRAINT "revision_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_tags" ADD CONSTRAINT "content_tags_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_tags" ADD CONSTRAINT "content_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_search_documents" ADD CONSTRAINT "content_search_documents_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_search_documents" ADD CONSTRAINT "content_search_documents_content_id_revision_id_fkey" FOREIGN KEY ("content_id", "revision_id") REFERENCES "content_revisions"("content_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "operation_jobs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "backup_copies" ADD CONSTRAINT "backup_copies_backup_run_id_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_backup_run_id_fkey" FOREIGN KEY ("backup_run_id") REFERENCES "backup_runs"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
