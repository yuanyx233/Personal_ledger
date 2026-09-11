ALTER TABLE subscriptions ADD COLUMN cancellation_effective_date TEXT CHECK (
  cancellation_effective_date IS NULL OR (
    length(cancellation_effective_date) = 10
    AND cancellation_effective_date = date(cancellation_effective_date, '+0 days')
  )
);
