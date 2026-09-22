import { useEffect, useMemo, useRef, useState } from 'react';
import type { MailAttachment } from '@/types/aiMail';
import { blobToBase64, fetchGmailAttachment } from '@/lib/gmailAttachment';
import {
  displayMailBody,
  extractCidRefs,
  plainTextToHtml,
  rewriteCidUrls,
  sanitizeMailHtml,
  stripQuotedReplyHtml,
  wrapMailHtmlDocument,
} from '@/lib/mailBody';

type Props = {
  bodyHtml: string | null | undefined;
  bodyText: string | null | undefined;
  snippet: string | null | undefined;
  attachments: MailAttachment[];
};

function normalizeCid(cid: string): string {
  return cid.replace(/^<|>$/g, '').trim().toLowerCase();
}

export function MailHtmlBody({ bodyHtml, bodyText, snippet, attachments }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [mode, setMode] = useState<'html' | 'text'>('html');
  const [loadingHtml, setLoadingHtml] = useState(false);

  const plainFallback = useMemo(
    () => displayMailBody({ body_text: bodyText, snippet }),
    [bodyText, snippet],
  );

  const hasStoredHtml = !!(bodyHtml && bodyHtml.trim());

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoadingHtml(true);

      let raw = stripQuotedReplyHtml(bodyHtml || '');
      // 인용 제거가 과도하면 원본 HTML 사용
      if (!raw && bodyHtml?.trim()) raw = bodyHtml.trim();

      let fromHtml = !!raw;
      if (!raw) {
        raw = plainTextToHtml(plainFallback);
        fromHtml = false;
      }

      let html = sanitizeMailHtml(raw);
      const cids = extractCidRefs(html);
      if (cids.length && attachments.length) {
        const byCid = new Map<string, MailAttachment>();
        for (const a of attachments) {
          if (!a.content_id) continue;
          byCid.set(normalizeCid(a.content_id), a);
        }

        const cidToUrl: Record<string, string> = {};
        await Promise.all(
          cids.map(async cid => {
            const att = byCid.get(normalizeCid(cid));
            if (!att?.gmail_attachment_id) return;
            const result = await fetchGmailAttachment(att.id);
            if (!result.ok) return;
            const b64 = await blobToBase64(result.blob);
            const mime = result.mimeType || att.mime_type || 'application/octet-stream';
            const dataUrl = `data:${mime};base64,${b64}`;
            cidToUrl[cid] = dataUrl;
            cidToUrl[normalizeCid(cid)] = dataUrl;
          }),
        );
        html = rewriteCidUrls(html, cidToUrl);
      }

      if (cancelled) return;
      setMode(fromHtml ? 'html' : 'text');
      setSrcDoc(wrapMailHtmlDocument(html));
      setLoadingHtml(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bodyHtml, bodyText, snippet, attachments, plainFallback]);

  const resizeIframe = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;
      const h = Math.min(Math.max(doc.body.scrollHeight + 24, 180), 900);
      iframe.style.height = `${h}px`;
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {mode === 'html' ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 font-medium">
            HTML 원문 표시
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-100 px-2 py-0.5 font-medium">
            텍스트만 (HTML 없음)
          </span>
        )}
        {!hasStoredHtml && (
          <span className="text-slate-400">이 메일은 HTML이 저장되지 않았습니다. 새로 수신되는 메일부터 양식이 유지됩니다.</span>
        )}
        {loadingHtml && <span className="text-slate-400">불러오는 중…</span>}
      </div>
      <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden min-w-0">
        {srcDoc ? (
          <iframe
            ref={iframeRef}
            title="메일 본문"
            sandbox="allow-same-origin allow-popups"
            srcDoc={srcDoc}
            onLoad={resizeIframe}
            className="w-full border-0 bg-white block"
            style={{ minHeight: 220 }}
          />
        ) : (
          <div className="px-3 py-8 text-center text-sm text-slate-400">본문 준비 중…</div>
        )}
      </div>
    </div>
  );
}
