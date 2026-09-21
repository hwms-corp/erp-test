import type { Partner } from '@/types';
import type { CanonicalExtraction, PartnerMatchCandidate } from '@/types/aiMail';

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

/** 거래처 Master 후보 랭킹 */
export function matchPartners(
  extraction: CanonicalExtraction,
  partners: Partner[],
  limit = 5,
): PartnerMatchCandidate[] {
  const name = extraction.customer.name.value?.trim() || '';
  const bizNo = extraction.customer.biz_no.value?.replace(/\D/g, '') || '';
  const email = extraction.customer.email.value?.trim().toLowerCase() || '';

  const scored: PartnerMatchCandidate[] = [];

  for (const p of partners) {
    if (p.deleted_at) continue;
    let score = 0;
    const reasons: string[] = [];

    if (bizNo && p.biz_no.replace(/\D/g, '') === bizNo) {
      score += 0.6;
      reasons.push('biz_no exact');
    }
    if (email && p.email?.toLowerCase() === email) {
      score += 0.35;
      reasons.push('email exact');
    }
    if (name) {
      const pn = norm(p.name);
      const nn = norm(name);
      if (pn === nn) {
        score += 0.5;
        reasons.push('name exact');
      } else if (pn.includes(nn) || nn.includes(pn)) {
        score += 0.3;
        reasons.push('name partial');
      }
    }

    if (score > 0) {
      scored.push({
        partner_id: p.id,
        partner_code: p.code,
        partner_name: p.name,
        score: Math.min(1, score),
        reason: reasons.join(', '),
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function extractionToMaterialLines(extraction: CanonicalExtraction) {
  return extraction.items
    .filter(it => it.product_name.value)
    .map(it => ({
      name: String(it.product_name.value || ''),
      spec: String(it.specification.value || ''),
      qty: Number(it.quantity.value ?? 1) || 1,
      unit: String(it.unit.value || 'EA'),
      price: Number(it.requested_price.value ?? 0) || 0,
      remark: String(it.remark.value || extraction.remarks.value || ''),
    }));
}

export function decideProcessStatus(extraction: CanonicalExtraction): 'ready_auto' | 'review_required' {
  const conf = extraction.overall_confidence;
  const hasCustomer = !!extraction.customer.name.value;
  const hasItems = extraction.items.some(i => i.product_name.value && i.quantity.value != null);
  // 문서번호 없어도 등록은 가능. 없으면 검토필수로 둠
  const hasDocNo = !!extraction.request.document_no?.value?.toString().trim();
  if (conf >= 0.95 && hasCustomer && hasItems && hasDocNo) return 'ready_auto';
  return 'review_required';
}
