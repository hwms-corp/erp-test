import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Forward,
  Reply,
  Search,
  Sparkles,
  Trash2,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { useMail } from '@/hooks/useMail';
import { usePartners } from '@/hooks/usePartners';
import { useAuth } from '@/hooks/useAuth';
import { PartnerSearchModal } from '@/components/PartnerSearchModal';
import { MaterialEditor } from '@/components/MaterialEditor';
import { ExtractionKvTable } from '@/components/ExtractionKvTable';
import { MailHtmlBody } from '@/components/MailHtmlBody';
import { AttachmentPreviewModal } from '@/components/AttachmentPreviewModal';
import { MailComposeModal, type ComposeDraft } from '@/components/MailComposeModal';
import {
  applyOrderFormToExtraction,
  extractionToMaterialLines,
} from '@/lib/mailMatching';
import {
  collectOcrFilesFromAttachments,
  fetchGmailAttachment,
  formatBytes,
  isPreviewableMime,
} from '@/lib/gmailAttachment';
import { displayMailBody } from '@/lib/mailBody';
import { formatReceivedAtKst } from '@/lib/mailTime';
import type { CanonicalExtraction, MailAttachment, MailMessage, MailProcessStatus, PartnerMatchCandidate } from '@/types/aiMail';
import type { MaterialLine, Partner } from '@/types';
import { emptyMaterialLine, fmtW, today } from '@/types';

function extractEmail(addr: string | null | undefined): string {
  if (!addr) return '';
  const m = addr.match(/<([^>]+)>/);
  return (m?.[1] || addr).trim();
}

