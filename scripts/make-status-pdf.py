# -*- coding: utf-8 -*-
"""Printable PDF: AI mail status + Wave A–E plan (2026-09-22)."""
from __future__ import annotations

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

font_path = r"C:\Windows\Fonts\malgun.ttf"
font_bold = r"C:\Windows\Fonts\malgunbd.ttf"
pdfmetrics.registerFont(TTFont("Malgun", font_path))
pdfmetrics.registerFont(TTFont("MalgunBold", font_bold if os.path.exists(font_bold) else font_path))

out = r"D:\Cursor\erp-test-1\docs\AI_MAIL_STATUS_AND_PLAN_2026-09-22.pdf"
os.makedirs(os.path.dirname(out), exist_ok=True)

doc = SimpleDocTemplate(
    out,
    pagesize=A4,
    leftMargin=16 * mm,
    rightMargin=16 * mm,
    topMargin=14 * mm,
    bottomMargin=14 * mm,
    title="AI 메일함 현황 및 진행 계획",
    author="erp-test",
)

styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="KRTitle",
        fontName="MalgunBold",
        fontSize=16,
        leading=22,
        alignment=TA_CENTER,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        name="KRSub",
        fontName="Malgun",
        fontSize=9,
        leading=13,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#64748b"),
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        name="KRH1",
        fontName="MalgunBold",
        fontSize=12,
        leading=17,
        spaceBefore=12,
        spaceAfter=6,
        textColor=colors.HexColor("#0f172a"),
    )
)
styles.add(
    ParagraphStyle(
        name="KRH2",
        fontName="MalgunBold",
        fontSize=10.5,
        leading=15,
        spaceBefore=8,
        spaceAfter=4,
        textColor=colors.HexColor("#1e293b"),
    )
)
styles.add(ParagraphStyle(name="KRBody", fontName="Malgun", fontSize=9, leading=13.5, spaceAfter=4))
styles.add(
    ParagraphStyle(name="KRBullet", fontName="Malgun", fontSize=9, leading=13, leftIndent=10, spaceAfter=2)
)
styles.add(
    ParagraphStyle(
        name="KRSmall",
        fontName="Malgun",
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#475569"),
        spaceAfter=4,
    )
)
styles.add(ParagraphStyle(name="KRCell", fontName="Malgun", fontSize=8, leading=11))
styles.add(ParagraphStyle(name="KRCellB", fontName="MalgunBold", fontSize=8, leading=11))


def cell(t: str, bold: bool = False):
    return Paragraph(t, styles["KRCellB"] if bold else styles["KRCell"])


def table_style():
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e2e8f0")),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ]
    )


story = []
story.append(Paragraph("AI 메일 자동분류 — 현황 정리 및 진행 계획", styles["KRTitle"]))
story.append(
    Paragraph(
        "기준일: 2026-09-22 &nbsp;|&nbsp; 대상: erp-test / mail-ai-api &nbsp;|&nbsp; 직전 ERP 커밋: af80e2d",
        styles["KRSub"],
    )
)

story.append(Paragraph("1. 직전 push(a833b0b) 이후 반영분", styles["KRH1"]))
story.append(Paragraph("<b>erp-test</b> af80e2d (Vercel 배포 완료)", styles["KRBody"]))
for line in [
    "메일 알림: Realtime JWT/재구독 + 12초 폴링 백업",
    "키·값 표: 모바일 키 컬럼 폭 조정",
    "출처 모달: 출처 / 근거문구 / 필드신뢰도만 표시 + 출처 추론",
    "레이아웃: AI 메일함 PC 가로 ≈ 70%",
    "gmail-watch: 신규 insert / 기존 update, [제목]/[본문] 라벨",
]:
    story.append(Paragraph("• " + line, styles["KRBullet"]))
story.append(Paragraph("<b>mail-ai-api</b> 2e898e1 (Railway)", styles["KRBody"]))
story.append(
    Paragraph(
        "• source_file을 subject / body / 첨부파일명으로 기록 (기존 input 하드코딩 제거)",
        styles["KRBullet"],
    )
)
story.append(
    Paragraph(
        "로컬에 미푸시 기능 커밋은 없음 (잡파일·ai-doc-api 복사본만 잔여).",
        styles["KRSmall"],
    )
)

