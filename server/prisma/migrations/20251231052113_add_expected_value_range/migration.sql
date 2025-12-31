-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_evaluations" (
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
    "expected_value_min" REAL NOT NULL DEFAULT 0,
    "expected_value_max" REAL NOT NULL DEFAULT 0,
    "deal_margin" REAL NOT NULL DEFAULT 0,
    "deal_score" REAL NOT NULL DEFAULT 0,
    "qualification_flags" TEXT NOT NULL DEFAULT '[]',
    "is_qualified" INTEGER NOT NULL DEFAULT 0,
    "soft_scores" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "evaluations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_evaluations" ("card_name", "card_number", "card_set", "created_at", "deal_margin", "deal_score", "defect_flags", "expected_value", "grade_confidence", "grade_reasoning", "grading_details", "id", "is_first_edition", "is_holo", "is_qualified", "is_shadowless", "language", "listing_id", "market_price_psa10", "market_price_psa7", "market_price_psa8", "market_price_psa9", "market_price_ungraded", "parse_confidence", "parse_metadata", "predicted_grade_max", "predicted_grade_min", "pricing_confidence", "pricing_source", "qualification_flags", "rarity", "soft_scores", "updated_at", "year") SELECT "card_name", "card_number", "card_set", "created_at", "deal_margin", "deal_score", "defect_flags", "expected_value", "grade_confidence", "grade_reasoning", "grading_details", "id", "is_first_edition", "is_holo", "is_qualified", "is_shadowless", "language", "listing_id", "market_price_psa10", "market_price_psa7", "market_price_psa8", "market_price_psa9", "market_price_ungraded", "parse_confidence", "parse_metadata", "predicted_grade_max", "predicted_grade_min", "pricing_confidence", "pricing_source", "qualification_flags", "rarity", "soft_scores", "updated_at", "year" FROM "evaluations";
DROP TABLE "evaluations";
ALTER TABLE "new_evaluations" RENAME TO "evaluations";
CREATE UNIQUE INDEX "evaluations_listing_id_key" ON "evaluations"("listing_id");
CREATE INDEX "evaluations_listing_id_idx" ON "evaluations"("listing_id");
CREATE INDEX "evaluations_is_qualified_deal_score_idx" ON "evaluations"("is_qualified", "deal_score");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
