# piiscan.py — 민감 자동 스캔의 정규식 레이어 (SKILL.md Workflow 3단계의 실행체)
# 사용: uv run python scripts/piiscan.py <md 파일...>
# 판정: CLEAN | HOLD(범주: 스니펫) — 종료코드: HOLD가 하나라도 있으면 1
# 원칙(references/recovery-chains.md §C): 체크섬은 신뢰도 '가산'만 — 형식 일치면 일단 HOLD.
#   플래그는 보류까지만, 확정 판정은 사람이 한다.
# NER 레이어(presidio + KoELECTRA)는 설치된 환경에서 이 스크립트 뒤에 추가로 돈다.
import sys, re

# 경계는 \b를 쓰지 않는다: 파이썬 re에서 한글은 \w라 "홍길동901231-1234567님"에
# 단어 경계가 없어 전 패턴이 통째로 미탐된다. 숫자 인접만 배제하는 룩어라운드를 쓴다.
L, R = r"(?<![0-9])", r"(?![0-9])"
SEP = r"[-\s]{0,2}"  # 표 변환 산출물은 줄바꿈·이중 공백으로 갈라진다

RULES = [
    ("주민등록번호", re.compile(L + r"\d{2}[01]\d[0-3]\d" + SEP + r"[1-8]\d{6}" + R)),
    ("외국인등록번호", re.compile(L + r"\d{2}[01]\d[0-3]\d" + SEP + r"[5-8]\d{6}" + R)),
    ("사업자등록번호", re.compile(L + r"\d{3}-\d{2}-\d{5}" + R)),
    ("법인등록번호", re.compile(L + r"\d{6}-\d{7}" + R)),
    ("휴대전화", re.compile(L + r"01[016789][-.\s]{0,2}\d{3,4}[-.\s]{0,2}\d{4}" + R)),
    ("유선전화", re.compile(L + r"0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70)[-.\s]{1,2}\d{3,4}[-.\s]{1,2}\d{4}" + R)),
    ("카드번호", re.compile(L + r"\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}" + R)),
    ("이메일", re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")),
]
# 문맥 게이트 규칙: 문맥어 ±40자 안의 **숫자열**만 히트 (계좌는 전국 공통 형식이 없다).
# 문맥어 하나만으로 히트시키면 재무 문서가 전건 보류돼 사람 판정이 소음에 마비된다 —
# 오탐 홍수는 미탐보다 나쁘다. 그래서 두 규칙 모두 4자리 이상 숫자를 요구한다.
NUMS = re.compile(r"\d{2,6}(?:[-\s]?\d{2,6}){1,3}")
CONTEXT_RULES = [
    ("계좌추정", ["계좌", "입금", "예금주", "국민", "신한", "우리", "하나", "농협", "기업",
                 "카카오뱅크", "토스뱅크"], NUMS),
    ("지급·정산", ["가맹점키", "가맹점명", "계좌지급", "정산예정액", "지급액"], NUMS),
]
MIN_CTX_DIGITS = 4  # 문맥 규칙 히트의 최소 숫자 개수

def scan(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    hits = []
    claimed = []  # 이미 더 좁은 규칙이 가져간 구간 — 라벨 중복을 막는다
    for name, pat in RULES:
        for m in list(pat.finditer(text))[:3]:
            if any(m.start() < e and s < m.end() for s, e in claimed):
                continue
            claimed.append((m.start(), m.end()))
            hits.append((name, m.group()[:24]))
    for name, ctx_words, pat in CONTEXT_RULES:
        for w in ctx_words:
            i = text.find(w)
            if i < 0:
                continue
            seg = text[max(0, i - 40): i + 40].replace(w, "", 1)
            for m in pat.finditer(seg):
                if sum(c.isdigit() for c in m.group()) >= MIN_CTX_DIGITS:
                    hits.append((name, f"{w}≈{m.group()[:20]}"))
                    break
            else:
                continue
            break
    return hits

def main(argv):
    bad = 0
    for p in argv:
        hits = scan(p)
        if hits:
            bad += 1
            cats = "; ".join(f"{n}:{s}" for n, s in hits[:5])
            print(f"HOLD({cats})|{p}")
        else:
            print(f"CLEAN|{p}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
