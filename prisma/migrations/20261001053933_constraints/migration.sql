-- Constraints Prisma cannot express (data-model.md, research R8, R9)

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- FR-014: no two budgets of the same user and currency with overlapping periods
ALTER TABLE "Budget"
  ADD CONSTRAINT budget_no_overlap
  EXCLUDE USING gist ("userId" WITH =, currency WITH =, daterange("startDate", "endDate", '[]') WITH &&);

ALTER TABLE "Budget" ADD CONSTRAINT budget_dates_valid CHECK ("endDate" > "startDate");
ALTER TABLE "Budget" ADD CONSTRAINT budget_threshold_range CHECK ("alertThresholdPct" BETWEEN 1 AND 100);

-- FR-042: one active alert per condition, including budget-level alerts with no bucket
CREATE UNIQUE INDEX alert_active_unique
  ON "Alert" ("budgetId", "bucketId", type) NULLS NOT DISTINCT
  WHERE "clearedAt" IS NULL;
