import QRCode from "qrcode";
import type { BusinessCard, CardFields } from "./types";
import { websiteHref } from "./types";

function vcardEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function buildVCard(card: Pick<BusinessCard, keyof CardFields | "id">): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  const name = card.personName.trim();
  const company = card.company.trim();
  if (name) {
    const parts = name.split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0];
    lines.push(`N:${vcardEscape(last)};${vcardEscape(first)};;;`);
    lines.push(`FN:${vcardEscape(name)}`);
  } else if (company) {
    lines.push(`FN:${vcardEscape(company)}`);
  }
  if (company) lines.push(`ORG:${vcardEscape(company)}`);
  if (card.title.trim()) lines.push(`TITLE:${vcardEscape(card.title.trim())}`);
  if (card.phone.trim()) lines.push(`TEL;TYPE=CELL:${vcardEscape(card.phone.trim())}`);
  if (card.email.trim()) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(card.email.trim())}`);
  const site = websiteHref(card.website);
  if (site) lines.push(`URL:${vcardEscape(site)}`);
  if (card.address.trim()) {
    lines.push(`ADR;TYPE=WORK:;;${vcardEscape(card.address.trim())};;;;`);
  }
  if (card.notes.trim() || card.line.trim()) {
    const note = [card.line.trim() && `Line: ${card.line.trim()}`, card.notes.trim()]
      .filter(Boolean)
      .join(" — ");
    lines.push(`NOTE:${vcardEscape(note)}`);
  }
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function downloadVCard(card: BusinessCard): void {
  const text = buildVCard(card);
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const base =
    (card.personName || card.company || "contact")
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 48) || "contact";
  a.href = url;
  a.download = `${base}.vcf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function vcardQrDataUrl(card: BusinessCard): Promise<string> {
  const text = buildVCard(card);
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
    color: { dark: "#1a1612", light: "#f4eee4" },
  });
}

export async function shareCard(card: BusinessCard): Promise<"shared" | "copied" | "unavailable"> {
  const text = buildVCard(card);
  const fileName =
    `${(card.personName || card.company || "contact").trim().replace(/[^\w.-]+/g, "_") || "contact"}.vcf`;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      const file = new File([text], fileName, { type: "text/vcard" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: card.personName || card.company || "Contact",
          text: `${card.personName || ""}${card.company ? ` · ${card.company}` : ""}`.trim(),
        });
        return "shared";
      }
      await navigator.share({
        title: card.personName || card.company || "Contact",
        text,
      });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "unavailable";
      }
      // fall through to clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "unavailable";
  }
}

export function canNativeShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
