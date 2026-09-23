/** 한국시간 YYYY/MM/DD (요일) HH:mm:ss */
export function formatReceivedAtKst(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const s = d.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }); // 2026-09-23 16:20:00
  const [datePart, timePart = ''] = s.split(' ');
  const date = datePart.replace(/-/g, '/');
  const weekday = d
    .toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' })
    .replace('요일', '');
  return `${date} (${weekday}) ${timePart}`.trim();
}
