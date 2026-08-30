# 복구·판별 체인 참조 (SKILL.md 라우팅 표의 보조 경로 상세)

> 조사일 2026-08-31. 도구가 바뀌면 이 문서와 SKILL.md 라우팅 표만 고친다 — 루프는 그대로다.
> 출처 신뢰도 표기: [검증]=직접 fetch 확인, [스니펫]=검색 결과 요지만 확인.

## A. 한글 깨진 PDF (CMap 손상·폰트 미래스터화) 복구 체인

증상: 텍스트 추출·OCR 강제 모두 "성공" 종료하나 한글이 `nn`/탈락. 원인은 pdfium이
CID 매핑이 깨진 글자를 두부(tofu)로 그려 OCR이 읽을 것 자체가 없는 것 [스니펫: pdfium bug 1608].
뷰어가 멀쩡히 보여주는 것은 뷰어가 폰트를 대체(substitute)하기 때문이다.

체인 (싼 것부터):
1. **감지** — 변환 결과의 한글 비율 ≈ 0 또는 동일 문자 반복(`nn…`) → 이 체인으로.
2. **텍스트층 복구 시도** — `pdf-fix-tuc` (C++/libqpdf, ToUnicode CMap 수리) [검증:
   github.com/trueroad/pdf-fix-tuc]. 매핑이 "있는데 틀린" 경우만 구제 — 없으면 3으로.
3. **재래스터화** — Ghostscript 300dpi (`gswin64c -sDEVICE=png16m -r300`), `cidfmap`에
   한국 폰트(맑은 고딕) 고정 [스니펫: Ghostscript Fonts 문서 — CIDFont 대체 캐스케이드].
   실패 시 `pdftoppm -r 300 -png` → `mutool draw -r 300` 순으로 교체.
4. **래스터 확인** — 한 페이지를 Tesseract `kor`로 신뢰도 탐침: 한글이 실제로
   그려졌는지 확인 후 진행.
5. **OCR** — PaddleOCR **PP-OCRv5 `korean_PP-OCRv5_mobile_rec`** (CPU 가능, 한국어
   라인 정확도 88%) [검증: HuggingFace PaddlePaddle/korean_PP-OCRv5_mobile_rec].
6. **에스컬레이션(선택)** — GPU/API 가용 시 VLM OCR(dots.ocr, KolmOCR) [스니펫].
   CPU 배치 파이프라인에는 부적합.

전 단계 실패 시: 격리. 매핑도 폰트도 없는 PDF는 결정적으로 복구 불가능하다 —
정직하게 격리가 정답이다.

## B. 레거시 .doc / MIME 위장 문서 체인

판별(수집 단계 매직바이트):
- `D0 CF 11 E0 A1 B1 1A E1` (OLE2) → 진짜 Word 97-2003 바이너리.
- 첫 256바이트에 `MIME-Version:`/`Content-Type: multipart/related` → MHTML
  (Confluence "Word 내보내기"의 실체) [스니펫: RFC 2557/Wikipedia MHTML].

OLE2 (.doc) 체인:
1. 사무 스위트 headless 일괄 변환: `soffice --headless --convert-to odt --outdir <dir> *.doc`
   — 주의 3가지 [스니펫]: (a) 호출당 콜드스타트 ~20-30초 → 여러 파일을 한 호출로 배치,
   (b) 손상 입력은 실패 대신 **행(hang)** 할 수 있음 → 타임아웃 래핑 + 출력 파일
   존재·비어있지 않음 검증(종료 코드 불신), (c) 병렬 실행 시 워커별
   `-env:UserInstallation=file:///…` 분리.
2. `pandoc -f odt -t gfm` 으로 마크다운화 (pandoc은 바이너리 .doc 직접 불가
   [스니펫: pandoc #8654]).
3. antiword/wvWare는 채택 금지 — 사실상 사멸, 한국어 인코딩 취약 [스니펫: wvware 공지].

MHTML 체인:
1. Python 표준 `email` 파서(`BytesParser`)로 `text/html` 파트 추출 —
   `get_payload(decode=True)`가 quoted-printable/base64를 자동 해제, 선언 charset로 디코드.
2. `pandoc -f html -t gfm` (표 충실도) 또는 markdownify.
3. 원본이 아직 Confluence에 살아 있으면 API 기반 confluence-markdown-exporter가
   장기적으로 더 깨끗한 경로 [스니펫].

## C. 한국형 민감정보(PII) 스캔 스택

원칙: **체크섬은 신뢰도 가산용이지 거부용이 아니다** — 스캔의 비용 비대칭
(놓친 유출 ≫ 오탐) 때문. 근거가 되는 제도 변화 2건:
- 주민등록번호는 **2020-10 이후 발급분의 뒷자리가 무작위** — 가중치 체크섬이 신규
  번호의 ~90%에서 실패한다. 형식+성별자리+날짜 유효성만으로 히트 처리 [스니펫: 한국일보 등].
- 법인등록번호는 **2025-01-31 이후 발급분에 체크섬 없음** (형식도 변경) [스니펫: 대한변협 공지].

스택:
1. **presidio-analyzer** (data-privacy-stack/presidio — microsoft에서 이관) —
   한국 인식기 5종 내장: `KR_RRN`(주민), `KR_FRN`(외국인), `KR_BRN`(사업자),
   `KR_DRIVER_LICENSE`, `KR_PASSPORT` [검증: presidio supported entities 페이지.
   KR_RRN 체크섬은 2020-10 이전 발급분에만 적용되도록 이미 구현됨].
2. **커스텀 PatternRecognizer 추가분**: 휴대전화 `01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}`,
   유선·대표번호, 법인등록번호 13자리(2025-01 무체크섬 규칙 반영),
   계좌번호는 정규식 단독 불가 → 문맥어(계좌·입금·예금주·은행명 리스트) ±20자
   게이트로만 히트.
3. **NER 레이어(인명·기관)**: `Leo97/KoELECTRA-small-v3-modu-ner` — 14.1M 파라미터로
   CPU 단독 구동, 국립국어원 코퍼스 15개 엔터티, F1 0.83 [검증: HuggingFace].
   PS→PERSON, OG→ORGANIZATION으로 Presidio에 배선.

스캔 결과는 SKILL.md의 보류 버킷 규칙을 따른다: 플래그는 보류까지만, 확정은 사람.
