# manifest.py — 발견 매니페스트 생성 (SKILL.md Workflow 1단계, 정산의 독립 기준점)
# 사용: uv run python scripts/manifest.py <배치id> <소스 폴더> [--glob "*.pdf"] --out <ingestiger>/manifests/
# 왜: 발견 수를 사람이 신고하면 침묵 누락이 정산에 비가시가 된다. 소스를 기계가 나열해
#     매니페스트로 고정하고, ledger가 그 매니페스트와 소스 폴더를 다시 읽어 대조한다.
import sys, os, json, hashlib, glob as globmod

def sha8(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:8]

def enumerate_source(src, pattern):
    files = sorted(globmod.glob(os.path.join(src, pattern)))
    return [f for f in files if os.path.isfile(f) and not os.path.basename(f).startswith("~$")]

def main(argv):
    batch, src = argv[0], argv[1]
    pattern = argv[argv.index("--glob") + 1] if "--glob" in argv else "*"
    out = argv[argv.index("--out") + 1] if "--out" in argv else "."
    cap = int(argv[argv.index("--cap") + 1] if "--cap" in argv else 50)
    files = enumerate_source(src, pattern)
    carried = files[cap:]
    files = files[:cap]
    os.makedirs(out, exist_ok=True)
    data = {
        "batch": batch,
        "source": os.path.abspath(src),
        "pattern": pattern,
        "found": len(files),
        "carried_over": len(carried),
        "items": [{"path": os.path.abspath(f), "name": os.path.basename(f),
                   "source_sha256_8": sha8(f), "size": os.path.getsize(f)} for f in files],
    }
    path = os.path.join(out, f"{batch}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"매니페스트: {path}")
    print(f"발견 {data['found']} · 다음 배치 이월 {data['carried_over']}")
    for it in data["items"]:
        print(f"  {it['source_sha256_8']}|{it['name']}")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
