export type CardFace = "front" | "back" | "info";

export type CardFields = {
  company: string;
  personName: string;
  title: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  notes: string;
  line: string;
};

export type BusinessCard = CardFields & {
  id: string;
  frontImage: string;
  backImage: string | null;
  createdAt: number;
  isSample?: boolean;
  favorite?: boolean;
  lastViewedAt?: number;
};

export const EMPTY_FIELDS: CardFields = {
  company: "",
  personName: "",
  title: "",
  phone: "",
  email: "",
  website: "",
  address: "",
  notes: "",
  line: "",
};

export const LINE_SUGGESTIONS = [
  "Construction",
  "Fishing",
  "Glass",
  "Design",
  "Law",
  "Food",
  "Wine",
  "Photo",
  "Flowers",
  "Interiors",
  "Type",
] as const;

/** Keyword → line-of-work map used by OCR / free-text suggestions. */
export const LINE_KEYWORDS: { line: string; keywords: string[] }[] = [
  {
    line: "Construction",
    keywords: ["construction", "contractor", "builder", "build", "steel", "carpentry", "framing"],
  },
  {
    line: "Fishing",
    keywords: ["fish", "fishing", "harbor", "maritime", "boat", "seafood", "angler"],
  },
  {
    line: "Glass",
    keywords: ["glass", "glazier", "glazing", "window"],
  },
  {
    line: "Design",
    keywords: ["design", "designer", "creative", "brand", "branding", "studio"],
  },
  {
    line: "Law",
    keywords: ["law", "attorney", "legal", "counsel", "lawyer", "esq"],
  },
  {
    line: "Photo",
    keywords: ["photo", "photography", "photographer", "camera", "portrait"],
  },
  {
    line: "Food",
    keywords: ["food", "restaurant", "chef", "kitchen", "cafe", "café", "culinary", "catering"],
  },
  {
    line: "Wine",
    keywords: ["wine", "vineyard", "sommelier", "winery", "viticulture"],
  },
  {
    line: "Interiors",
    keywords: ["interior", "interiors", "architect", "architecture", "furniture", "spatial"],
  },
  {
    line: "Flowers",
    keywords: ["flower", "florist", "botanical", "floral"],
  },
  {
    line: "Type",
    keywords: ["type", "typography", "letterpress", "print", "typesetting"],
  },
];

export function normalizeLine(line: string): string {
  return line
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toLocaleUpperCase());
}

export function companyLetter(company: string): string {
  const ch = company.trim().charAt(0);
  if (!ch) return "#";
  const up = ch.toLocaleUpperCase();
  return /[A-Z]/.test(up) ? up : "#";
}

export function sortCards(cards: BusinessCard[]): BusinessCard[] {
  return [...cards].sort((a, b) => {
    const aEmpty = !a.company.trim();
    const bEmpty = !b.company.trim();
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const company = a.company.localeCompare(b.company, undefined, {
      sensitivity: "base",
    });
    if (company !== 0) return company;
    const name = a.personName.localeCompare(b.personName, undefined, {
      sensitivity: "base",
    });
    if (name !== 0) return name;
    return a.createdAt - b.createdAt;
  });
}

export function matchesQuery(card: BusinessCard, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    card.company,
    card.personName,
    card.title,
    card.email,
    card.phone,
    card.website,
    card.address,
    card.notes,
    card.line,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function matchesLine(card: BusinessCard, lineFilter: string): boolean {
  const filter = normalizeLine(lineFilter);
  if (!filter) return true;
  return normalizeLine(card.line) === filter;
}

export function uniqueLines(cards: BusinessCard[]): string[] {
  const set = new Set<string>();
  for (const card of cards) {
    const line = normalizeLine(card.line);
    if (line) set.add(line);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function websiteHref(site: string): string {
  const s = site.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function mapsHref(address: string): string {
  const a = address.trim();
  if (!a) return "";
  const q = encodeURIComponent(a);
  const isiOS =
    typeof navigator !== "undefined" &&
    typeof document !== "undefined" &&
    /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) &&
    "ontouchend" in document;
  if (isiOS) return `https://maps.apple.com/?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function nextFace(face: CardFace): CardFace {
  if (face === "front") return "back";
  if (face === "back") return "info";
  return "front";
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePersonKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Suggest line tags from free text / OCR (includes custom when none match). */
export function suggestLinesFromText(text: string, limit = 5): string[] {
  const lower = text.toLowerCase();
  const scored: { line: string; score: number }[] = [];
  for (const entry of LINE_KEYWORDS) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) score += kw.length;
    }
    if (score > 0) scored.push({ line: entry.line, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const lines = scored.map((s) => s.line);
  // Always allow picking from the curated list as fallbacks.
  for (const suggestion of LINE_SUGGESTIONS) {
    if (!lines.includes(suggestion)) lines.push(suggestion);
  }
  return lines.slice(0, Math.max(limit, scored.length || 0) || LINE_SUGGESTIONS.length);
}

export function guessLineFromText(text: string): string {
  const suggested = suggestLinesFromText(text, 1);
  // Only return a confident keyword hit, not a blind fallback.
  const lower = text.toLowerCase();
  for (const entry of LINE_KEYWORDS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.line;
    }
  }
  return suggested[0] && LINE_KEYWORDS.some((e) => e.line === suggested[0] && e.keywords.some((kw) => lower.includes(kw)))
    ? suggested[0]
    : "";
}

export function cardClipboardText(card: Pick<BusinessCard, keyof CardFields>): string {
  const rows: [string, string][] = [
    ["Name", card.personName],
    ["Company", card.company],
    ["Title", card.title],
    ["Phone", card.phone],
    ["Email", card.email],
    ["Website", card.website],
    ["Address", card.address],
    ["Line", card.line],
    ["Notes", card.notes],
  ];
  return rows
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v.trim()}`)
    .join("\n");
}

export function withCardDefaults(card: BusinessCard): BusinessCard {
  return {
    ...card,
    line: card.line ?? "",
    favorite: Boolean(card.favorite),
    lastViewedAt: card.lastViewedAt ?? undefined,
  };
}