function withRePrefix(subject: string | null | undefined): string {
  const s = (subject || '').trim() || '(제목 없음)';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function withFwdPrefix(subject: string | null | undefined): string {
  const s = (subject || '').trim() || '(제목 없음)';
  return /^(fwd|fw):/i.test(s) ? s : `Fwd: ${s}`;
}

const inp = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

const STATUS_LABEL: Record<MailProcessStatus, string> = {
  received: '수신(미분류)',
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
  blob: Blob;
} | null;

function hydrateFormFromExtraction(ext: CanonicalExtraction | null | undefined) {
  if (!ext) {
    return {
      docNo: '',
      orderDate: today(),
      contactPerson: '',
      vessel: '',
      deliveryDate: '',
      customerName: '',
      lines: [emptyMaterialLine()] as MaterialLine[],
    };
  }
  const mapped = extractionToMaterialLines(ext);
  return {
    docNo: String(ext.request.document_no?.value || ''),
    orderDate: String(ext.request.request_date?.value || today()),
    contactPerson: String(
      ext.request.contact_person?.value
      || ext.customer.contact_name?.value
      || '',
    ),
    vessel: String(ext.request.vessel?.value || ''),
    deliveryDate: String(ext.request.delivery_date?.value || ''),
    customerName: String(ext.customer.name?.value || ''),
    lines: mapped.length ? mapped : [emptyMaterialLine()],
  };
}

export function MailReviewView() {
  const { id } = useParams();
  const mailId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { fetchMail, fetchAttachments, fetchThreadMails, markMailRead, runAiPipeline, saveExtraction, registerAsDraft, suggestPartners, softDeleteMails, restoreMails } = useMail();
  const { fetchPartners } = usePartners();

  const [mail, setMail] = useState<MailMessage | null>(null);
  const [mailLoadDone, setMailLoadDone] = useState(false);
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [threadMails, setThreadMails] = useState<
    Pick<MailMessage, 'id' | 'subject' | 'from_addr' | 'received_at' | 'process_status'>[]
  >([]);
  const [extraction, setExtraction] = useState<CanonicalExtraction | null>(null);
  const [docNo, setDocNo] = useState('');
  const [orderDate, setOrderDate] = useState(today);
  const [contactPerson, setContactPerson] = useState('');
  const [vessel, setVessel] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [lines, setLines] = useState<MaterialLine[]>([emptyMaterialLine()]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [candidates, setCandidates] = useState<PartnerMatchCandidate[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attBusyId, setAttBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<PreviewState>(null);
  const [composeDraft, setComposeDraft] = useState<ComposeDraft | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const salesPartners = useMemo(
    () => partners.filter(p => p.type === 'sales' || p.type === 'both'),
    [partners],
  );

  const supplyAmount = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const taxAmount = Math.floor(supplyAmount * 0.1);
  const totalAmount = supplyAmount + taxAmount;

  const applyExtractionToForm = (ext: CanonicalExtraction | null | undefined) => {
    const h = hydrateFormFromExtraction(ext);
    setDocNo(h.docNo);
    setOrderDate(h.orderDate);
    setContactPerson(h.contactPerson);
    setVessel(h.vessel);
    setDeliveryDate(h.deliveryDate);
    setCustomerName(h.customerName);
    setLines(h.lines);
  };

  const buildExtractionFromForm = (base: CanonicalExtraction): CanonicalExtraction =>
    applyOrderFormToExtraction(base, {
      docNo,
      orderDate,
      contactPerson,
      vessel,
      customerName,
      deliveryDate,
      lines,
    });

  const applyPartnerSuggestions = (ext: CanonicalExtraction, list: Partner[]) => {
    const c = suggestPartners(ext, list);
    setCandidates(c);
    if (c[0]) {
      const hit = list.find(p => p.id === c[0].partner_id) ?? null;
      setSelectedPartner(hit);
    }
  };

  useEffect(() => {
    setMailLoadDone(false);
    setMail(null);
    (async () => {
      const { data } = await fetchMail(mailId);
      setMail(data);
      setExtraction(data?.extraction ?? null);
      applyExtractionToForm(data?.extraction);
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
      setMailLoadDone(true);
    })();
  }, [mailId, fetchMail, fetchAttachments, fetchThreadMails, fetchPartners, markMailRead, suggestPartners]);

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
        return {
          filename: result.filename || att.filename,
          mimeType: result.mimeType,
          url,
          blob: result.blob,
        };
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
        applyExtractionToForm(null);
        setMsg('견적의뢰가 아닌 문서로 분류되었습니다. 상태를 확인해 주세요.');
        return;
      }
      if (data) {
        setMail(data);
        setExtraction(data.extraction);
        applyExtractionToForm(data.extraction);
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
    if (!docNo.trim()) {
      setMsg('견적번호를 입력해주세요.');
      return;
    }
    if (!lines.some(l => l.name.trim())) {
      setMsg('최소 1개 이상의 품목을 입력해주세요.');
      return;
    }
    setBusy(true);
    const next = buildExtractionFromForm(extraction);
    const { data, error } = await saveExtraction(mailId, next);
    setBusy(false);
    if (error) setMsg(error.message || '저장 실패');
    else {
      setMail(data);
      setExtraction(next);
      setMsg('추출 결과 저장됨 (견적서 작성 양식 기준)');
    }
  };

  const register = async () => {
    if (!mail || !extraction || !user || !selectedPartner) {
      setMsg('거래처를 선택하세요');
      return;
    }
    if (!docNo.trim()) {
      setMsg('견적번호를 입력해주세요.');
      return;
    }
    const validLines = lines.filter(l => l.name.trim());
    if (validLines.length === 0) {
      setMsg('최소 1개 이상의 품목을 입력해주세요.');
      return;
    }
    if (!confirm('검토 내용으로 견적(draft)을 등록할까요?')) return;
    setBusy(true);
    const next = buildExtractionFromForm(extraction);
    // 최신 폼 값을 extraction에도 반영 후 등록
    await saveExtraction(mailId, next);
    setExtraction(next);
    const { data, error } = await registerAsDraft(
      { ...mail, extraction: next },
      selectedPartner.id,
      user.id,
      {
        doc_no: docNo.trim(),
        order_date: orderDate || today(),
        contact_person: contactPerson.trim() || null,
        vessel: vessel.trim() || null,
        items: validLines,
      },
    );
    setBusy(false);
    if (error) setMsg((error as { message?: string }).message || '등록 실패');
    else if (data) {
      setMsg(`견적 등록 완료: ${data.doc_no}`);
      navigate(`/orders/${data.id}/edit`);
    }
  };

  if (!mailLoadDone) {
    return <div className="p-8 text-slate-400">메일 로딩 중…</div>;
  }

  if (!mail) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-slate-600">메일을 찾을 수 없습니다.</p>
        <button
          type="button"
          onClick={() => navigate('/mail')}
          className="text-sm text-indigo-600 hover:underline"
        >
          메일함으로 돌아가기
        </button>
      </div>
    );
  }

  const inTrash = !!mail.deleted_at;

  const openReply = () => {
    const quoted = displayMailBody(mail);
    setComposeDraft({
      mode: 'reply',
      to: extractEmail(mail.from_addr),
      subject: withRePrefix(mail.subject),
      body: `\n\n----- Original Message -----\n보낸사람: ${mail.from_addr || ''}\n제목: ${mail.subject || ''}\n\n${quoted === '(본문 없음)' ? '' : quoted}`,
      threadId: mail.gmail_thread_id,
      inReplyTo: mail.gmail_message_id ? `<${mail.gmail_message_id}@gmail.com>` : undefined,
      references: mail.gmail_message_id ? `<${mail.gmail_message_id}@gmail.com>` : undefined,
    });
    setComposeOpen(true);
  };

  const openForward = () => {
    const quoted = displayMailBody(mail);
    setComposeDraft({
      mode: 'forward',
      to: '',
      subject: withFwdPrefix(mail.subject),
      body:
        `\n\n---------- Forwarded message ---------\n`
        + `From: ${mail.from_addr || ''}\n`
        + `Date: ${mail.received_at || ''}\n`
        + `Subject: ${mail.subject || ''}\n`
        + `To: ${mail.to_addr || ''}\n\n`
        + `${quoted === '(본문 없음)' ? '' : quoted}`,
      threadId: null,
    });
    setComposeOpen(true);
  };

  const deleteMail = async () => {
    if (!confirm('이 메일을 휴지통으로 이동할까요?\nGmail 휴지통과 함께 맞춰집니다.')) return;
    setBusy(true);
    const { error } = await softDeleteMails([mail.id]);
    setBusy(false);
    if (error) {
      setMsg(`삭제 실패: ${error.message}`);
      return;
    }
    navigate('/mail?box=trash');
  };

  const restoreMail = async () => {
    if (!confirm('이 메일을 휴지통에서 복원할까요?\nGmail에서도 함께 복원됩니다.')) return;
    setBusy(true);
    const { error } = await restoreMails([mail.id]);
    setBusy(false);
    if (error) {
      setMsg(`복원 실패: ${error.message}`);
      return;
    }
    navigate('/mail?box=latest');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 min-w-0">
      {composeOpen && (
        <MailComposeModal
          open
          draft={composeDraft}
          onClose={() => {
            setComposeOpen(false);
            setComposeDraft(null);
          }}
          onSent={(info) => {
            const q = new URLSearchParams({
              box: 'sent',
              notice: 'sent',
            });
            if (info?.to) q.set('to', info.to);
            navigate(`/mail?${q.toString()}`);
          }}
        />
      )}
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
            <p
              className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-1 text-[12px] sm:text-sm font-semibold text-indigo-800 tabular-nums"
              title="수신시각 (한국시간)"
            >
              <Clock className="w-3.5 h-3.5 shrink-0 text-indigo-500" aria-hidden />
              <span className="whitespace-nowrap">{formatReceivedAtKst(mail.received_at)}</span>
              <span className="text-[10px] font-medium text-indigo-500">KST</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 w-full min-w-0 sm:grid-cols-3 lg:flex lg:w-auto lg:flex-wrap lg:items-center">
          <button
            type="button"
            disabled={busy}
            onClick={openReply}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Reply className="w-4 h-4 shrink-0" />
            답장
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={openForward}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Forward className="w-4 h-4 shrink-0" />
            전달
          </button>
          {inTrash ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void restoreMail()}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              복원
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void deleteMail()}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              삭제
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void rerunAi()}
            title="분류·추출을 다시 실행합니다. 자동등록은 하지 않습니다."
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 min-w-0 col-span-2 sm:col-span-1"
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

      {/* 하단: 견적서 작성과 동일한 입력 양식 */}
      <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-6 min-w-0 w-full">
        <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="font-semibold text-slate-800">AI 추출 결과 (편집) · 견적서 작성 양식</h3>
          {extraction && (
            <span className="text-xs text-slate-500">
              신뢰도 {Math.round(extraction.overall_confidence * 100)}% · {extraction.language}
            </span>
          )}
        </div>

        {!extraction && (
          <p className="text-sm text-slate-400">
            추출 결과가 없습니다. 상단의 <span className="font-medium text-slate-600">AI분류 재실행</span>을 눌러 주세요.
            재실행 후 아래에 견적서 작성과 같은 입력란이 채워집니다.
          </p>
        )}

        {extraction && (
          <>
            {/* 기본 정보 — OrderFormView 와 동일 */}
            <div className="space-y-4">
              <h4 className="font-semibold text-slate-900">기본 정보</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">견적번호 *</label>
                  <input
                    type="text"
                    className={inp}
                    value={docNo}
                    onChange={e => setDocNo(e.target.value)}
                    placeholder="견적번호 입력"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">견적일자 *</label>
                  <input
                    type="date"
                    className={inp}
                    value={orderDate}
                    onChange={e => setOrderDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">거래처 *</label>
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
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">담당자</label>
                  <input
                    type="text"
                    className={inp}
                    value={contactPerson}
                    onChange={e => setContactPerson(e.target.value)}
                    placeholder="거래처 담당자명"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Vessel</label>
                  <input
                    type="text"
                    className={inp}
                    value={vessel}
                    onChange={e => setVessel(e.target.value)}
                    placeholder="선명 (Vessel)"
                  />
                </div>
              </div>

              {/* 메일 전용 참고 필드 (견적 DB 컬럼 없음) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    AI 거래처명 <span className="text-slate-400 font-normal">(매칭 참고)</span>
                  </label>
                  <input
                    type="text"
                    className={inp}
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    placeholder="메일에서 추출된 거래처명"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    납기 <span className="text-slate-400 font-normal">(참고)</span>
                  </label>
                  <input
                    type="text"
                    className={inp}
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                </div>
              </div>

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

            {/* 품목 정보 — MaterialEditor (견적서 작성과 동일) */}
            <div className="space-y-4 border-t border-slate-100 pt-6">
              <h4 className="font-semibold text-slate-900">품목 정보</h4>
              <p className="text-xs text-slate-500">
                AI가 분류한 품목이 아래에 채워집니다. 견적서 작성과 같이 행을 추가·수정·삭제할 수 있습니다.
              </p>
              <MaterialEditor lines={lines} onChange={setLines} />
              <div className="flex justify-end">
                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm min-w-[240px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500">공급가액</span>
                    <span className="text-slate-900">{fmtW(supplyAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">세액 (10%)</span>
                    <span className="text-slate-900">{fmtW(taxAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
                    <span className="text-slate-700">합계</span>
                    <span className="text-indigo-600">{fmtW(totalAmount)}</span>
                  </div>
                </div>
              </div>
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
        <AttachmentPreviewModal
          filename={preview.filename}
          mimeType={preview.mimeType}
          blob={preview.blob}
          url={preview.url}
          onClose={closePreview}
          onDownload={() => {
            const a = document.createElement('a');
            a.href = preview.url;
            a.download = preview.filename;
            a.click();
          }}
        />
      )}
    </motion.div>
  );
}
