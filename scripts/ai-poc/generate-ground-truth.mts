/**
 * Ground Truth 견적의뢰 샘플 50건 생성
 * 한/영/중 + 다양한 표현으로 Canonical 정답 라벨 포함
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalExtraction, DocumentLanguage } from '../../src/types/aiMail.ts';
import { emptyField } from '../../src/types/aiMail.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'fixtures');

const CUSTOMERS = [
  { ko: '한진해운', en: 'Hanjin Shipping', zh: '韩进海运', email: 'rfq@hanjin.example' },
  { ko: '현대중공업', en: 'Hyundai Heavy', zh: '现代重工', email: 'purchase@hhi.example' },
  { ko: '삼성중공업', en: 'Samsung Heavy', zh: '三星重工', email: 'buyer@shi.example' },
  { ko: '대우조선해양', en: 'DSME', zh: '大宇造船', email: 'rfq@dsme.example' },
  { ko: '팬오션', en: 'Pan Ocean', zh: '泛洋航运', email: 'ops@panocean.example' },
];

const PRODUCTS = [
  { ko: '밸브', en: 'Valve', zh: '阀门', spec: 'DN50 PN16', unit: 'EA' },
  { ko: '가스켓', en: 'Gasket', zh: '垫片', spec: 'ASME B16.20', unit: 'SET' },
  { ko: '베어링', en: 'Bearing', zh: '轴承', spec: '6205-2RS', unit: 'EA' },
  { ko: '호스', en: 'Hose', zh: '软管', spec: '1-1/2 inch', unit: 'M' },
  { ko: '필터', en: 'Filter', zh: '过滤器', spec: '10 micron', unit: 'EA' },
];

function field<T>(
  value: T,
  original_key: string,
  original_value: string,
  confidence = 1,
  language: DocumentLanguage = 'ko',
) {
  return {
    ...emptyField(value),
    original_key,
    original_value,
    confidence,
    evidence_text: original_value,
    language,
    source_file: 'body.txt',
    source_page: 1,
  };
}

function makeBody(lang: DocumentLanguage, i: number, cust: typeof CUSTOMERS[0], items: typeof PRODUCTS): string {
  if (lang === 'en') {
    return [
      `Subject: RFQ #${1000 + i}`,
      `RFQ No: RFQ-${1000 + i}`,
      `From: ${cust.en} <${cust.email}>`,
      `Dear Sir,`,
      `Please quote the following items.`,
      `Company: ${cust.en}`,
      `Required Date: 2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      `Vessel: MV TEST-${i}`,
      ...items.map((p, idx) =>
        `${idx + 1}. Item: ${p.en} / Spec: ${p.spec} / Qty: ${(idx + 1) * 2} ${p.unit}`,
      ),
      `Best regards`,
    ].join('\n');
  }
  if (lang === 'zh') {
    return [
      `主题: 询价单 #${1000 + i}`,
      `询价单号: RFQ-${1000 + i}`,
      `公司: ${cust.zh}`,
      `交货日期: 2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      `船名: MV TEST-${i}`,
      ...items.map((p, idx) =>
        `${idx + 1}. 产品名称: ${p.zh} / 规格: ${p.spec} / 数量: ${(idx + 1) * 2} ${p.unit}`,
      ),
    ].join('\n');
  }
  // ko + mixed
  const mixed = lang === 'mixed';
  return [
    `제목: 견적의뢰 #${1000 + i}`,
    `문서번호: RFQ-${1000 + i}`,
    `거래처: ${mixed ? cust.en : cust.ko}`,
    `납기: 2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    `선명: MV TEST-${i}`,
    `담당: 김영업`,
    ...items.map((p, idx) =>
      `${idx + 1}. 품명: ${mixed ? p.en : p.ko} / 사양: ${p.spec} / 수량: ${(idx + 1) * 2} ${p.unit}`,
    ),
    `비고: 긴급 요청`,
  ].join('\n');
}

function makeGroundTruth(
  lang: DocumentLanguage,
  i: number,
  cust: typeof CUSTOMERS[0],
  products: typeof PRODUCTS,
): CanonicalExtraction {
  const name =
    lang === 'en' ? cust.en : lang === 'zh' ? cust.zh : lang === 'mixed' ? cust.en : cust.ko;
  const nameKey =
    lang === 'en' ? 'Company' : lang === 'zh' ? '公司' : '거래처';

  return {
    document_type: 'quotation_request',
    language: lang,
    overall_confidence: 1,
    customer: {
      name: field(name, nameKey, name, 1, lang),
      contact_name: field(
        lang === 'ko' || lang === 'mixed' ? '김영업' : null,
        lang === 'ko' || lang === 'mixed' ? '담당' : null,
        lang === 'ko' || lang === 'mixed' ? '김영업' : null,
        lang === 'ko' || lang === 'mixed' ? 1 : 0,
        lang,
      ),
      email: field(cust.email, 'email', cust.email, 0.9, 'en'),
      tel: emptyField(null),
      biz_no: emptyField(null),
      addr: emptyField(null),
    },
    request: {
      document_no: field(
        `RFQ-${1000 + i}`,
        lang === 'en' ? 'RFQ No' : lang === 'zh' ? '询价单号' : '문서번호',
        `RFQ-${1000 + i}`,
        1,
        lang,
      ),
      request_date: field(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 'request_date', `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, 0.8, lang),
      delivery_date: field(
        `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        lang === 'en' ? 'Required Date' : lang === 'zh' ? '交货日期' : '납기',
        `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        1,
        lang,
      ),
      currency: field(lang === 'zh' ? 'CNY' : lang === 'en' ? 'USD' : 'KRW', 'currency', lang === 'zh' ? 'CNY' : lang === 'en' ? 'USD' : 'KRW', 0.7, lang),
      vessel: field(`MV TEST-${i}`, lang === 'zh' ? '船名' : lang === 'en' ? 'Vessel' : '선명', `MV TEST-${i}`, 1, lang),
      contact_person: field(
        lang === 'ko' || lang === 'mixed' ? '김영업' : null,
        '담당',
        lang === 'ko' || lang === 'mixed' ? '김영업' : null,
        lang === 'ko' || lang === 'mixed' ? 1 : 0,
        lang,
      ),
    },
    items: products.map((p, idx) => {
      const pname = lang === 'en' ? p.en : lang === 'zh' ? p.zh : lang === 'mixed' ? p.en : p.ko;
      const qty = (idx + 1) * 2;
      return {
        product_name: field(pname, lang === 'en' ? 'Item' : lang === 'zh' ? '产品名称' : '품명', pname, 1, lang),
        product_code: emptyField(null),
        specification: field(p.spec, lang === 'en' ? 'Spec' : lang === 'zh' ? '规格' : '사양', p.spec, 1, lang),
        quantity: field(qty, lang === 'en' ? 'Qty' : lang === 'zh' ? '数量' : '수량', String(qty), 1, lang),
        unit: field(p.unit, 'unit', p.unit, 1, 'en'),
        requested_price: emptyField(null),
        remark: emptyField(null),
      };
    }),
    remarks: field(
      lang === 'ko' || lang === 'mixed' ? '긴급 요청' : null,
      '비고',
      lang === 'ko' || lang === 'mixed' ? '긴급 요청' : null,
      lang === 'ko' || lang === 'mixed' ? 0.9 : 0,
      lang,
    ),
  };
}

const langs: DocumentLanguage[] = ['ko', 'en', 'zh', 'mixed'];

mkdirSync(OUT_DIR, { recursive: true });

const index: { id: string; language: DocumentLanguage; body_file: string; truth_file: string }[] = [];

for (let i = 0; i < 50; i++) {
  const lang = langs[i % langs.length];
  const cust = CUSTOMERS[i % CUSTOMERS.length];
  const products = [
    PRODUCTS[i % PRODUCTS.length],
    PRODUCTS[(i + 1) % PRODUCTS.length],
    ...(i % 3 === 0 ? [PRODUCTS[(i + 2) % PRODUCTS.length]] : []),
  ];
  const id = `gt-${String(i + 1).padStart(3, '0')}`;
  const body = makeBody(lang, i, cust, products);
  const truth = makeGroundTruth(lang, i, cust, products);

  writeFileSync(join(OUT_DIR, `${id}.body.txt`), body, 'utf8');
  writeFileSync(join(OUT_DIR, `${id}.truth.json`), JSON.stringify(truth, null, 2), 'utf8');
  index.push({
    id,
    language: lang,
    body_file: `${id}.body.txt`,
    truth_file: `${id}.truth.json`,
  });
}

writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
console.log(`Generated ${index.length} ground-truth fixtures in ${OUT_DIR}`);
