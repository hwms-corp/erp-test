/**
 * 답장/전달에 붙은 이전 메일 인용부를 본문에서 분리합니다.
 * (수신 메일 자체 내용만 남김)
 */

const QUOTE_START_PATTERNS: RegExp[] = [
  /^On .+ wrote:\s*$/i,
  /^.*님이 작성한 내용:\s*$/,
  /^\d{4}년\s*\d{1,2}월\s*\d{1,2}일.+(작성|씀)\s*:\s*$/,
  /^-----Original Message-----/i,
  /^---------- Forwarded message ---------/i,
  /^Begin forwarded message:\s*$/i,
  /^________________________________\s*$/,
  /^From:\s.+/i,
  /^보낸 사람\s*:\s*.+$/,
  /^____+$/,
];

function isQuoteHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return QUOTE_START_PATTERNS.some(p => p.test(t));
}

/** plain text: 이번 메일 본문만 */
export function stripQuotedReplyText(text: string | null | undefined): string {
  if (!text) return '';
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  let cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isQuoteHeaderLine(lines[i])) {
      // "From:" alone at the very top might be headers — only cut after we've seen real body
      if (i === 0 && /^From:\s/i.test(lines[i].trim())) continue;
      cutAt = i;
      break;
    }
  }

  // 인용 헤더가 없으면, 본문 중간의 `>` 인용 블록 시작을 탐색
  if (cutAt < 0) {
    let seenContent = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t && !t.startsWith('>')) seenContent = true;
      if (seenContent && t.startsWith('>') && i > 0) {
        // 직전 빈 줄이면 인용 시작으로 간주
        if (!lines[i - 1].trim() || isQuoteHeaderLine(lines[i - 1])) {
          cutAt = !lines[i - 1].trim() ? i - 1 : i;
          break;
        }
      }
    }
  }

  const kept = cutAt >= 0 ? lines.slice(0, cutAt) : lines;
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** HTML: Gmail/Outlook 인용 블록만 제거 — 본문 표·스타일은 유지 */
export function stripQuotedReplyHtml(html: string | null | undefined): string {
  if (!html) return '';
  let out = html;
  // Gmail 인용
  out = out.replace(/<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<div[^>]*class="[^"]*gmail_extra[^"]*"[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<div[^>]*class="[^"]*gmail_attr[^"]*"[^>]*>[\s\S]*$/i, '');
  // Outlook / Apple Mail 흔한 인용
  out = out.replace(/<div[^>]*id="?appendonsend"?[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<div[^>]*class="[^"]*OutlookMessageHeader[^"]*"[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<hr[^>]*id="?reply-insert[^>]*>[\s\S]*$/i, '');
  // blockquote 전체 삭제는 하지 않음(본문 레이아웃 파괴) — gmail_quote 안의 것만 이미 제거됨
  out = out.replace(/<!--\s*Previous message[\s\S]*$/i, '');
  return out.trim();
}

export function displayMailBody(mail: {
  body_text?: string | null;
  snippet?: string | null;
}): string {
  const stripped = stripQuotedReplyText(mail.body_text || '');
  if (stripped) return stripped;
  return (mail.snippet || '').trim() || '(본문 없음)';
}

/** 메일 HTML XSS 완화 (script/이벤트 제거, 표·이미지 태그 유지) */
export function sanitizeMailHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocked = new Set([
    'script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'svg', 'math',
  ]);

  const scrub = (root: Element) => {
    for (const el of [...root.querySelectorAll('*')]) {
      const tag = el.tagName.toLowerCase();
      if (blocked.has(tag)) {
        el.remove();
        continue;
      }
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const val = attr.value || '';
        if (name.startsWith('on') || name === 'srcdoc') {
          el.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(val)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style' && /expression\s*\(|javascript:/i.test(val)) {
          el.removeAttribute(attr.name);
        }
      }
    }
  };

  scrub(doc.body);
  return doc.body.innerHTML;
}

/** iframe srcDoc용 문서 래핑 — Gmail 표/이미지/인라인 스타일 유지 */
export function wrapMailHtmlDocument(bodyInnerHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base target="_blank" rel="noopener" />
<style>
  html, body { margin: 0; padding: 8px; background: #fff; }
  body {
    font-family: "Malgun Gothic", "Apple SD Gothic Neo", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #222;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100% !important; height: auto !important; }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { word-break: break-word; }
  a { color: #1a73e8; }
  pre, code { white-space: pre-wrap; word-break: break-word; }
</style>
</head><body>${bodyInnerHtml}</body></html>`;
}

/** 텍스트만 있을 때 최소한의 HTML 표시 */
export function plainTextToHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="white-space:pre-wrap;font-family:inherit">${esc}</div>`;
}

export function extractCidRefs(html: string): string[] {
  const found = new Set<string>();
  const re = /(?:src|href)\s*=\s*["']cid:([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    found.add(m[1].replace(/^<|>$/g, '').trim());
  }
  return [...found];
}

export function rewriteCidUrls(html: string, cidToUrl: Record<string, string>): string {
  return html.replace(/(src|href)\s*=\s*["']cid:([^"']+)["']/gi, (full, attr, rawCid) => {
    const key = String(rawCid).replace(/^<|>$/g, '').trim();
    const url = cidToUrl[key] || cidToUrl[key.toLowerCase()];
    if (!url) return full;
    return `${attr}="${url}"`;
  });
}
