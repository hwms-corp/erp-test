import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Download, Eye, FileText, Search, Sparkles, X } from 'lucide-react';
import { useMail } from '@/hooks/useMail';
import { usePartners } from '@/hooks/usePartners';
import { useAuth } from '@/hooks/useAuth';
import { PartnerSearchModal } from '@/components/PartnerSearchModal';
import { ExtractionKvTable } from '@/components/ExtractionKvTable';
import { MailHtmlBody } from '@/components/MailHtmlBody';
import { extractionToMaterialLines } from '@/lib/mailMatching';
import {
  collectOcrFilesFromAttachments,
  fetchGmailAttachment,
  formatBytes,
  isPreviewableMime,
} from '@/lib/gmailAttachment';
import type { CanonicalExtraction, MailAttachment, MailMessage, MailProcessStatus, PartnerMatchCandidate } from '@/types/aiMail';
import type { Partner } from '@/types';
import { today } from '@/types';

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

const STATUS_LABEL: Record<MailProcessStatus, string> = {
  received: '수신',
  classifying: '분류중',
  extracting: '추출중',
  review_required: '검토필요',
  ready_auto: '자동후보',
  registered: '견적등록',
  rejected: '비견적',
  failed: '실패',
};

type PreviewState = {
  filename: string;
  mimeType: string;
  url: string;
} | null;

