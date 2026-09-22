# AI PoC — Ground Truth & KPI

```bash
# from repo root
npm run ai:poc:generate   # 50건 fixtures (ko/en/zh/mixed)
npm run ai:poc:eval       # heuristic Exact Match KPI → results/summary.json
```

운영 추출은 별도 저장소 `mail-ai-api` multimodal 엔진으로 교체하고, 동일 fixtures로 KPI를 재측정합니다.
