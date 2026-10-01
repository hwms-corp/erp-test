import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Link2, Unlink, RefreshCw, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { OrderMailLearningMatchRow } from '@/lib/orderMailMatch';
import { displayMailBody } from '@/lib/mailBody';
import { formatReceivedAtKst } from '@/lib/mailTime';
import type { MailMessage } from '@/types/aiMail';
import type { OrderItem, OrderWithPartner } from '@/types';

type EvidenceField = {
  order_field?: string;
  order_value?: string;
  mail_evidence?: string;
  source?: string;
  matched?: boolean;
};

export function OrderMailMatchDetailView() {
  const { orderId: orderIdParam } = useParams();
  const orderId = Number(orderIdParam);
  const [order, setOrder] = useState<OrderWithPartner | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [match, setMatch] = useState<OrderMailLearningMatchRow | null>(null);
  const [mail, setMail] = useState<MailMessage | null>(null);
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

        const { data: itemsData } = await supabase
          .from('order_items')
          .select('*')
          .eq('order_id', orderId)
          .is('deleted_at', null)
          .order('seq', { ascending: true });

        const { data: matchRow } = await supabase
          .from('order_mail_learning_matches')
          .select('*')
          .eq('order_id', orderId)
          .maybeSingle();

        let mailRow: MailMessage | null = null;
        if (matchRow?.mail_message_id) {
          const { data: m } = await supabase
            .from('mail_messages')
            .select('*')
            .eq('id', matchRow.mail_message_id)
            .maybeSingle();
          mailRow = (m as MailMessage) || null;
        }

        if (!cancelled) {
          setOrder(orderView as OrderWithPartner);
          setItems((itemsData || []) as OrderItem[]);
          setMatch((matchRow as OrderMailLearningMatchRow) || null);
          setMail(mailRow);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '불러오기 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  const bodyPreview = useMemo(() => (mail ? displayMailBody(mail) : ''), [mail]);
  const evidenceFields = useMemo(() => {
    const ev = match?.evidence as { fields?: EvidenceField[] } | null;
    return Array.isArray(ev?.fields) ? ev!.fields! : [];
  }, [match]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        <RefreshCw className="w-5 h-5 animate-spin inline-block mr-2 align-middle" />
        상세 불러오는 중…
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="space-y-3">
        <BackLink />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || '데이터 없음'}
        </div>
      </div>
    );
  }

  const matched = match?.status === 'matched' && mail;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink />
        <div className="flex items-center gap-2">
          {!match && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-semibold">
              미실행 — 목록에서 「매칭」을 먼저 실행하세요
            </span>
          )}
          {match?.status === 'matched' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-semibold">
              <Link2 className="w-3.5 h-3.5" />
              매칭 {match.score != null ? `${Math.round(Number(match.score) * 100)}%` : ''}
              {match.engine_version ? ` · ${match.engine_version}` : ''}
            </span>
          )}
          {match?.status === 'unmatched' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 px-2.5 py-1 text-xs font-semibold">
              <Unlink className="w-3.5 h-3.5" />
              비매칭
            </span>
          )}
          {match?.status === 'failed' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 px-2.5 py-1 text-xs font-semibold" title={match.error_message || ''}>
              <AlertTriangle className="w-3.5 h-3.5" />
              실패
            </span>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-lg font-bold text-slate-900 tracking-tight">상세비교 · {order.doc_no}</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          저장된 견적↔메일 키 매칭 결과입니다. 좌측 메일 / 우측 견적 (금액·단가 제외 필드 중심).
        </p>
      </div>

      {evidenceFields.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm overflow-x-auto">
          <p className="text-[11px] font-bold text-slate-500 mb-2 px-1">필드 매핑 도식 (메일 → 견적)</p>
          <div className="min-w-[640px] space-y-1.5">
            {evidenceFields.slice(0, 16).map((e, i) => {
              const ok = e.matched !== false && !!e.mail_evidence;
              return (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-[11px]">
                  <div className={`rounded-md border px-2 py-1.5 truncate ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    <span className="font-semibold">{e.order_field || 'field'}</span>
                    <span className="text-slate-400"> · </span>
                    {e.mail_evidence || '근거 없음'}
                    {e.source ? <span className="text-slate-400"> ({e.source})</span> : null}
                  </div>
                  <ArrowRight className={`w-4 h-4 shrink-0 ${ok ? 'text-emerald-500' : 'text-slate-300'}`} />
                  <div className={`rounded-md border px-2 py-1.5 truncate ${ok ? 'border-indigo-200 bg-indigo-50 text-indigo-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                    <span className="font-semibold">{e.order_field || 'field'}</span>
                    <span className="text-slate-400"> · </span>
                    {e.order_value || '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-w-0">
          <header className="px-4 py-3 border-b border-slate-100 bg-emerald-50/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">메일 (Input)</p>
            {mail ? (
              <>
                <p className="text-sm font-semibold text-slate-900 mt-1 break-words">{mail.subject || '(제목 없음)'}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{mail.from_addr} · {formatReceivedAtKst(mail.received_at)}</p>
              </>
            ) : (
              <p className="text-sm text-amber-800 mt-1">매칭된 메일이 없습니다.</p>
            )}
          </header>
          {mail && (
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              <MetaLine label="From" value={mail.from_addr} />
              <MetaLine label="To" value={mail.to_addr} />
              <MetaLine label="제목" value={mail.subject} />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">본문</p>
                <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-700 bg-slate-50 rounded-lg p-3 border border-slate-100">
                  {bodyPreview || '(본문 없음)'}
                </pre>
              </div>
              <Link to={`/mail/${mail.id}`} className="text-xs font-semibold text-indigo-600 hover:underline">
                메일 상세 열기 →
              </Link>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden min-w-0">
          <header className="px-4 py-3 border-b border-slate-100 bg-indigo-50/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-800">견적서 (Output)</p>
            <p className="text-sm font-semibold text-slate-900 mt-1">{order.doc_no}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{order.order_date} · {order.partner_name}</p>
          </header>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            <FieldOut label="견적번호" value={order.doc_no} />
            <FieldOut label="견적일" value={order.order_date} />
            <FieldOut label="거래처" value={order.partner_name} />
            <FieldOut label="담당자" value={order.contact_person} />
            <FieldOut label="Vessel" value={order.vessel} />
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">품목 (단가·금액 제외)</p>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">품명</th>
                      <th className="px-2 py-1.5 text-left font-medium">사양</th>
                      <th className="px-2 py-1.5 text-right font-medium">수량</th>
                      <th className="px-2 py-1.5 text-left font-medium">단위</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-4 text-center text-slate-400">품목 없음</td></tr>
                    ) : items.map(it => (
                      <tr key={it.id}>
                        <td className="px-2 py-1.5 text-slate-400">{it.seq}</td>
                        <td className="px-2 py-1.5 text-slate-800">{it.name}</td>
                        <td className="px-2 py-1.5 text-slate-600">{it.spec || '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
                        <td className="px-2 py-1.5">{it.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <Link to={`/orders/${order.id}/edit`} className="text-xs font-semibold text-indigo-600 hover:underline">
              견적서 편집 열기 →
            </Link>
          </div>
        </section>
      </div>

      {!matched && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
          {match?.status === 'unmatched'
            ? '엔진이 15일 후보 안에서 적합한 메일을 찾지 못했습니다.'
            : match?.status === 'failed'
              ? `매칭 실패: ${match.error_message || '오류'}`
              : '아직 매칭을 실행하지 않았습니다. 학습샘플 목록에서 「매칭」을 눌러 주세요.'}
        </div>
      )}
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

function MetaLine({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
      <p className="text-[12px] text-slate-800 break-words">{value || '—'}</p>
    </div>
  );
}

function FieldOut({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
      <p className="text-sm font-medium text-slate-900 break-words mt-0.5">{value || '—'}</p>
    </div>
  );
}