export function MailReviewView() {
  const { id } = useParams();
  const mailId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { fetchMail, fetchAttachments, fetchThreadMails, markMailRead, runAiPipeline, saveExtraction, registerAsDraft, suggestPartners } = useMail();
  const { fetchPartners } = usePartners();

  const [mail, setMail] = useState<MailMessage | null>(null);
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [threadMails, setThreadMails] = useState<
    Pick<MailMessage, 'id' | 'subject' | 'from_addr' | 'received_at' | 'process_status'>[]
  >([]);
  const [extraction, setExtraction] = useState<CanonicalExtraction | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [candidates, setCandidates] = useState<PartnerMatchCandidate[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attBusyId, setAttBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<PreviewState>(null);

  const salesPartners = useMemo(
    () => partners.filter(p => p.type === 'sales' || p.type === 'both'),
    [partners],
  );

  const applyPartnerSuggestions = (ext: CanonicalExtraction, list: Partner[]) => {
    const c = suggestPartners(ext, list);
    setCandidates(c);
    if (c[0]) {
      const hit = list.find(p => p.id === c[0].partner_id) ?? null;
      setSelectedPartner(hit);
    }
  };

  useEffect(() => {
    (async () => {
      const { data } = await fetchMail(mailId);
      setMail(data);
      setExtraction(data?.extraction ?? null);
      if (data && data.is_read === false) {
        const { data: updated } = await markMailRead(mailId);
        if (updated) setMail(updated);
      }
      const { data: atts } = await fetchAttachments(mailId);
      setAttachments(atts ?? []);
      if (data?.gmail_thread_id) {
        const { data: thread } = await fetchThreadMails(data.gmail_thread_id);
        setThreadMails(thread);
      } else {
        setThreadMails([]);
      }
      const { data: partnerList } = await fetchPartners();
      const list = partnerList ?? [];
      setPartners(list);
      if (data?.matched_partner_id) {
        const hit = list.find(p => p.id === data.matched_partner_id) ?? null;
        if (hit) setSelectedPartner(hit);
      } else if (data?.extraction && list.length) {
        applyPartnerSuggestions(data.extraction, list);
      }
    })();
  }, [mailId, fetchMail, fetchAttachments, fetchThreadMails, fetchPartners, markMailRead, suggestPartners]);

  const lines = useMemo(
    () => (extraction ? extractionToMaterialLines(extraction) : []),
    [extraction],
  );

  const threadNav = useMemo(() => {
    if (!mail || threadMails.length < 2) return { prev: null as typeof threadMails[0] | null, next: null as typeof threadMails[0] | null, index: 0, total: threadMails.length };
    const idx = threadMails.findIndex(t => t.id === mail.id);
    return {
      prev: idx > 0 ? threadMails[idx - 1] : null,
      next: idx >= 0 && idx < threadMails.length - 1 ? threadMails[idx + 1] : null,
      index: idx >= 0 ? idx + 1 : 0,
      total: threadMails.length,
    };
  }, [mail, threadMails]);

  const listedAttachments = useMemo(
    () => attachments.filter(a => !(a.content_id && (a.mime_type || '').startsWith('image/'))),
    [attachments],
  );

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const closePreview = () => {
    setPreview(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  const openAttachment = async (att: MailAttachment, mode: 'preview' | 'download') => {
    setAttBusyId(att.id);
    setMsg('');
    try {
      const result = await fetchGmailAttachment(att.id);
      if (!result.ok) {
        setMsg(result.error);
        return;
      }
      if (mode === 'download') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(result.blob);
        a.download = result.filename || att.filename;
        a.click();
        URL.revokeObjectURL(a.href);
        return;
      }
      const url = URL.createObjectURL(result.blob);
      setPreview(prev => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { filename: result.filename || att.filename, mimeType: result.mimeType, url };
      });
    } finally {
      setAttBusyId(null);
    }
  };

  const rerunAi = async () => {
    if (!mail || busy) return;
    const ok = confirm(
      'AI 추출을 다시 실행할까요?\n\n'
      + '· 분류 → 추출을 처음부터 다시 수행합니다.\n'
      + '· 재실행 후에는 반드시 직접 검토해 주세요.\n'
      + '· 견적 자동등록은 실행되지 않습니다.',
    );
    if (!ok) return;

    setBusy(true);
    setMsg('첨부파일 준비 중…');
    try {
      const ocrFiles = await collectOcrFilesFromAttachments(attachments);
      if (ocrFiles.length) {
        setMsg(`첨부 ${ocrFiles.length}개 포함 · 분류 준비 중…`);
      }
      const { data, error, rejected } = await runAiPipeline(mail, {
        files: ocrFiles,
        forceReviewRequired: true,
        onProgress: step => setMsg(step),
      });
      if (error) {
        setMsg(`재실행 실패: ${error.message}`);
        return;
      }
      if (rejected) {
        if (data) setMail(data);
        setExtraction(null);
        setMsg('견적의뢰가 아닌 문서로 분류되었습니다. 상태를 확인해 주세요.');
        return;
      }
      if (data) {
        setMail(data);
        setExtraction(data.extraction);
        const { data: partnerList } = await fetchPartners();
        const list = partnerList ?? [];
        setPartners(list);
        if (data.extraction && list.length) applyPartnerSuggestions(data.extraction, list);
        setMsg('추출 재실행 완료 — 자동등록 없이 검토필요 상태입니다. 아래 결과를 확인해 주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    if (!extraction) return;
    setBusy(true);
    const { data, error } = await saveExtraction(mailId, extraction);
    setBusy(false);
    if (error) setMsg(error.message || '저장 실패');
    else {
      setMail(data);
      setMsg('추출 결과 저장됨');
    }
  };

  const register = async () => {
    if (!mail || !extraction || !user || !selectedPartner) {
      setMsg('거래처를 선택하세요');
      return;
    }
    if (!confirm('검토 내용으로 견적(draft)을 등록할까요?')) return;
    setBusy(true);
    const { data, error } = await registerAsDraft(mail, selectedPartner.id, user.id, {
      order_date: extraction.request.request_date.value || today(),
      contact_person: extraction.request.contact_person.value || extraction.customer.contact_name.value,
      vessel: extraction.request.vessel.value,
      items: lines,
    });
    setBusy(false);
    if (error) setMsg((error as { message?: string }).message || '등록 실패');
    else if (data) {
      setMsg(`견적 등록 완료: ${data.doc_no}`);
      navigate(`/orders/${data.id}/edit`);
    }
  };

  if (!mail) {
    return <div className="p-8 text-slate-400">메일 로딩 중…</div>;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 min-w-0">
      {/* 모바일·태블릿: 세로 / 데스크톱(lg+): 기존 가로 헤더 */}
      <div className="flex flex-col gap-3 min-w-0 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
        <div className="flex items-start gap-2 min-w-0 lg:items-center lg:flex-1">
          <button type="button" onClick={() => navigate('/mail')} className="p-2 -ml-1 text-slate-500 hover:text-slate-800 shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0 overflow-hidden">
            <h2 className="text-lg lg:text-xl font-bold text-slate-900 break-words lg:truncate leading-snug">
              {mail.subject || '(제목 없음)'}
            </h2>
            <p className="text-xs lg:text-sm text-slate-500 break-all lg:truncate mt-0.5">
              {mail.from_addr} · {STATUS_LABEL[mail.process_status] || mail.process_status}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 w-full min-w-0 sm:grid-cols-3 lg:flex lg:w-auto lg:flex-wrap lg:items-center">
          <button
            type="button"
            disabled={busy}
            onClick={() => void rerunAi()}
            title="분류·추출을 다시 실행합니다. 자동등록은 하지 않습니다."
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 min-w-0"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="truncate">{busy ? '재실행 중…' : 'AI분류 재실행'}</span>
          </button>
          <button
            type="button"
            disabled={busy || !extraction}
            onClick={saveEdits}
            className="px-3 py-2 rounded-xl text-sm bg-slate-800 text-white disabled:opacity-50 min-w-0"
          >
            분류 저장
          </button>
          <button
            type="button"
            disabled={busy || !extraction || mail.process_status === 'registered'}
            onClick={register}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 min-w-0"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="truncate">견적 등록</span>
          </button>
        </div>
      </div>

      {msg && <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 break-words">{msg}</div>}
      {mail.status_reason && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 break-words">
          <span className="font-medium">처리 사유:</span> {mail.status_reason}
        </div>
      )}
      {mail.error_message && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2 break-words">
          <span className="font-medium">오류:</span> {mail.error_message}
        </div>
      )}

      {/* 상단: 본문 | KV */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 items-start">
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 min-w-0">
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
            <h3 className="font-semibold text-slate-800">메일 본문</h3>
            {threadNav.total > 1 && (
              <div className="flex items-center gap-1.5 text-xs flex-wrap">
                <button
                  type="button"
                  disabled={!threadNav.prev}
                  onClick={() => threadNav.prev && navigate(`/mail/${threadNav.prev.id}`)}
                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-35"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> 이전 메일
                </button>
                <span className="text-slate-400 tabular-nums px-1">
                  {threadNav.index}/{threadNav.total}
                </span>
                <button
                  type="button"
                  disabled={!threadNav.next}
                  onClick={() => threadNav.next && navigate(`/mail/${threadNav.next.id}`)}
                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-35"
                >
                  이후 메일 <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Gmail HTML 양식 그대로 표시합니다. 답장 인용은 가리고, 같은 스레드는 이전/이후로 이동합니다.
          </p>
          <MailHtmlBody
            bodyHtml={mail.body_html}
            bodyText={mail.body_text}
            snippet={mail.snippet}
            attachments={attachments}
          />
          {listedAttachments.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1.5 flex-wrap">
                <FileText className="w-4 h-4 shrink-0" /> 첨부파일
                <span className="text-xs font-normal text-slate-400">(Gmail 연동)</span>
              </h4>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {listedAttachments.map(a => {
                  const canPreview = isPreviewableMime(a.mime_type, a.filename);
                  const loading = attBusyId === a.id;
                  const missingId = !a.gmail_attachment_id;
                  return (
                    <li key={a.id} className="flex flex-col gap-2 px-3 py-2.5 bg-white text-sm min-w-0 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-slate-800">{a.filename}</div>
                        <div className="text-xs text-slate-400 break-all">
                          {[a.mime_type, formatBytes(a.size_bytes)].filter(Boolean).join(' · ')}
                          {missingId && ' · 재동기화 필요'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canPreview && (
                          <button
                            type="button"
                            disabled={loading || missingId || busy}
                            onClick={() => openAttachment(a, 'preview')}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          >
                            <Eye className="w-3.5 h-3.5" /> 미리보기
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={loading || missingId || busy}
                          onClick={() => openAttachment(a, 'download')}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                        >
                          <Download className="w-3.5 h-3.5" /> 다운
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {extraction ? (
          <ExtractionKvTable
            extraction={extraction}
            mail={mail}
            attachments={attachments}
            className="lg:sticky lg:top-2"
          />
        ) : (
          <section className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-400 min-w-0">
            키·값 매칭 표는 추출 결과가 있으면 여기에 표시됩니다.
          </section>
        )}
      </div>

      {/* 하단: AI 추출 편집 (전체 폭) */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 min-w-0 w-full">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="font-semibold text-slate-800">AI 추출 결과 (편집)</h3>
          {extraction && (
            <span className="text-xs text-slate-500">
              신뢰도 {Math.round(extraction.overall_confidence * 100)}% · {extraction.language}
            </span>
          )}
        </div>

        {!extraction && (
          <p className="text-sm text-slate-400">
            추출 결과가 없습니다. 상단의 <span className="font-medium text-slate-600">AI분류 재실행</span>을 눌러 주세요.
          </p>
        )}

        {extraction && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                <span className="text-slate-500">문서번호 (견적의뢰서)</span>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={extraction.request.document_no?.value || ''}
                  onChange={e => setExtraction({
                    ...extraction,
                    request: {
                      ...extraction.request,
                      document_no: {
                        ...(extraction.request.document_no || {
                          value: null, original_key: null, original_value: null, confidence: 0,
                          source_file: null, source_page: null, evidence_text: null, language: null,
                        }),
                        value: e.target.value,
                        confidence: 1,
                      },
                    },
                  })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500">거래처명</span>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={extraction.customer.name.value || ''}
                  onChange={e => setExtraction({
                    ...extraction,
                    customer: {
                      ...extraction.customer,
                      name: { ...extraction.customer.name, value: e.target.value, confidence: 1 },
                    },
                  })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500">담당</span>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={extraction.request.contact_person.value || ''}
                  onChange={e => setExtraction({
                    ...extraction,
                    request: {
                      ...extraction.request,
                      contact_person: { ...extraction.request.contact_person, value: e.target.value, confidence: 1 },
                    },
                  })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500">선명</span>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={extraction.request.vessel.value || ''}
                  onChange={e => setExtraction({
                    ...extraction,
                    request: {
                      ...extraction.request,
                      vessel: { ...extraction.request.vessel, value: e.target.value, confidence: 1 },
                    },
                  })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-500">납기</span>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  value={extraction.request.delivery_date.value || ''}
                  onChange={e => setExtraction({
                    ...extraction,
                    request: {
                      ...extraction.request,
                      delivery_date: { ...extraction.request.delivery_date, value: e.target.value, confidence: 1 },
                    },
                  })}
                />
              </label>
            </div>

            <div>
              <div className="text-sm font-medium text-slate-700 mb-2">품목</div>
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-sm min-w-[420px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">품명</th>
                      <th className="px-3 py-2 text-left">사양</th>
                      <th className="px-3 py-2 text-right">수량</th>
                      <th className="px-3 py-2 text-left">단위</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{l.name}</td>
                        <td className="px-3 py-2 text-slate-600">{l.spec}</td>
                        <td className="px-3 py-2 text-right">{l.qty}</td>
                        <td className="px-3 py-2">{l.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2 max-w-xl">
              <div className="text-sm font-medium text-slate-700">거래처 *</div>
              {candidates.length > 0 ? (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5 break-words">
                  AI 추천: {candidates.slice(0, 3).map(c =>
                    `${c.partner_name} (${Math.round(c.score * 100)}%)`
                  ).join(' · ')}
                </p>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                  자동 매칭 후보 없음 — 거래처 검색으로 직접 선택하세요.
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowPartnerModal(true)}
                className={`${inp} text-left flex items-center justify-between`}
              >
                <span className={selectedPartner ? 'text-slate-900 font-medium' : 'text-slate-400'}>
                  {selectedPartner ? selectedPartner.name : '거래처 검색...'}
                </span>
                <Search className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
              {selectedPartner && (
                <div className="bg-slate-50 rounded-xl p-3 text-sm text-slate-600 space-y-1">
                  <p><span className="text-slate-400">사업자번호:</span> {selectedPartner.biz_no}</p>
                  <p><span className="text-slate-400">대표자:</span> {selectedPartner.rep}</p>
                  {selectedPartner.addr && (
                    <p className="break-words"><span className="text-slate-400">주소:</span> {selectedPartner.addr}</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {showPartnerModal && (
        <PartnerSearchModal
          partners={salesPartners}
          title="영업 거래처 검색"
          onSelect={p => setSelectedPartner(p)}
          onClose={() => setShowPartnerModal(false)}
        />
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closePreview}>
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h3 className="font-medium text-slate-800 truncate">{preview.filename}</h3>
              <button
                type="button"
                onClick={closePreview}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                aria-label="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-slate-50 p-2 overflow-auto">
              {preview.mimeType.startsWith('image/') ? (
                <img src={preview.url} alt={preview.filename} className="max-w-full max-h-[75vh] mx-auto object-contain" />
              ) : preview.mimeType === 'application/pdf' || preview.filename.toLowerCase().endsWith('.pdf') ? (
                <iframe title={preview.filename} src={preview.url} className="w-full h-[75vh] rounded-lg bg-white" />
              ) : (
                <iframe title={preview.filename} src={preview.url} className="w-full h-[75vh] rounded-lg bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
