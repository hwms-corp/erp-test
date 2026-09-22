import { useEffect, useMemo, useRef, useState } from 'react';
import type { MailAttachment } from '@/types/aiMail';
import { blobToBase64, fetchGmailAttachment } from '@/lib/gmailAttachment';
import {
  displayMailBody,
  extractCidRefs,
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
  const [loadingHtml, setLoadingHtml] = useState(false);

  const plainFallback = useMemo(
    () => displayMailBody({ body_text: bodyText, snippet }),
    [bodyText, snippet],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const raw = stripQuotedReplyHtml(bodyHtml || '');
      if (!raw) {
        setSrcDoc(null);
        setLoadingHtml(false);
        return;
      }

      setLoadingHtml(true);

      let html = sanitizeMailHtml(raw);
      const cids = extractCidRefs(html);
      if (cids.length) {
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
      setSrcDoc(wrapMailHtmlDocument(html));
      setLoadingHtml(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bodyHtml, attachments]);

  const resizeIframe = () => {
    const iframe = iframeRef.current;
    try {
      const doc = iframe?.contentDocument;
      if (!doc?.body) return;
      const h = Math.min(Math.max(doc.body.scrollHeight + 16, 160), 720);
      iframe.style.height = `${h}px`;
    } catch {
      /* ignore */
    }
  };

  if (!bodyHtml?.trim() && !srcDoc) {
    return (
      <pre className="text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3 max-h-[480px] overflow-auto">
        {plainFallback}
      </pre>
    );
  }

  if (!srcDoc) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">
        {loadingHtml ? 'HTML 본문 불러오는 중…' : plainFallback}
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden">
      {loadingHtml && (
        <div className="absolute inset-x-0 top-0 z-10 px-3 py-1.5 text-[11px] text-slate-500 bg-slate-50/90">
          본문·인라인 이미지 불러오는 중…
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="메일 본문"
        sandbox="allow-same-origin allow-popups"
        srcDoc={srcDoc}
        onLoad={resizeIframe}
        className="w-full border-0 bg-white"
        style={{ minHeight: 200 }}
      />
    </div>
  );
}
