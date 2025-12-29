-- CreateTable
CREATE TABLE "searches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "criteria" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total_listings" INTEGER NOT NULL DEFAULT 0,
    "processed_listings" INTEGER NOT NULL DEFAULT 0,
    "qualified_listings" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "completed_at" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "listings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "search_id" TEXT NOT NULL,
    "ebay_item_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "shipping_cost" REAL NOT NULL DEFAULT 0,
    "seller_username" TEXT NOT NULL,
    "seller_feedback_score" INTEGER NOT NULL,
    "seller_feedback_percent" REAL NOT NULL,
    "location" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "end_time" DATETIME NOT NULL,
    "listing_type" TEXT NOT NULL DEFAULT 'FIXED_PRICE',
    "images" TEXT NOT NULL,
    "item_specifics" TEXT,
    "description" TEXT,
    "raw_payload" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "listings_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "searches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listing_id" TEXT NOT NULL,
    "card_name" TEXT,
    "card_set" TEXT,
    "card_number" TEXT,
    "year" INTEGER,
    "language" TEXT,
    "is_holo" INTEGER,
    "is_first_edition" INTEGER,
    "is_shadowless" INTEGER,
    "rarity" TEXT,
    "parse_confidence" REAL NOT NULL DEFAULT 0,
    "parse_metadata" TEXT,
    "predicted_grade_min" REAL,
    "predicted_grade_max" REAL,
    "grade_confidence" REAL NOT NULL DEFAULT 0,
    "defect_flags" TEXT NOT NULL DEFAULT '[]',
    "grade_reasoning" TEXT,
    "grading_details" TEXT,
    "market_price_ungraded" REAL,
    "market_price_psa7" REAL,
    "market_price_psa8" REAL,
    "market_price_psa9" REAL,
    "market_price_psa10" REAL,
    "pricing_confidence" REAL NOT NULL DEFAULT 0,
    "pricing_source" TEXT,
    "expected_value" REAL NOT NULL DEFAULT 0,
    "deal_margin" REAL NOT NULL DEFAULT 0,
    "deal_score" REAL NOT NULL DEFAULT 0,
    "qualification_flags" TEXT NOT NULL DEFAULT '[]',
    "is_qualified" INTEGER NOT NULL DEFAULT 0,
    "soft_scores" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "evaluations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pricing_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonical_card_id" TEXT NOT NULL,
    "card_name" TEXT NOT NULL,
    "card_set" TEXT NOT NULL,
    "card_number" TEXT NOT NULL,
    "variant" TEXT,
    "price_data" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cached_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "job_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "failed_at" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "service" TEXT NOT NULL,
    "endpoint" TEXT,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "tokens_used" INTEGER,
    "credits_used" INTEGER,
    "window_start" DATETIME NOT NULL,
    "window_end" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "description" TEXT,
    "updated_at" DATETIME NOT NULL,
    "updated_by" TEXT
);

-- CreateIndex
CREATE INDEX "searches_user_id_created_at_idx" ON "searches"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "listings_ebay_item_id_key" ON "listings"("ebay_item_id");

-- CreateIndex
CREATE INDEX "listings_search_id_idx" ON "listings"("search_id");

-- CreateIndex
CREATE INDEX "listings_ebay_item_id_idx" ON "listings"("ebay_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_listing_id_key" ON "evaluations"("listing_id");

-- CreateIndex
CREATE INDEX "evaluations_listing_id_idx" ON "evaluations"("listing_id");

-- CreateIndex
CREATE INDEX "evaluations_is_qualified_deal_score_idx" ON "evaluations"("is_qualified", "deal_score");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_cache_canonical_card_id_key" ON "pricing_cache"("canonical_card_id");

-- CreateIndex
CREATE INDEX "pricing_cache_canonical_card_id_idx" ON "pricing_cache"("canonical_card_id");

-- CreateIndex
CREATE INDEX "pricing_cache_expires_at_idx" ON "pricing_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_history_job_id_key" ON "job_history"("job_id");

-- CreateIndex
CREATE INDEX "job_history_job_type_status_idx" ON "job_history"("job_type", "status");

-- CreateIndex
CREATE INDEX "job_history_created_at_idx" ON "job_history"("created_at");

-- CreateIndex
CREATE INDEX "api_usage_service_window_start_idx" ON "api_usage"("service", "window_start");

-- CreateIndex
CREATE UNIQUE INDEX "config_key_key" ON "config"("key");
