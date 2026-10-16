import type { TranslationKey } from "./zh-CN";

// Typed against the source catalogue: omitting a key fails `tsc`.
export const en: Record<TranslationKey, string> = {
  "brand.name": "Personal Ledger",

  "route.overview.label": "Overview",
  "route.overview.description": "See this month's income and spending, and each category's share.",
  "route.transactions.label": "Transactions",
  "route.transactions.description":
    "Browse every entry with a clear source and status, keeping filters reproducible.",
  "route.add.label": "Add entry",
  "route.add.description":
    "Record a purchase in the same ledger right away — usually just amount and merchant.",
  "route.analysis.label": "Analysis",
  "route.analysis.description":
    "Review monthly spending by category and set budget limits; currencies stay separate.",
  "route.settings.label": "Settings",
  "route.settings.description":
    "Manage subscriptions, category rules, CSV import and ledger export.",
  "route.subscriptions.label": "Subscriptions",
  "route.subscriptions.description": "Manage the subscriptions that post an entry each month.",

  "overview.viewUnclassified": "View unclassified entries",
  "overview.thisMonth": "This month · {period}",
  "overview.cashFlow.title": "Cash flow this month",
  "overview.cashFlow.empty": "No entries count towards this month's report yet",
  "overview.cashFlow.income": "Income",
  "overview.cashFlow.netSpending": "Net spending",
  "overview.cashFlow.netCashFlow": "Net cash flow",
  "overview.spending.title": "Where the money went",
  "overview.spending.empty": "No categorised spending this month yet",
  "overview.retry": "Try again",

  "pie.regionLabel": "{currency} spending by category",
  "pie.netSpending": "Net spending",
  "pie.chartTitle":
    "{currency} spending by category, with amounts and shares in the table beside it",
  "pie.noPositiveSpending": "No positive net spending to chart",
  "pie.tableLabel": "{currency} spending by category, in detail",
  "pie.column.category": "Category",
  "pie.column.netSpending": "Net spending",
  "pie.column.share": "Share",
  "pie.netRefund": "Net refund",
  "pie.footnote":
    "Refunds and reimbursement offsets are deducted; transfers are excluded. Shares are computed from each category's positive net spending. Select a category for its entries.",

  "entry.kicker": "Right after you spend",
  "entry.lead": "Amount and merchant are enough; the rest is filled in for you.",
  "entry.amount": "Amount",
  "entry.merchant": "Merchant or description",
  "entry.account": "Account",
  "entry.moreFields": "Date, currency and direction",
  "entry.date": "Date",
  "entry.currency": "Currency",
  "entry.direction": "Direction",
  "entry.direction.outflow": "Spending",
  "entry.direction.inflow": "Income",
  "entry.submit": "Record it",
  "entry.submitting": "Saving…",
  "entry.saved": "Recorded and categorised by your merchant rules.",
  "entry.savedInstallments":
    "Recorded as {count} monthly instalments and categorised by your merchant rules.",
  "entry.sessionExpired": "Your session expired. Sign in again and retry; nothing was written.",
  "entry.signInAgain": "Sign in again",
  "entry.invalidAmount":
    "Nothing was written. Check the amount: an offset cannot exceed it, and at most two decimals are allowed.",
  "entry.failed": "Nothing was written. Check the entry and try again.",
  "entry.savedCategorised": "Recorded under “{category}”{suffix}",
  "entry.savedCategorisedInstallments":
    "Recorded as {count} monthly instalments under “{category}”{suffix}",
  "entry.categorySuffix.once": ".",
  "entry.categorySuffix.remembered": ", and this merchant will use that category from now on.",

  "installments.title": "Pay in instalments",
  "installments.count": "Instalments",
  "installments.note":
    "The total is split monthly from the chosen date, and the final instalment absorbs the remainder.",

  "merchant.eyebrow.multi": "Merchant with several categories · not written yet",
  "merchant.eyebrow.new": "New merchant · not written yet",
  "merchant.title.multi": "Confirm the category",
  "merchant.title.new": "Confirm the new merchant",
  "merchant.suggestion": "looks like “{category}”. Nothing is recorded until you confirm,",
  "merchant.suffix.confirmEveryTime":
    "and because this merchant can mean different kinds of spending, you will be asked each time.",
  "merchant.suffix.remember": "and the category will be remembered for this merchant.",
  "merchant.matchedBy": "Matched against the North American merchant list · {merchant}",
  "merchant.loadingCategories": "Loading categories…",
  "merchant.categoriesFailed": "Categories did not load. This entry has not been written.",
  "merchant.retry": "Try again",
  "merchant.category": "Category",
  "merchant.searchPlaceholder": "Search or create a category…",
  "merchant.cancel": "Cancel",
  "merchant.confirm": "Confirm and record",
  "merchant.confirming": "Recording…",
  "merchant.createFailed":
    "The category was not created. If the name already exists, refresh the list and retry.",
  "merchant.submitFailed":
    "Not recorded. Try again — your amount, merchant and category choice are kept.",

  "categorySearch.trigger": "Another category…",
  "categorySearch.label": "Search or type a category",
  "categorySearch.results": "Matching existing categories",
  "categorySearch.create": "Create the category “{name}”",
  "categorySearch.invalidName": "That category name contains unsupported characters.",
  "categorySearch.confirmTitle": "Confirm the new category",
  "categorySearch.confirmBody":
    "This creates the expense category “{name}” and selects it for this entry.",
  "categorySearch.back": "Back",
  "categorySearch.confirm": "Create the category",
  "categorySearch.saving": "Saving…",

  "sub.status.cancelled": "Cancelled",
  "sub.status.paused": "Paused",
  "sub.status.pendingCancel": "Cancelling",
  "sub.status.active": "Active",
  "sub.cadence.monthly": "month",
  "sub.cadence.yearly": "year",
  "sub.cancelEffective": "Cancelled from {date}, that day included",
  "sub.noCancelDate": "No cancellation date set",
  "sub.nextCharge": "Next charge: {date}",
  "sub.awaitingCatchUp": " · waiting to be posted",
  "sub.needsCheck": "Automatic posting needs attention. Check this subscription's settings.",
  "sub.edit": "Edit",
  "sub.resume": "Resume",
  "sub.changeCancelDate": "Change the cancellation date",
  "sub.cancel": "Cancel",
  "sub.recentCharges": "Recently posted",
  "sub.recentCharges.none": " · none yet",
  "sub.charge.removed": "Removed",
  "sub.charge.recorded": "Posted",
  "sub.charges.empty": "Posted charges appear here once a due date passes.",
  "sub.page.kicker": "Posted automatically each month",
  "sub.page.title": "Subscriptions",
  "sub.page.lead":
    "Manage recurring charges. Cancelling can reach back into the past, and resuming can start from a new date.",
  "sub.reload": "Reload",
  "sub.activeCount": "active",
  "sub.add": "Add a subscription",
  "sub.empty.title": "No subscriptions yet",
  "sub.empty.body":
    "Add a name, an amount and the first charge date, and it will be posted every month.",
  "sub.originalCategory": "Original category",

  "subForm.invalidAmount": "Enter an amount above 0 with at most two decimals.",
  "subForm.title.edit": "Edit subscription",
  "subForm.title.add": "Add subscription",
  "subForm.lead.edit": "Changes apply to later charges; amounts already posted stay as they are.",
  "subForm.lead.add":
    "Posted monthly from the first charge date. A date in the past posts the due months too.",
  "subForm.name": "Name",
  "subForm.namePlaceholder": "Apple Music, for example",
  "subForm.amount": "Amount per charge",
  "subForm.currency": "Currency",
  "subForm.account": "Account charged",
  "subForm.category": "Expense category",
  "subForm.categoryPlaceholder": "Choose an expense category",
  "subForm.nextChargeDate": "Next charge date",
  "subForm.firstChargeDate": "First charge date",
  "subForm.note.yearly": "This existing subscription is charged yearly.",
  "subForm.note.monthly":
    "Charged on the chosen day each month, falling back to the last day in shorter months.",
  "subForm.save": "Save subscription",
  "subForm.saving": "Saving…",
  "subForm.back": "Back to the list",
  "subForm.cancelTitle": "Cancel subscription",
  "subForm.resumeTitle": "Resume subscription",
  "subForm.cancelBody":
    "Posting stops from the chosen date, that day included. Charges already posted on or after it are removed and spending totals update. Earlier charges are kept.",
  "subForm.resumeBody":
    "Posting continues on the original cadence from the new first charge date. Months during the cancellation are not filled in. A date in the past posts the due charges after that new start.",
  "subForm.cancelFrom": "Cancel from",
  "subForm.resumeFrom": "New first charge date",
  "subForm.localOnly": "This only changes posting in this ledger.",
  "subForm.confirmCancel": "Cancel and remove those charges",
  "subForm.confirmResume": "Resume",

  "subApi.stale": "This subscription changed. It has been reloaded — check it and submit again.",
  "subApi.invalid":
    "Check the amount, category and date. When editing, the charge date cannot move before a date already processed.",
  "subApi.unconfirmed": "The result could not be confirmed. Refresh, check, and try again.",
  "subApi.cancelled": "Cancellation date saved, and {count} posted charges were removed.",
  "subApi.resumed": "Resumed. Posting continues from the new start date.",
  "subApi.saved": "Subscription saved.",
  "subApi.savedButStale": "Saved, but the list did not refresh. Reload to see it.",

  "page.kicker": "Secure preview · local ledger",

  "shell.mainNavigation": "Main navigation",
  "shell.skipToContent": "Skip to main content",
  "shell.privateNote": "Private · owner only",
  "shell.localBadge": "Local",

  "dataState.empty.title": "Nothing here yet",
  "dataState.empty.description":
    "Content appears here once you add an entry by hand or import a CSV.",
  "dataState.error.title": "Cannot read right now",
  "dataState.error.description": "This read did not finish. Your existing ledger is unchanged.",
  "dataState.loading.title": "Reading the ledger",
  "dataState.loading.description": "Securely reading the latest data.",
  "dataState.offline.title": "You are offline",
  "dataState.offline.description":
    "Try again once you reconnect. Cached entries stay hidden to protect privacy and accuracy.",

  "nav.overview": "Overview",
  "nav.add": "Add entry",
  "nav.transactions": "Transactions",
  "nav.analysis": "Analysis",
  "nav.subscriptions": "Subscriptions",
  "nav.settings": "Settings",

  "overview.currentMonth": "This month · {period}",

  "language.eyebrow": "Interface",
  "language.description": "Affects display on this device only. No ledger data is changed.",
  "language.label": "Interface language",
  "language.zh-CN": "中文",
  "language.en": "English",
};
