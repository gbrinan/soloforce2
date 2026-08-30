# verguard.py — 버전·게이트 무결성 가드 (배포 전, 그리고 배치 시작 전에 실행)
# 사용: uv run python scripts/verguard.py            (레포 루트: 버전=태그 + 스크립트 해시 대조)
#       uv run python scripts/verguard.py --seal     (현재 스크립트 해시를 봉인 파일로 기록)
# 왜: 게이트를 지키는 것이 산문뿐이면, 같은 세션이 임계값을 느슨하게 고쳐도 아무도 모른다.
#     봉인 해시가 다르면 "게이트가 변경됨"을 알리고 배치를 멈춘다 — 변경 자체가 버전업 사유다.
import json, os, subprocess, sys, hashlib

SEAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gates.sha256")

def hashes():
    d = os.path.dirname(os.path.abspath(__file__))
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".py"):
            raw = open(os.path.join(d, f), "rb").read()
            # 줄바꿈을 정규화하고 해시한다: git이 체크아웃 환경에 따라 CRLF/LF를 바꾸므로,
            # 정규화하지 않으면 내용이 같은데도 봉인이 깨졌다는 거짓 경보가 난다.
            out[f] = hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()
    return out

def main(argv):
    now = hashes()
    if "--seal" in argv:
        json.dump(now, open(SEAL, "w"), indent=2, sort_keys=True)
        print(f"봉인 기록: {len(now)}개 스크립트 → {SEAL}")
        return 0
    problems = []
    if os.path.isfile("agent/meta.json"):
        v = json.load(open("agent/meta.json", encoding="utf-8"))["version"]
        tag = subprocess.run(["git", "describe", "--tags", "--abbrev=0"],
                             capture_output=True, text=True).stdout.strip()
        print(f"meta.json {v} / 최신 태그 {tag} -> {'일치' if tag == f'v{v}' else '불일치'}")
        if tag != f"v{v}":
            problems.append("버전과 태그 불일치")
    if os.path.isfile(SEAL):
        sealed = json.load(open(SEAL))
        changed = [f for f in set(sealed) | set(now) if sealed.get(f) != now.get(f)]
        print(f"게이트 봉인: {len(now)}개 중 변경 {len(changed)}개" + (f" {changed}" if changed else ""))
        if changed:
            problems.append("게이트 스크립트가 봉인과 다름 — 변경했다면 버전업 후 --seal")
    else:
        problems.append(f"봉인 파일 없음 — 먼저 `verguard.py --seal` 실행 ({SEAL})")
    if problems:
        for p in problems:
            print(f"  - {p}")
        return 1
    print("판정: 버전·게이트 무결성 통과")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
