import * as z from "zod";
import { CATEGORY_IDS, normalizeMerchantName } from "./merchant-categorization";

// Curated North American merchant knowledge base. This is intentionally separate from exact
// normalization: aliases may guide categorization but must never change deduplication keys.
const MERCHANT_FAMILIES = [
  {
    key: "amazon-prime",
    displayName: "Amazon Prime",
    pattern: /^amazon(?:\.(?:ca|com))? prime\b/u,
    categoryId: CATEGORY_IDS.expenseBills,
    confirmEveryTime: true,
  },
  {
    key: "amazon-shopping",
    displayName: "Amazon",
    pattern: /^(?:amzn mktp(?: ca)?|amazon(?:\.(?:ca|com))?)(?=[\s*]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
    confirmEveryTime: true,
  },
  {
    key: "costco-gas",
    displayName: "Costco Gas",
    pattern: /^costco(?:\s+wholesale)?\s+gas(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
    confirmEveryTime: true,
  },
  {
    key: "costco-travel",
    displayName: "Costco Travel",
    pattern: /^costco\s+travel(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
    confirmEveryTime: true,
  },
  {
    key: "costco-healthcare",
    displayName: "Costco Pharmacy & Optical",
    pattern: /^costco(?:\s+wholesale)?\s+(?:pharmacy|optical)(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHealthcare,
    confirmEveryTime: true,
  },
  {
    key: "costco",
    displayName: "Costco",
    pattern: /^(?:www\s+)?costco(?:\s+wholesale)?(?=[\s.#*]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
    confirmEveryTime: true,
  },
  {
    key: "uber-eats",
    displayName: "Uber Eats",
    pattern: /^(?:uber canada\/ubereats|uber\s*\*?\s*eats)(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "uber-pass",
    displayName: "Uber One",
    pattern: /^uberdirectca_pass(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "uber-trip",
    displayName: "Uber",
    pattern: /^(?:uber canada\/ubertrip|uber\s*\*\s*trip|uber holdings canada)(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "t-and-t",
    displayName: "T&T Supermarket",
    pattern: /^t\s*&\s*t supermarket(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "loblaws",
    displayName: "Loblaws",
    pattern: /^loblaws(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "no-frills",
    displayName: "No Frills",
    pattern: /^no frills(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "real-canadian-superstore",
    displayName: "Real Canadian Superstore",
    pattern: /^(?:real canadian superstore|rcss)(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "metro-grocery",
    displayName: "Metro",
    pattern: /^metro(?: plus)?(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "sobeys",
    displayName: "Sobeys",
    pattern: /^sobeys(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "safeway",
    displayName: "Safeway",
    pattern: /^safeway(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "whole-foods",
    displayName: "Whole Foods Market",
    pattern: /^whole foods(?: market)?(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "farm-boy",
    displayName: "Farm Boy",
    pattern: /^farm boy(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "longos",
    displayName: "Longo’s",
    pattern: /^longo'?s(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "trader-joes",
    displayName: "Trader Joe’s",
    pattern: /^trader joe'?s(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "aldi",
    displayName: "ALDI",
    pattern: /^aldi(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "kroger",
    displayName: "Kroger",
    pattern: /^kroger(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "publix",
    displayName: "Publix",
    pattern: /^publix(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "heb",
    displayName: "H-E-B",
    pattern: /^h[ -]?e[ -]?b(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "aesop",
    displayName: "Aesop",
    pattern: /^aesop(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "super-vape",
    displayName: "Super Vape",
    pattern: /^super vape(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "shoppers",
    displayName: "Shoppers Drug Mart",
    pattern: /^(?:sdm\s+\d+|shoppers drug mart|pharmaprix)(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "adobe",
    displayName: "Adobe",
    pattern: /^adobe(?:\s+inc)?(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "apple-bill",
    displayName: "Apple Services",
    pattern: /^apple\.com\/bill(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "apple-shopping",
    displayName: "Apple Store",
    pattern: /^apple\.com\/ca(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "target",
    displayName: "Target",
    pattern: /^target(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "canadian-tire",
    displayName: "Canadian Tire",
    pattern: /^canadian tire(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "dollarama",
    displayName: "Dollarama",
    pattern: /^dollarama(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "best-buy",
    displayName: "Best Buy",
    pattern: /^best buy(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "sephora",
    displayName: "Sephora",
    pattern: /^sephora(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "aritzia",
    displayName: "Aritzia",
    pattern: /^aritzia(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "lululemon",
    displayName: "lululemon",
    pattern: /^lululemon(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "uniqlo",
    displayName: "UNIQLO",
    pattern: /^uniqlo(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "zara",
    displayName: "Zara",
    pattern: /^zara(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "hm",
    displayName: "H&M",
    pattern: /^h\s*&\s*m(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "ssense",
    displayName: "SSENSE",
    pattern: /^(?:klarna\*\s*)?ssense(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "nike",
    displayName: "Nike",
    pattern: /^nike(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "adidas",
    displayName: "adidas",
    pattern: /^adidas(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "patagonia",
    displayName: "Patagonia",
    pattern: /^patagonia(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "north-face",
    displayName: "The North Face",
    pattern: /^(?:the\s+)?north face(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "openai",
    displayName: "ChatGPT",
    pattern: /^openai\s*\*\s*chatgpt(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "claude",
    displayName: "Claude",
    pattern: /^claude\.ai subscription(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "netflix",
    displayName: "Netflix",
    pattern: /^netflix(?=[\s.*]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "spotify",
    displayName: "Spotify",
    pattern: /^spotify(?=[\s.*]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "disney-plus",
    displayName: "Disney+",
    pattern: /^(?:disney\+|disney plus)(?=[\s.*]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "crave",
    displayName: "Crave",
    pattern: /^crave(?=[\s.*]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "youtube-premium",
    displayName: "YouTube Premium",
    pattern: /^(?:youtube premium|google\s*\*youtube)(?=[\s.*]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "steam",
    displayName: "Steam",
    pattern: /^(?:steamgames\.com|steam purchase|steam)(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "cineplex",
    displayName: "Cineplex",
    pattern: /^cineplex(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseEntertainment,
  },
  {
    key: "premiere-moisson",
    displayName: "Première Moisson",
    pattern: /^premiere moisson(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "starbucks",
    displayName: "Starbucks",
    pattern: /^starbucks(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "mcdonalds",
    displayName: "McDonald’s",
    pattern: /^mcdonald'?s(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "subway",
    displayName: "Subway",
    pattern: /^subway(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "chipotle",
    displayName: "Chipotle",
    pattern: /^chipotle(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "wendys",
    displayName: "Wendy’s",
    pattern: /^wendy'?s(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "burger-king",
    displayName: "Burger King",
    pattern: /^burger king(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "dominos",
    displayName: "Domino’s",
    pattern: /^domino'?s(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "tim-hortons",
    displayName: "Tim Hortons",
    pattern: /^tim hortons(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "iga",
    displayName: "IGA",
    pattern: /^iga(?: extra)?(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "super-c",
    displayName: "Super C",
    pattern: /^super c(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "freshco",
    displayName: "FreshCo",
    pattern: /^freshco(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "food-basics",
    displayName: "Food Basics",
    pattern: /^food basics(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "save-on-foods",
    displayName: "Save-On-Foods",
    pattern: /^save on foods(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseFood,
  },
  {
    key: "walmart",
    displayName: "Walmart",
    pattern: /^(?:wal-mart|walmart)(?=[\s#]|$)/u,
    categoryId: CATEGORY_IDS.expenseShopping,
  },
  {
    key: "ikea",
    displayName: "IKEA",
    pattern: /^ikea(?!\s+museum\b)(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "home-depot",
    displayName: "The Home Depot",
    pattern: /^(?:the\s+)?home depot(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "lowes",
    displayName: "Lowe’s",
    pattern: /^lowe'?s(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "rona",
    displayName: "RONA",
    pattern: /^rona(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "home-hardware",
    displayName: "Home Hardware",
    pattern: /^home hardware(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "wayfair",
    displayName: "Wayfair",
    pattern: /^wayfair(?:\.ca|\s+canada)?(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "structube",
    displayName: "Structube",
    pattern: /^structube(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "west-elm",
    displayName: "West Elm",
    pattern: /^west elm(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "pottery-barn",
    displayName: "Pottery Barn",
    pattern: /^pottery barn(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "crate-and-barrel",
    displayName: "Crate & Barrel",
    pattern: /^crate\s*(?:&|and)\s*barrel(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "cb2",
    displayName: "CB2",
    pattern: /^cb2(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseHousing,
  },
  {
    key: "esso",
    displayName: "Esso",
    pattern: /^esso(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "shell",
    displayName: "Shell",
    pattern: /^shell(?=\s|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "petro-canada",
    displayName: "Petro-Canada",
    pattern: /^petro[ -]?canada(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "chevron",
    displayName: "Chevron",
    pattern: /^chevron(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "mobil",
    displayName: "Mobil",
    pattern: /^mobil(?=[\s#*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "lyft",
    displayName: "Lyft",
    pattern: /^lyft(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "presto",
    displayName: "PRESTO",
    pattern: /^presto(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "ttc",
    displayName: "TTC",
    pattern: /^(?:ttc|toronto transit commission)(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "stm",
    displayName: "STM",
    pattern: /^(?:stm|societe de transport de montreal)(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "translink",
    displayName: "TransLink",
    pattern: /^translink(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTransportation,
  },
  {
    key: "air-canada",
    displayName: "Air Canada",
    pattern: /^air canada(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "westjet",
    displayName: "WestJet",
    pattern: /^westjet(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "delta-air-lines",
    displayName: "Delta Air Lines",
    pattern: /^delta(?: air lines)?(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "united-airlines",
    displayName: "United Airlines",
    pattern: /^united airlines(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "american-airlines",
    displayName: "American Airlines",
    pattern: /^american airlines(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "airbnb",
    displayName: "Airbnb",
    pattern: /^airbnb(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "booking-com",
    displayName: "Booking.com",
    pattern: /^booking\.com(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "expedia",
    displayName: "Expedia",
    pattern: /^expedia(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "marriott",
    displayName: "Marriott",
    pattern: /^marriott(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "hilton",
    displayName: "Hilton",
    pattern: /^hilton(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "hyatt",
    displayName: "Hyatt",
    pattern: /^hyatt(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseTravel,
  },
  {
    key: "rogers",
    displayName: "Rogers",
    pattern: /^rogers(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "bell",
    displayName: "Bell",
    pattern: /^bell(?: canada)?(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "telus",
    displayName: "TELUS",
    pattern: /^telus(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "fido",
    displayName: "Fido",
    pattern: /^fido(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "videotron",
    displayName: "Vidéotron",
    pattern: /^videotron(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "hydro-quebec",
    displayName: "Hydro-Québec",
    pattern: /^hydro[ -]?quebec(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "toronto-hydro",
    displayName: "Toronto Hydro",
    pattern: /^toronto hydro(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "bc-hydro",
    displayName: "BC Hydro",
    pattern: /^bc hydro(?=[\s*.-]|$)/u,
    categoryId: CATEGORY_IDS.expenseBills,
  },
  {
    key: "uoft-tuition",
    displayName: "University of Toronto",
    pattern: /^online banking payment\s*-\s*\d+\s+u of t$/u,
    categoryId: "category-expense-tuition",
  },
] as const;

export const merchantFamilySchema = z.enum(MERCHANT_FAMILIES.map(({ key }) => key));
export type MerchantFamily = z.infer<typeof merchantFamilySchema>;

export function importedMerchantFamily(merchant: string | null) {
  const normalized = normalizeMerchantName(merchant);
  return normalized === null
    ? null
    : (MERCHANT_FAMILIES.find(({ pattern }) => pattern.test(normalized)) ?? null);
}

export function reportMerchantFamily(merchant: string | null) {
  const normalized = normalizeMerchantName(merchant);
  return (
    importedMerchantFamily(merchant) ??
    MERCHANT_FAMILIES.find(
      ({ displayName }) => normalizeMerchantName(displayName) === normalized,
    ) ??
    null
  );
}

export function manualDefaultCategory(merchant: string | null): string | null {
  return reportMerchantFamily(merchant)?.categoryId ?? null;
}

export function merchantRequiresCategoryConfirmation(merchant: string | null): boolean {
  const family = reportMerchantFamily(merchant);
  return family !== null && "confirmEveryTime" in family && family.confirmEveryTime === true;
}

export function importedDefaultCategory(input: {
  merchant: string | null;
  accountLabel: string;
  direction: "INFLOW" | "OUTFLOW";
}): string | null {
  const merchant = normalizeMerchantName(input.merchant);
  if (
    merchant !== null &&
    /^payment\s*-\s*thank you(?:\s*\/\s*pai\s*ement\s*-\s*merci)?$/u.test(merchant) &&
    /\b(?:credit|visa|mastercard|amex)\b/iu.test(input.accountLabel) &&
    input.direction === "INFLOW"
  ) {
    return CATEGORY_IDS.systemTransfer;
  }
  return importedMerchantFamily(input.merchant)?.categoryId ?? null;
}
