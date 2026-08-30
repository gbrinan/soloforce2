# qualgate.py — 변환 품질 게이트 (SKILL.md Workflow 2단계의 실행체)
# 사용: uv run python scripts/qualgate.py <변환된 md...> [--source <원본> ...]
#       --source를 짝지어 주면 원본 분량 대비 추출률까지 본다 (순서 일치)
# 판정: PASS | QUARANTINE(사유)  — 종료코드: 격리가 하나라도 있으면 1
# 검사: 두부·대체문자 비율, latin1 모지바케, nn 연쇄(CMap 손상), 스프레드시트 오류 문자열,
#       엑셀 직렬 날짜 잔여, 한글 소실(영어 산문은 제외), 본문 빈약, 원본 대비 추출률
import sys, re, os

TOFU = set("■□�⬛")          # ■ □ � ⬛
ERR_PAT = re.compile(r"#REF!|#VALUE!|#NAME\?")
NN_RUN = re.compile(r"(?:\bn{2,6}\b[\s:·+/,]*){4,}")  # 'nn nn nnnn' 연쇄 (CMap 손상 증상)

MOJIBAKE = re.compile(r"[ÃãÄäÅå][-¿]|ê°|ë|ì")  # utf8을 latin1로 읽은 흔적
SERIAL_DATE = re.compile(r"(?<![\d.])4[0-6]\d{3}(?![\d.])")  # 2009~2027 구간의 엑셀 직렬 날짜

def judge(path, source=None):
    text = open(path, encoding="utf-8", errors="replace").read()
    body = re.sub(r"\s+", "", text)
    if len(body) < 20:
        return "QUARANTINE(본문 20자 미만)"
    if source and os.path.isfile(source):
        ratio = len(body) / max(os.path.getsize(source), 1)
        if os.path.getsize(source) > 50_000 and ratio < 0.005:
            return f"QUARANTINE(추출률 미달 — 원본 {os.path.getsize(source)}B 대비 본문 {len(body)}자)"
    if MOJIBAKE.search(text):
        return "QUARANTINE(인코딩 모지바케 — utf8을 latin1로 해석한 흔적)"
    serial = SERIAL_DATE.findall(text)
    if len(serial) >= 3:
        return f"QUARANTINE(엑셀 직렬 날짜 잔여 {len(serial)}건 — 날짜가 정수로 남음)"
    tofu_ratio = sum(c in TOFU for c in body) / len(body)
    if tofu_ratio > 0.02:
        return f"QUARANTINE(두부/대체문자 {tofu_ratio:.1%})"
    if NN_RUN.search(text):
        return "QUARANTINE(nn 연쇄 — CMap 손상 증상)"
    if ERR_PAT.search(text):
        return "QUARANTINE(스프레드시트 오류 문자열)"
    hangul = sum("가" <= c <= "힣" for c in body)
    ascii_alpha = sum(c.isascii() and c.isalpha() for c in body)
    # 한글 파일명인데 본문 한글이 사실상 0이면 소실 의심.
    # 단, 본문이 멀쩡한 영어 산문이면 소실이 아니라 원래 영어 문서다 — 통과시킨다.
    name_has_hangul = any("가" <= c <= "힣" for c in os.path.basename(path))
    if name_has_hangul and hangul < 5 and ascii_alpha > 50 and not _reads_as_english(text):
        return "QUARANTINE(한글 소실 의심 — 파일명은 한글, 본문 한글 <5자, 영어 산문도 아님)"
    return "PASS"

STOPWORDS = {"the", "and", "of", "to", "in", "for", "is", "are", "was", "were", "on",
             "with", "that", "this", "as", "at", "by", "from", "it", "be", "we", "you"}

def _reads_as_english(text):
    """영어 불용어가 충분히 섞인 자연스러운 산문인가 — 깨진 라틴 잔해와 구분한다."""
    words = re.findall(r"[A-Za-z']+", text.lower())
    if len(words) < 15:
        return False
    return sum(w in STOPWORDS for w in words) / len(words) >= 0.08

def main(argv):
    srcs = []
    if "--source" in argv:
        i = argv.index("--source")
        argv, srcs = argv[:i], argv[i + 1:]
    bad = 0
    for n, p in enumerate(argv):
        v = judge(p, srcs[n] if n < len(srcs) else None)
        if v != "PASS":
            bad += 1
        print(f"{v}|{p}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