story.append(Paragraph("2. 원래 10가지 — 현재 상태", styles["KRH1"]))
rows = [[cell(h, True) for h in ["#", "항목", "상태", "앞으로"]]]
for r in [
    ["1", "mail-ai-api 품질 향상", "진행중", "실메일 피드백 → 프롬프트/모델/평가 루프"],
    ["2", "첨부 전 형식 OCR (word/excel 등)", "남음", "지금은 PDF·이미지. Office/eml 등 확장"],
    ["3", "분석 우선순위: 제목·본문 → 첨부", "남음", "본문 충분하면 첨부 OCR 생략 등"],
    ["4", "기존 거래처 자동 매칭", "됨", "—"],
    ["5", "Gmail 삭제/휴지통 → ERP", "보류", "요청 시 재개"],
    ["6", "메일 체크박스 일괄삭제", "됨", "UI/체크박스 스타일 반영"],
    ["7", "API 키 관리", "일부", "연동 모달·배지 됨 / SaaS DB·관리자 UI 남음"],
    ["8", "AI 끊겨도 메일함 동작", "됨", "—"],
    ["9", "상세 Key-Value 도표", "됨", "출처 모달 개선까지 반영"],
    ["10", "SaaS 과금/멀티테넌트", "남음", "인메모리 골격만"],
]:
    rows.append([cell(x) for x in r])
t = Table(rows, colWidths=[12 * mm, 52 * mm, 22 * mm, 78 * mm])
t.setStyle(table_style())
story.append(t)

story.append(Paragraph("3. 추가 기타 사항", styles["KRH1"]))
rows2 = [[cell(h, True) for h in ["항목", "상태"]]]
for r in [
    ["첨부 미리보기/다운로드 (Gmail on-demand)", "됨"],
    ["AI분류 재실행 UX (자동등록 안 탐)", "됨"],
    ["자동등록 실패 사유 표시", "남음"],
    ["Ground Truth 품질 회귀 루틴", "남음 (fixtures 로컬만)"],
    ["INBOX만 / 인용분리·스레드 / HTML / 모바일 / KST / 고아 발주 방지", "됨"],
    ["버튼 문구 (AI분류 재실행·분류 저장·메일삭제)", "됨"],
    ["데스크톱 리스트 컬럼·체크박스", "됨"],
]:
    rows2.append([cell(x) for x in r])
t2 = Table(rows2, colWidths=[120 * mm, 44 * mm])
t2.setStyle(table_style())
story.append(t2)

story.append(Paragraph("4. 앞으로 우선순위 (제안) — 이번에 1·2·3 진행", styles["KRH1"]))
story.append(Paragraph("제안 순서 1 = 품질 루프(#1) + 자동등록 실패 사유", styles["KRBullet"]))
story.append(Paragraph("제안 순서 2 = 본문 우선(#3) → OCR 포맷 확장(#2)", styles["KRBullet"]))
story.append(Paragraph("제안 순서 3 = Ground Truth 회귀를 품질 루프에 고정", styles["KRBullet"]))

story.append(Paragraph("5. 1·2·3 한번에 진행 가능한가?", styles["KRH1"]))
story.append(
    Paragraph(
        "<b>가능합니다.</b> 다만 “하루 만에 전부 완성”이 아니라, "
        "<b>한 번에 착수하되 Wave로 나눠 끝내는 방식</b>이 맞습니다. "
        "서로 의존하므로 병렬 설계 후 순차 마감하는 것이 안전합니다.",
        styles["KRBody"],
    )
)
story.append(
    Paragraph(
        "의존 관계: GT 회귀(3) ↔ 품질 루프(1) / 본문 우선(#3) → OCR 비용·품질에 영향 / "
        "Office OCR(#2)은 본문 우선 정책과 함께 설계해야 중복 호출을 줄임.",
        styles["KRSmall"],
    )
)

story.append(Paragraph("6. 디테일 진행 계획 (Wave)", styles["KRH1"]))

