/**
 * Module 09 (B2B Client Finder) rules: which printing services fit a business segment,
 * a transparent lead score, follow-up state, and a commercial offer text built from a template.
 * These are RULES (recommendations), not collected facts — the UI labels them so.
 */

export const SEGMENTS = ['restaurant', 'cafe', 'hotel', 'retail', 'mall', 'factory', 'manufacturer', 'ad_agency', 'corporate', 'other'];
export const SERVICES = ['business_cards', 'brochures', 'catalogues', 'menus', 'packaging', 'labels', 'stickers', 'banners', 'flyers', 'corporate'];
export const STAGES = ['new', 'contacted', 'interested', 'offer_sent', 'negotiation', 'won', 'lost'];
export const OPEN_STAGES = ['new', 'contacted', 'interested', 'offer_sent', 'negotiation'];

/** Typical printing needs per segment (ordered by relevance). */
export const SEGMENT_SERVICES = Object.freeze({
  restaurant: ['menus', 'business_cards', 'flyers', 'banners', 'stickers', 'packaging'],
  cafe: ['menus', 'stickers', 'packaging', 'business_cards', 'flyers'],
  hotel: ['brochures', 'business_cards', 'corporate', 'menus', 'banners'],
  retail: ['labels', 'stickers', 'flyers', 'banners', 'packaging', 'business_cards'],
  mall: ['banners', 'flyers', 'brochures', 'stickers'],
  factory: ['labels', 'packaging', 'catalogues', 'corporate'],
  manufacturer: ['packaging', 'labels', 'catalogues', 'brochures', 'business_cards'],
  ad_agency: ['banners', 'flyers', 'brochures', 'business_cards', 'stickers'],
  corporate: ['business_cards', 'corporate', 'brochures', 'catalogues'],
  other: ['business_cards', 'flyers'],
});

export const recommendedServices = (segment) => SEGMENT_SERVICES[segment] ?? SEGMENT_SERVICES.other;

const SEGMENT_FIT = { restaurant: 25, cafe: 25, hotel: 22, retail: 20, manufacturer: 22, factory: 20, mall: 18, ad_agency: 15, corporate: 18, other: 8 };
const SIZE_POINTS = { micro: 4, small: 8, medium: 13, large: 15 };
const STAGE_POINTS = { new: 0, contacted: 5, interested: 12, offer_sent: 15, negotiation: 18, won: 20, lost: 0 };

/**
 * Lead score 0–100:
 *   segment fit for printing 0–25 · size 0–15 (unknown 6) · new business +10
 *   reachable: phone +8, e-mail +6, website/social +6 · services of interest 0–10 (2 each)
 *   pipeline stage 0–20 · lost = 0 overall
 */
export function leadScore(lead, company = {}) {
  if (lead.stage === 'lost') return 0;
  let s = SEGMENT_FIT[lead.segment] ?? 8;
  s += lead.size ? SIZE_POINTS[lead.size] ?? 0 : 6;
  if (lead.is_new_business) s += 10;
  if (company.phone) s += 8;
  if (company.email) s += 6;
  if (company.website || (company.social && Object.values(company.social).some(Boolean))) s += 6;
  s += Math.min(10, (lead.services?.length ?? 0) * 2);
  s += STAGE_POINTS[lead.stage] ?? 0;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** 'overdue' | 'today' | 'soon' (≤ 3 days) | 'later' | null — dates as YYYY-MM-DD. */
export function followUpState(date, today = new Date().toISOString().slice(0, 10)) {
  if (!date) return null;
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  const days = (Date.parse(date) - Date.parse(today)) / 86400000;
  return days <= 3 ? 'soon' : 'later';
}

/** Commercial offer text from a dictionary template (texts come from the caller's language). */
export function offerText({ template, company, sender, services, prices = {}, labels, money, validUntil }) {
  const lines = services.map((s) => `• ${labels[s] ?? s}${prices[s] ? ` — ${money(prices[s])}` : ''}`).join('\n');
  return template
    .replaceAll('{company}', company ?? '')
    .replaceAll('{sender}', sender ?? '')
    .replaceAll('{services}', lines)
    .replaceAll('{valid}', validUntil ?? '');
}
