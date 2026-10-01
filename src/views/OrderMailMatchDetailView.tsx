import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Link2, Unlink, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  assignOrderMailMatches,
  buildMailCorpus,
  type FieldMatchEvidence,
  type OrderMailMatchRow,
} from '@/lib/orderMailMatch';
import { displayMailBody } from '@/lib/mailBody';
import { formatReceivedAtKst } from '@/lib/mailTime';
import type { MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

export function OrderMailMatchDetailView() {
  const { orderId: orderIdParam } = useParams();
  const orderId = Number(orderIdParam);
  const [row, setRow] = useState<OrderMailMatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(orderId) || orderId <= 0) {
      setError('잘못된 견적 ID');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: orderView, error: oErr } = await supabase
          .from('v_orders_with_partner')
          .select('*')
          .eq('id', orderId)
          .maybeSingle();
        if (oErr) throw oErr;
        if (!orderView) throw new Error('견적서를 찾을 수 없습니다.');

        const { data: meta } = await supabase
          .from('orders')
          .select('id, source, ai_review_status, ai_mail_message_id')
          .eq('id', orderId)
          .maybeSingle();

        const order: OrderWithPartner = {
          ...(orderView as OrderWithPartner),
          source: meta?.source ?? 'manual',
          ai_review_status: meta?.ai_review_status ?? null,
          ai_mail_message_id: meta?.ai_mail_message_id ?? null,
        };

        const { data: items } = await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', orderId)
          .is('deleted_at', null)
          .order('seq', { ascending: true });

        const { data: partner } = await supabase
          .from('partners')
          .select('id, email')
          .eq('id', order.partner_id)
          .maybeSingle();

        // 후보 메일: 링크된 메일 + 동일 기간 받은메일 검색용 전체(비삭제)
        // 상세는 단일 견적만 재계산 — 메일 전량은 무거우므로 링크 우선 후 컨텐츠 매칭용 페이지 로드
        const { data: allMailsPage, error: mErr } = await supabase
          .from('mail_messages')
          .select('*')
          .is('deleted_at', null)
          .eq('is_sent', false)
          .order('received_at', { ascending: false })
          .limit(2500);
        if (mErr) throw mErr;

        let mails = (allMailsPage || []) as MailMessage[];
        if (order.ai_mail_message_id && !mails.some(m => m.id === order.ai_mail_message_id)) {
          const { data: linked } = await supabase
            .from('mail_messages')
            .select('*')
            .eq('id', order.ai_mail_message_id)
            .maybeSingle();
          if (linked) mails = [linked as MailMessage, ...mails];
        }

        const mailIds = mails.map(m => m.id);
        const attMap = new Map<number, { filename: string }[]>();
        for (let i = 0; i < mailIds.length; i += 200) {
          const ids = mailIds.slice(i, i + 200);
          const { data: atts } = await supabase
            .from('mail_attachments')
            .select('mail_message_id, filename')
            .in('mail_message_id', ids);
          for (const a of atts || []) {
            const list = attMap.get(a.mail_message_id as number) || [];
            list.push({ filename: a.filename as string });
            attMap.set(a.mail_message_id as number, list);
          }
        }

        const corpora = mails.map(m => buildMailCorpus(m, attMap.get(m.id) || []));
        const matched = assignOrderMailMatches({
          orders: [order],
          itemsByOrderId: new Map([[order.id, (items || []) as OrderItem[]]]),
          partnerEmailById: new Map([[order.partner_id, (partner?.email as string | null) || null]]),
          corpora,
        });

        if (!cancelled) setRow(matched[0] || null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '불러오기 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const bodyPreview = useMemo(() => {
    if (!row?.mail) return '';
    return displayMailBody(row.mail);
  }, [row]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin inline-block mr-2 align-middle" />
        상세 매칭 불러오는 중…
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || '데이터 없음'}
        </div>
      </div>
    );
  }

  const matched = row.status === 'matched' && row.mail;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink />
        <div className="flex items-center gap-2">
          {matched ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold">
              <Link2 className="w-3.5 h-3.5" />
              매칭 {row.score != null ? `${Math.round(row.score * 100)}%` : ''}
              {row.matchMethod ? ` · ${methodLabel(row.matchMethod)}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 text-xs font-semibold">
              <Unlink className="w-3.5 h-3.5" />
              비매칭
            </span>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">
          상세비교 · {row.order.doc_no}
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          왼쪽 메일 입력값이 오른쪽 견적서 필드로 어떻게 매칭됐는지 확인합니다. (금액·단가 제외)
        </p>
      </div>

      {/* 매핑 도식 */}
      <MappingDiagram evidences={row.evidences} unmatched={!matched} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {/* LEFT: Mail */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-w-0">
          <header className="px-4 py-3 border-b border-slate-100 bg-emerald-50/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">메일 (Input)</p>
            {row.mail ? (
              <>
                <p className="text-sm font-semibold text-slate-900 mt-1 break-words">
                  {row.mail.subject || '(제목 없음)'}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {row.mail.from_addr} · {formatReceivedAtKst(row.mail.received_at)}
                </p>
              </>
            ) : (
              <p className="text-sm text-amber-800 mt-1">매칭된 메일이 없습니다.</p>
            )}
          </header>
          {row.mail && (
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <MetaLine label="From" value={row.mail.from_addr} />
              <MetaLine label="To" value={row.mail.to_addr} />
              <MetaLine label="제목" value={row.mail.subject} />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">본문</p>
                <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100">
                  {bodyPreview || '(본문 없음)'}
                </pre>
              </div>
              {row.evidences.filter(e => e.matched && e.mailEvidence).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">매칭 근거 하이라이트</p>
                  <ul className="space-y-1.5">
                    {row.evidences
                      .filter(e => e.matched && e.mailEvidence)
                      .map((e, i) => (
                        <li
                          key={`${e.key}-${i}`}
                          className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-2.5 py-1.5 text-[11px] text-slate-700"
                        >
                          <span className="font-semibold text-emerald-800">{e.label}</span>
                          <span className="text-slate-400"> → </span>
                          <span className="font-mono">{e.mailEvidence}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <div className="pt-1">
                <Link
                  to={`/mail/${row.mail.id}`}
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  메일 상세 열기 →
                </Link>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT: Order */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-w-0">
          <header className="px-4 py-3 border-b border-slate-100 bg-indigo-50/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-800">견적서 (Output)</p>
            <p className="text-sm font-semibold text-slate-900 mt-1">{row.order.doc_no}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {row.order.order_date} · {row.order.partner_name}
            </p>
          </header>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <FieldOut label="견적번호" value={row.order.doc_no} evidence={findEv(row.evidences, 'doc_no')} />
            <FieldOut label="견적일" value={row.order.order_date} />
            <FieldOut
              label="거래처"
              value={row.order.partner_name}
              evidence={findEv(row.evidences, 'partner_name')}
            />
            <FieldOut
              label="거래처 이메일"
              value={row.partnerEmail}
              evidence={findEv(row.evidences, 'partner_email')}
            />
            <FieldOut
              label="담당자"
              value={row.order.contact_person}
              evidence={findEv(row.evidences, 'contact_person')}
            />
            <FieldOut label="Vessel" value={row.order.vessel} evidence={findEv(row.evidences, 'vessel')} />

            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">품목 (단가·금액 제외)</p>
              <div className="overflow-x-auto rounded-lg border border-slate-150 border-slate-200">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">품명</th>
                      <th className="px-2 py-1.5 text-left font-medium">사양</th>
                      <th className="px-2 py-1.5 text-right font-medium">수량</th>
                      <th className="px-2 py-1.5 text-left font-medium">단위</th>
                      <th className="px-2 py-1.5 text-center font-medium">매칭</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {row.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-2 py-4 text-center text-slate-400">
                          품목 없음
                        </td>
                      </tr>
                    ) : (
                      row.items.map(it => {
                        const nameEv = row.evidences.find(
                          e => e.key === 'item_name' && e.orderValue === it.name,
                        );
                        return (
                          <tr key={it.id}>
                            <td className="px-2 py-1.5 text-slate-400">{it.seq}</td>
                            <td className="px-2 py-1.5 text-slate-800">{it.name}</td>
                            <td className="px-2 py-1.5 text-slate-600">{it.spec || '—'}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                            <td className="px-2 py-1.5">{it.unit}</td>
                            <td className="px-2 py-1.5 text-center">
                              {nameEv?.matched ? (
                                <span className="text-emerald-600 font-semibold">✓</span>
                              ) : matched ? (
                                <span className="text-amber-600 font-semibold">△</span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-1">
              <Link
                to={`/orders/${row.order.id}/edit`}
                className="text-xs font-semibold text-indigo-600 hover:underline"
              >
                견적서 편집 열기 →
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/mail?box=learn_order_match"
      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-indigo-700"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      학습샘플 · 기존 견적서 - 메일 매칭
    </Link>
  );
}

function methodLabel(m: NonNullable<OrderMailMatchRow['matchMethod']>) {
  if (m === 'ai_link') return 'AI링크';
  if (m === 'registered_link') return '등록링크';
  return '내용매칭';
}

function findEv(list: FieldMatchEvidence[], key: FieldMatchEvidence['key']) {
  return list.find(e => e.key === key) || null;
}

function MetaLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
      <p className="text-[12px] text-slate-800 break-words">{value || '—'}</p>
    </div>
  );
}

function FieldOut({
  label,
  value,
  evidence,
}: {
  label: string;
  value: string | null | undefined;
  evidence?: FieldMatchEvidence | null;
}) {
  const matched = evidence?.matched;
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        matched
          ? 'border-emerald-200 bg-emerald-50/40'
          : evidence
            ? 'border-amber-200 bg-amber-50/30'
            : 'border-slate-150 border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
        {evidence ? (
          matched ? (
            <span className="text-[10px] font-semibold text-emerald-700">메일에서 매칭</span>
          ) : (
            <span className="text-[10px] font-semibold text-amber-700">메일에서 미검출</span>
          )
        ) : null}
      </div>
      <p className="text-sm font-medium text-slate-900 break-words mt-0.5">{value || '—'}</p>
      {evidence?.mailEvidence && (
        <p className="mt-1 text-[11px] text-slate-500 font-mono break-words">← {evidence.mailEvidence}</p>
      )}
    </div>
  );
}

function MappingDiagram({
  evidences,
  unmatched,
}: {
  evidences: FieldMatchEvidence[];
  unmatched: boolean;
}) {
  const lines = evidences.filter(e => e.key !== 'linked_id').slice(0, 14);
  if (unmatched) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
        이 견적서와 거의 동일한 내용의 메일을 찾지 못했습니다. 비매칭으로 표시됩니다.
      </div>
    );
  }
  if (!lines.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        링크 기반으로 연결되었습니다. 아래 좌·우 패널에서 필드를 확인하세요.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm overflow-x-auto">
      <p className="text-[11px] font-bold text-slate-500 mb-2 px-1">필드 매핑 도식 (메일 → 견적)</p>
      <div className="min-w-[640px] space-y-1.5">
        {lines.map((e, i) => (
          <div key={`${e.key}-${i}`} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px]">
            <div
              className={`rounded-md border px-2 py-1.5 truncate ${
                e.matched ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
              title={e.mailEvidence || ''}
            >
              <span className="font-semibold">{e.label}</span>
              <span className="text-slate-400"> · </span>
              {e.mailEvidence || (e.matched ? e.orderValue : '근거 없음')}
            </div>
            <ArrowRight
              className={`w-4 h-4 shrink-0 ${e.matched ? 'text-emerald-500' : 'text-slate-300'}`}
            />
            <div
              className={`rounded-md border px-2 py-1.5 truncate ${
                e.matched ? 'border-indigo-200 bg-indigo-50 text-indigo-900' : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
              title={e.orderValue}
            >
              <span className="font-semibold">{e.label}</span>
              <span className="text-slate-400"> · </span>
              {e.orderValue}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