story.append(Paragraph("Wave A — 자동등록 실패 사유 표시 (ERP)", styles["KRH2"]))
for line in [
    "대상: ready_auto / auto_register 경로에서 등록 실패·스킵 시 사용자에게 이유 노출",
    "저장: mail_messages.error_message 또는 last_auto_register_error / status_reason",
    "UI: 리스트·상세에 “자동등록 실패: …” 배지 (거래처 미매칭, 필수필드 부족, draft 실패 등)",
    "코드: gmail-watch matchAndMaybeAutoRegister + useMail 등록 경로 사유 코드 통일",
    "완료 기준: 실패 케이스 3종 이상 화면에 한글 사유로 보임",
]:
    story.append(Paragraph("• " + line, styles["KRBullet"]))

story.append(Paragraph("Wave B — Ground Truth 회귀 루틴 (품질 계측기)", styles["KRH2"]))
for line in [
    "scripts/ai-poc fixtures(50건+)를 mail-ai-api 실엔진으로 평가하는 스크립트 정리",
    "KPI: 필드별 exact/loose match, overall_confidence 분포, source_file 정확도",
    "결과: results/summary.json + 실패 샘플 목록",
    "완료 기준: npm script 한 방으로 재현 가능, 기준선(baseline) 문서화",
]:
    story.append(Paragraph("• " + line, styles["KRBullet"]))

story.append(Paragraph("Wave C — mail-ai-api 품질 향상 (#1)", styles["KRH2"]))
for line in [
    "프롬프트: 출처(subject/body/filename)·evidence_text 강제 강화 (GT로 검증)",
    "실메일 오분류/오추출 10~20건 수집 → 케이스별 프롬프트/후처리",
    "후처리: 문서번호·날짜·수량 정규화, 빈 값 과신 confidence 하향",
    "완료 기준: GT KPI가 baseline 대비 개선 또는 실메일 샘플 오차율 감소",
]:
    story.append(Paragraph("• " + line, styles["KRBullet"]))

story.append(Paragraph("Wave D — 분석 우선순위 제목·본문 → 첨부 (#3)", styles["KRH2"]))
for line in [
    "정책: 제목+본문으로 필수필드가 충분하면 첨부 OCR 생략",
    "부족 시에만 PDF/이미지(및 이후 Office) OCR 호출",
    "구현: mail-ai-api 오케스트레이션 또는 gmail-watch 2-pass",
    "완료 기준: 본문만으로 충분한 메일에서 첨부 OCR 호출 0회 (로그 확인)",
]:
    story.append(Paragraph("• " + line, styles["KRBullet"]))

story.append(Paragraph("Wave E — 첨부 OCR 포맷 확장 (#2)", styles["KRH2"]))
for line in [
    "1차: docx / xlsx(표) 텍스트 추출 → LLM에 text 파트로 전달",
    "2차: eml / 구형 doc·xls (가능 범위), 한글(hwp)은 후순위",
    "가드: zip/exe 차단, 용량 상한, 암호 PDF 실패 사유 표기",
    "완료 기준: docx·xlsx 샘플 각 2건 이상 추출 성공 + 실패 시 사유 표시",
]:
    story.append(Paragraph("• " + line, styles["KRBullet"]))

story.append(
    Paragraph(
        "권장 실행 순서: <b>A → B → C(동시 일부) → D → E</b>. "
        "A·B는 ERP/스크립트라 바로 착수 가능. C·D·E는 mail-ai-api(+gmail-watch) 중심.",
        styles["KRBody"],
    )
)

story.append(Paragraph("7. 범위 밖 (이번 1·2·3에 포함 안 함)", styles["KRH1"]))
story.append(
    Paragraph(
        "• #5 Gmail 삭제 동기 (보류) · #7 SaaS 관리자 UI 본격화 · #10 과금/멀티테넌트",
        styles["KRBullet"],
    )
)

story.append(Spacer(1, 8))
story.append(
    Paragraph(
        "한 줄 요약: 코어 메일함·검토 UX는 거의 끝났고, "
        "이번 작업축은 추출 품질(#1·2·3) + 실패 사유 표시 + GT 회귀입니다.",
        styles["KRBody"],
    )
)


def footer(canvas, doc_):
    canvas.saveState()
    canvas.setFont("Malgun", 8)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawString(16 * mm, 8 * mm, "AI 메일 자동분류 현황 · 인쇄용")
    canvas.drawRightString(A4[0] - 16 * mm, 8 * mm, str(doc_.page))
    canvas.restoreState()


doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(out)
