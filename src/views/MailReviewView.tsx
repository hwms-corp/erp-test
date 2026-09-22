import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, Download, Eye, FileText, Search, Sparkles, X } from 'lucide-react';
import { useMail } from '@/hooks/useMail';
import { usePartners } from '@/hooks/usePartners';
import { useAuth } from '@/hooks/useAuth';
import { PartnerSearchModal } from '@/components/PartnerSearchModal';
import { extractionToMaterialLines } from '@/lib/mailMatching';
import {
  fetchGmailAttachment,
  formatBytes,
  isPreviewableMime,
} from '@/lib/gmailAttachment';
import type { CanonicalExtraction, MailAttachment, MailMessage, PartnerMatchCandidate } from '@/types/aiMail';
import type { Partner } from '@/types';
import { today } from '@/types';

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

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
  const { fetchMail, fetchAttachments, markMailRead, runAiPipeline, saveExtraction, registerAsDraft, suggestPartners } = useMail();
  const { fetchPartners } = usePartners();

  const [mail, setMail] = useState<MailMessage | null>(null);
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
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
  }, [mailId, fetchMail, fetchAttachments, fetchPartners, markMailRead, suggestPartners]);

  const lines = useMemo(
    () => (extraction ? extractionToMaterialLines(extraction) : []),
    [extraction],
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
    if (!mail) return;
    setBusy(true);
    setMsg('');
    const { data, error } = await runAiPipeline(mail);
    setBusy(false);
    if (error) setMsg(error.message);
    else if (data) {
      setMail(data);
      setExtraction(data.extraction);
      const { data: partnerList } = await fetchPartners();
      const list = partnerList ?? [];
      setPartners(list);
      if (data.extraction && list.length) applyPartnerSuggestions(data.extraction, list);
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
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate('/mail')} className="p-2 text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-slate-900 truncate">{mail.subject || '(제목 없음)'}</h2>
          <p className="text-sm text-slate-500">{mail.from_addr} · {mail.process_status}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={rerunAi}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" /> AI 재실행
        </button>
        <button
          type="button"
          disabled={busy || !extraction}
          onClick={saveEdits}
          className="px-3 py-2 rounded-xl text-sm bg-slate-800 text-white disabled:opacity-50"
        >
          추출 저장
        </button>
        <button
          type="button"
          disabled={busy || !extraction || mail.process_status === 'registered'}
          onClick={register}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" /> 견적 등록
        </button>
      </div>

      {msg && <div className="text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">{msg}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <h3 className="font-semibold text-slate-800">원문</h3>
          <pre className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3 max-h-[480px] overflow-auto">
            {mail.body_text || mail.snippet || '(본문 없음)'}
          </pre>
          {attachments.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <FileText className="w-4 h-4" /> 첨부파일
                <span className="text-xs font-normal text-slate-400">(Gmail 연동 · Storage 미사용)</span>
              </h4>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {attachments.map(a => {
                  const canPreview = isPreviewableMime(a.mime_type, a.filename);
                  const loading = attBusyId === a.id;
                  const missingId = !a.gmail_attachment_id;
                  return (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-2.5 bg-white text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-slate-800">{a.filename}</div>
                        <div className="text-xs text-slate-400">
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
                            title={missingId ? 'gmail_attachment_id 없음 — 메일 재수신 후 가능' : '미리보기'}
                          >
                            <Eye className="w-3.5 h-3.5" /> 미리보기
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={loading || missingId || busy}
                          onClick={() => openAttachment(a, 'download')}
                          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                          title={missingId ? 'gmail_attachment_id 없음 — 메일 재수신 후 가능' : '다운로드'}
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

        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800">AI 추출 결과</h3>
            {extraction && (
              <span className="text-xs text-slate-500">
                confidence {Math.round(extraction.overall_confidence * 100)}% · {extraction.language}
              </span>
            )}
          </div>

          {!extraction && <p className="text-sm text-slate-400">추출 결과 없음. AI 재실행을 눌러주세요.</p>}

          {extraction && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="space-y-1 col-span-2">
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
                  <table className="w-full text-sm">
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

              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">거래처 *</div>
                {candidates.length > 0 ? (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5">
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
                      <p><span className="text-slate-400">주소:</span> {selectedPartner.addr}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

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
