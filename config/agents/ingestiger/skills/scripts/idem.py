# idem.py — 재적재 멱등 판정 (SKILL.md Rules '멱등성'의 실행체)
# 사용: uv run python scripts/idem.py <ingestiger 디렉터리> <소스 파일...>
# 각 소스에 대해 meta/의 source_sha256_8·converter와 대조:
#   불변(건너뜀 사유) | 변경(재변환 대상) | 신규(첫 적재 또는 이전 비적재)
# 종료코드: 항상 0 (판정 보고용) — '불변' 파일을 다시 적재하면 그때가 위반이다
import sys, os, json, hashlib, glob

def sha8(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:8]

def main(argv):
    base, sources = argv[0], argv[1:]
    metas = {}
    for mp in glob.glob(os.path.join(base, "meta", "*.json")):
        m = json.load(open(mp, encoding="utf-8"))
        metas[os.path.basename(m.get("source_path", ""))] = m
    stats = {"불변": 0, "변경": 0, "신규": 0}
    for s in sources:
        name = os.path.basename(s)
        m = metas.get(name)
        if not m:
            v = "신규"
        elif sha8(s) == m.get("source_sha256_8"):
            v = "불변" + f"(converter={m.get('converter')})"
        else:
            v = "변경"
        stats[v.split("(")[0]] += 1
        print(f"{v}|{name}")
    print(f"요약: 불변 {stats['불변']} · 변경 {stats['변경']} · 신규 {stats['신규']}"
          f" — 불변은 건너뜀(사유:불변), 변경·신규만 처리 대상")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
