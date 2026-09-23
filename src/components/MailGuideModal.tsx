import { HelpCircle } from 'lucide-react';

const GUIDE_ITEMS: { title: string; body: string }[] = [
  {
    title: '최신메일함',
    body: '받은 메일 중 즐겨찾기가 아닌 메일만 모읍니다. 안 읽은 메일이 위에, 그다음 최신 시간 순입니다. AI 메일함 기본 화면이며 한 페이지에 30건씩 보입니다.',
  },
  {
    title: '전체메일함',
    body: '받은 메일과 보낸 메일을 모두 봅니다. 휴지통에 넣은 메일은 여기에 나오지 않습니다.',
  },
  {
    title: '받은메일함',
    body: 'Gmail 받은편지함으로 들어온 메일입니다. 즐겨찾기 포함 수신 메일 전체입니다.',
  },
  {
    title: '보낸메일함',
    body: '내가 Gmail에서 보낸 메일입니다. 보낸 메일은 AI 자동 분류를 하지 않습니다.',
  },
  {
    title: '읽은메일함 / 안읽은메일함',
    body: '받은 메일 중 읽음·안읽음만 모아 봅니다. 열어서 확인하면 안읽음에서 읽음으로 바뀝니다.',
  },
  {
    title: '즐겨찾기',
    body: '별표를 붙인 메일만 모아서 봅니다. ERP에서 별표를 누르면 Gmail 별표와 같이 맞춰집니다.',
  },
  {
    title: '휴지통',
    body: '삭제한 메일이 잠시 보관됩니다. 「복원」으로 되돌리거나 「완전삭제」로 영구 삭제할 수 있습니다.',
  },
  {
    title: '수신',
    body: '메일은 들어왔지만 아직 AI가 견적인지 아닌지 분류하기 전 상태입니다.',
  },
  {
    title: '분류중 / 추출중',
    body: 'AI가 문서를 분류하거나, 견적 정보를 뽑는 중입니다. 잠시 후 상태가 바뀝니다.',
  },
  {
    title: '검토필요',
    body: '견적의뢰로 보이지만, 사람 확인이 필요합니다. 열어보고 내용·거래처를 확인한 뒤 견적 등록하세요.',
  },
  {
    title: '자동후보',
    body: 'AI가 뽑은 정보가 비교적 확실한 견적의뢰입니다. 그래도 한 번 확인해 등록하는 것을 권장합니다.',
  },
  {
    title: '견적등록',
    body: '이미 ERP 견적(초안)으로 등록까지 끝난 메일입니다.',
  },
  {
    title: '비견적',
    body: '견적의뢰가 아니라고 분류된 메일입니다. (예: 발주서, 해원 견적에 대한 외부 답장 등)',
  },
  {
    title: '실패',
    body: 'AI 처리 중 오류가 난 경우입니다. 「AI분류 재실행」으로 다시 시도할 수 있습니다.',
  },
  {
    title: 'Label',
    body: 'Gmail에서 붙인 사용자 라벨별로 메일을 모아서 봅니다.',
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function MailGuideModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="mail-guide-title"
        className="relative w-full max-w-lg max-h-[min(80vh,36rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl flex flex-col"
      >
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <HelpCircle className="w-5 h-5 text-indigo-600 shrink-0" />
          <h3 id="mail-guide-title" className="text-base font-bold text-slate-900">
            AI 메일함 가이드
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-sm text-slate-500 hover:text-slate-800 px-2 py-1"
          >
            닫기
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            왼쪽 메일함·상태 이름과 목록에 보이는 배지가 무엇을 뜻하는지 쉽게 정리했습니다.
          </p>
          {GUIDE_ITEMS.map(item => (
            <div key={item.title}>
              <p className="text-sm font-semibold text-slate-800">{item.title}</p>
              <p className="mt-1 text-[13px] text-slate-600 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
