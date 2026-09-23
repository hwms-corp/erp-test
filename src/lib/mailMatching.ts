import type { MaterialLine, Partner } from '@/types';
import type { CanonicalExtraction, ExtractedField, PartnerMatchCandidate } from '@/types/aiMail';

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

function editedField<T>(
  value: T,
  prev?: ExtractedField<T> | null,
  originalKey?: string | null,
): ExtractedField<T> {
  const str = value == null || value === '' ? null : String(value);
  return {
    value,
    original_key: prev?.original_key ?? originalKey ?? null,
    original_value: prev?.original_value ?? str,
    confidence: 1,
    source_file: prev?.source_file ?? 'body',
    source_page: prev?.source_page ?? null,
    evidence_text: prev?.evidence_text ?? str,
    language: prev?.language ?? null,
  };
}

/** 견적서 작성 폼(MaterialLine[]) → CanonicalExtraction items */
export function materialLinesToExtractionItems(
  lines: MaterialLine[],
  prevItems: CanonicalExtraction['items'] = [],
): CanonicalExtraction['items'] {
  return lines
    .filter(l => l.name.trim())
    .map((l, i) => {
      const prev = prevItems[i];
      return {
        product_name: editedField(l.name.trim(), prev?.product_name, '품명'),
        product_code: prev?.product_code ?? editedField(null),
        specification: editedField(l.spec.trim() || null, prev?.specification, '사양'),
        quantity: editedField(l.qty, prev?.quantity, '수량'),
        unit: editedField(l.unit.trim() || 'EA', prev?.unit, '단위'),
        requested_price: editedField(l.price, prev?.requested_price, '단가'),
        remark: editedField(l.remark.trim() || null, prev?.remark, '비고'),
      };
    });
}

export type OrderFormExtractionInput = {
  docNo: string;
  orderDate: string;
  contactPerson: string;
  vessel: string;
  customerName?: string;
  deliveryDate?: string;
  lines: MaterialLine[];
};

/** 견적서 작성 폼 값을 CanonicalExtraction에 반영 (분류 저장·KV용) */
export function applyOrderFormToExtraction(
  base: CanonicalExtraction,
  form: OrderFormExtractionInput,
): CanonicalExtraction {
  const docNo = form.docNo.trim() || null;
  const orderDate = form.orderDate.trim() || null;
  const contact = form.contactPerson.trim() || null;
  const vessel = form.vessel.trim() || null;
  const customerName = form.customerName?.trim();
  const deliveryDate = form.deliveryDate?.trim() || null;

  return {
    ...base,
    customer: {
      ...base.customer,
      name: customerName != null && customerName !== ''
        ? editedField(customerName, base.customer.name, '거래처')
        : base.customer.name,
      contact_name: contact
        ? editedField(contact, base.customer.contact_name, '담당자')
        : base.customer.contact_name,
    },
    request: {
      ...base.request,
      document_no: editedField(docNo, base.request.document_no, '견적번호'),
      request_date: editedField(orderDate, base.request.request_date, '견적일자'),
      contact_person: editedField(contact, base.request.contact_person, '담당자'),
      vessel: editedField(vessel, base.request.vessel, 'Vessel'),
      delivery_date: deliveryDate != null
        ? editedField(deliveryDate, base.request.delivery_date, '납기')
        : base.request.delivery_date,
    },
    items: materialLinesToExtractionItems(form.lines, base.items),
  };
}

export function decideProcessStatus(extraction: CanonicalExtraction): 'ready_auto' | 'review_required' {
  const conf = extraction.overall_confidence;
  const hasCustomer = !!extraction.customer.name.value;
  const hasItems = extraction.items.some(i => i.product_name.value && i.quantity.value != null);
  // 문서번호 없어도 등록은 가능. 없으면 검토필수로 둠
  const hasDocNo = !!extraction.request.document_no?.value?.toString().trim();
  // 실측 overall_confidence 가 대개 ~0.90 이라 0.95는 사실상 자동후보 불가 → 0.85로 조정
  if (conf >= 0.85 && hasCustomer && hasItems && hasDocNo) return 'ready_auto';
  return 'review_required';
}
