import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plug, XCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { checkAiDocHealth, getAiDocConfig } from '@/lib/aiDocClient';
import { checkOrderMailMatchHealth, getOrderMailMatchConfig } from '@/lib/orderMailMatchClient';

type Props = {
  initialUrl: string;
  initialKey: string;
  initialMatchUrl?: string;
  initialMatchKey?: string;
  canEdit: boolean;
  busy?: boolean;
  onClose: () => void;
  onSave: (payload: {
    url: string;
    key: string;
    matchUrl: string;
    matchKey: string;
  }) => Promise<string | null>;
};

export function AiConnectionModal({
  initialUrl,
  initialKey,
  initialMatchUrl = '',
  initialMatchKey = '',
  canEdit,
  busy,
  onClose,
  onSave,
}: Props) {
  const envFallback = getAiDocConfig();
  const matchFallback = getOrderMailMatchConfig();
  const [url, setUrl] = useState(initialUrl || envFallback.apiBaseUrl);
  const [key, setKey] = useState(initialKey || envFallback.apiKey);
  const [matchUrl, setMatchUrl] = useState(initialMatchUrl || matchFallback.apiBaseUrl);
  const [matchKey, setMatchKey] = useState(initialMatchKey || matchFallback.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [showMatchKey, setShowMatchKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setUrl(initialUrl || envFallback.apiBaseUrl);
    setKey(initialKey || envFallback.apiKey);
    setMatchUrl(initialMatchUrl || matchFallback.apiBaseUrl);
    setMatchKey(initialMatchKey || matchFallback.apiKey);
  }, [
    initialUrl,
    initialKey,
    initialMatchUrl,
    initialMatchKey,
    envFallback.apiBaseUrl,
    envFallback.apiKey,
    matchFallback.apiBaseUrl,
    matchFallback.apiKey,
  ]);

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    setTestOk(null);
    const r = await checkAiDocHealth({ apiBaseUrl: url, apiKey: key });
    const m = await checkOrderMailMatchHealth({ apiBaseUrl: matchUrl, apiKey: matchKey });
    setTesting(false);
    const classifyOk = r.status === 'online';
    const parts = [
      classifyOk
        ? '분류 API OK'
        : r.status === 'unauthorized'
          ? '분류 API Key 오류'
          : `분류 API 실패(${r.detail || r.status})`,
      m.ok ? `매칭 엔진 OK (${m.detail})` : `매칭 엔진: ${m.detail}`,
    ];
    setTestOk(classifyOk);
    setTestMsg(parts.join(' · '));
  };

  const save = async () => {
    setErr(null);
    if (!url.trim()) {
      setErr('분류 API URL을 입력하세요');
      return;
    }
    if (!key.trim()) {
      setErr('분류 API Key를 입력하세요');
      return;
    }
    if (!matchUrl.trim()) {
      setErr('학습매칭(order-mail-match) API URL을 입력하세요');
      return;
    }
    if (!matchKey.trim()) {
      setErr('학습매칭(order-mail-match) API Key를 입력하세요 — 분류 키와 다른 엔진 키여야 합니다');
      return;
    }
    if (matchKey.trim() === key.trim()) {
      setErr('학습매칭 Key는 분류 Key와 달라야 합니다. order-mail-match 엔진용 키를 발급해 넣으세요.');
      return;
    }
    const msg = await onSave({
      url: url.trim().replace(/\/$/, ''),
      key: key.trim(),
      matchUrl: matchUrl.trim().replace(/\/$/, ''),
      matchKey: matchKey.trim(),
    });
    if (msg) setErr(msg);
    else onClose();
  };

  return (
    <Modal title="AI 연동 (mail-ai-api)" onClose={onClose}>
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <p className="text-xs text-slate-500 leading-relaxed">
          한 회사(tenant)에서 <strong>엔진(키) 2개</strong>를 씁니다.
          메일함 분류/추출 = <code className="text-[11px]">mail-ai-api</code> 키,
          학습샘플 매칭 = <code className="text-[11px]">order-mail-match</code> 키.
          서로 다른 키를 넣어야 합니다.
        </p>

        <div className="rounded-xl border border-slate-200 p-3 space-y-3">
          <p className="text-xs font-bold text-slate-800">1) 메일 분류·추출 (메일 → 견적)</p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">API Base URL</span>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50"
              placeholder="https://xxxx.up.railway.app"
              value={url}
              disabled={!canEdit || busy}
              onChange={e => setUrl(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">API Key</span>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50"
                placeholder="aidoc_..."
                value={key}
                disabled={!canEdit || busy}
                onChange={e => setKey(e.target.value)}
              />
              <button
                type="button"
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                onClick={() => setShowKey(v => !v)}
              >
                {showKey ? '숨김' : '표시'}
              </button>
            </div>
          </label>
        </div>

        <div className="rounded-xl border border-teal-200 bg-teal-50/30 p-3 space-y-3">
          <p className="text-xs font-bold text-teal-900">2) 학습매칭 엔진 (견적 → 메일)</p>
          <p className="text-[11px] text-teal-800/80 leading-relaxed">
            `POST /v1/order-mail-match` · 첨부 OCR 포함.
            <strong> 분류 API Key와 다른 order-mail-match 엔진 키</strong>를 넣으세요. (비워 두거나 동일 키 사용 불가)
          </p>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">Match API Base URL</span>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50 bg-white"
              placeholder="https://xxxx.up.railway.app (또는 동일)"
              value={matchUrl}
              disabled={!canEdit || busy}
              onChange={e => setMatchUrl(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700">Match API Key</span>
            <div className="flex gap-2">
              <input
                type={showMatchKey ? 'text' : 'password'}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:bg-slate-50 bg-white"
                placeholder="aidoc_... 또는 매칭 전용 키"
                value={matchKey}
                disabled={!canEdit || busy}
                onChange={e => setMatchKey(e.target.value)}
              />
              <button
                type="button"
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 bg-white"
                onClick={() => setShowMatchKey(v => !v)}
              >
                {showMatchKey ? '숨김' : '표시'}
              </button>
            </div>
          </label>
        </div>

        {testMsg && (
          <div
            className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
              testOk ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
            }`}
          >
            {testOk ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{testMsg}</span>
          </div>
        )}
        {err && <p className="text-xs text-red-600">{err}</p>}
        {!canEdit && (
          <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">관리자만 저장할 수 있습니다. 연결 테스트는 가능합니다.</p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
            연결 테스트
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || testing}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              저장
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
