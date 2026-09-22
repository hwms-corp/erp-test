import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plug, XCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { checkAiDocHealth, getAiDocConfig } from '@/lib/aiDocClient';

type Props = {
  initialUrl: string;
  initialKey: string;
  canEdit: boolean;
  busy?: boolean;
  onClose: () => void;
  onSave: (url: string, key: string) => Promise<string | null>;
};

export function AiConnectionModal({
  initialUrl,
  initialKey,
  canEdit,
  busy,
  onClose,
  onSave,
}: Props) {
  const envFallback = getAiDocConfig();
  const [url, setUrl] = useState(initialUrl || envFallback.apiBaseUrl);
  const [key, setKey] = useState(initialKey || envFallback.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setUrl(initialUrl || envFallback.apiBaseUrl);
    setKey(initialKey || envFallback.apiKey);
  }, [initialUrl, initialKey, envFallback.apiBaseUrl, envFallback.apiKey]);

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    setTestOk(null);
    const r = await checkAiDocHealth({ apiBaseUrl: url, apiKey: key });
    setTesting(false);
    if (r.status === 'online') {
      setTestOk(true);
      setTestMsg('연결 성공 — health + API Key 인증 OK');
    } else if (r.status === 'unauthorized') {
      setTestOk(false);
      setTestMsg(`서버는 응답하지만 API Key가 올바르지 않습니다. (${r.detail || ''})`);
    } else {
      setTestOk(false);
      setTestMsg(`연결 실패: ${r.detail || r.status}`);
    }
  };

  const save = async () => {
    setErr(null);
    if (!url.trim()) {
      setErr('API URL을 입력하세요');
      return;
    }
    if (!key.trim()) {
      setErr('API Key를 입력하세요');
      return;
    }
    const msg = await onSave(url.trim().replace(/\/$/, ''), key.trim());
    if (msg) setErr(msg);
    else onClose();
  };

  return (
    <Modal title="AI 연동 (mail-ai-api)" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          ERP 화면에서 분류/추출·재실행에 쓰는 <strong>mail-ai-api</strong> 주소와 API Key입니다.
          수신 시 자동 AI는 Supabase Edge secrets(<code className="text-[11px]">AI_DOC_API_URL</code>)도 맞춰야 합니다.
        </p>

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
