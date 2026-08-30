# mirrorcheck.py — 로컬 정본 대비 미러 정합 검증 (SKILL.md 저장 계층 표의 미러 단계 실행체)
# 사용: uv run python scripts/mirrorcheck.py <정본 디렉터리> --emit <출력.json>
#       uv run python scripts/mirrorcheck.py <정본 디렉터리> --expect <원격목록.json>
# 왜: 미러가 정본과 같은지를 지금은 눈으로 본다. 눈은 빠진 파일 한 개를 못 본다 —
#     특히 "있어야 할 것이 없는" 누락은 화면에 아무것도 표시되지 않아 보이지 않는다.
#     --emit 은 정본을 기계가 나열해 "올바른 미러가 담아야 할 것"을 고정하고,
#     --expect 는 원격이 신고한 목록을 그 자리에서 다시 나열한 정본과 대조한다.
#     원격 신고를 그대로 믿지 않고 매번 정본을 다시 걷는 것이 이 검사의 전제다.
# 제외: quarantine/ 는 통째로 제외한다. 격리 산출물은 의도적으로 미러하지 않는다 —
#       판정이 끝나지 않은 것을 밖으로 내보내면 격리의 의미가 없어진다.
# 종료코드: 불일치 시 1 (미러 미완 판정)
import sys, os, json, hashlib

SUBDIRS = ["md", "meta"]
ROOT_FILES = ["index.md", "updates.md", "golden.md"]
EXCLUDE_DIRS = {"quarantine"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def walk_canonical(base):
    # 정본이 담아야 할 것만 걷는다: md/ meta/ 하위 전체 + 루트의 색인 파일들.
    # 상대 경로는 항상 / 구분자로 만든다 — 미러 쪽이 어느 OS든 같은 키로 대조되어야 한다.
    items = []
    for sub in SUBDIRS:
        d = os.path.join(base, sub)
        if not os.path.isdir(d):
            continue
        for root, dirs, files in os.walk(d):
            dirs[:] = sorted(x for x in dirs if x not in EXCLUDE_DIRS)
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, base).replace(os.sep, "/")
                items.append({"path": rel, "size": os.path.getsize(full), "sha256": sha256(full)})
    for name in ROOT_FILES:
        full = os.path.join(base, name)
        if os.path.isfile(full):
            items.append({"path": name, "size": os.path.getsize(full), "sha256": sha256(full)})
    return sorted(items, key=lambda it: it["path"])


def load_listing(path):
    # 원격 목록은 배열이거나 {"items": [...]} 형태 둘 다 받는다.
    data = json.load(open(path, encoding="utf-8"))
    rows = data.get("items", []) if isinstance(data, dict) else data
    out = {}
    for r in rows:
        rel = str(r["path"]).replace("\\", "/")
        out[rel] = r
    return out


def emit(base, out_path):
    items = walk_canonical(base)
    data = {"canonical": os.path.abspath(base), "count": len(items), "items": items}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"미러 기준 목록: {out_path}")
    print(f"정본 {len(items)}건 (quarantine/ 제외)")
    for it in items:
        print(f"  {it['sha256'][:8]}|{it['size']}|{it['path']}")
    return 0


def expect(base, listing_path):
    local = {it["path"]: it for it in walk_canonical(base)}
    remote = load_listing(listing_path)
    problems = []

    for rel in sorted(set(local) - set(remote)):
        problems.append(f"원격에 없음(미러 누락): {rel}")
    for rel in sorted(set(remote) - set(local)):
        problems.append(f"원격에만 있음(정본에 없는 파일): {rel}")

    for rel in sorted(set(local) & set(remote)):
        mine, theirs = local[rel], remote[rel]
        if "size" in theirs and int(theirs["size"]) != mine["size"]:
            problems.append(f"크기 불일치: {rel} 정본 {mine['size']} != 원격 {theirs['size']}")
        # 해시는 원격이 신고한 경우에만 본다 — 안 준 것을 틀렸다고 하지는 않는다.
        if theirs.get("sha256") and str(theirs["sha256"]).lower() != mine["sha256"]:
            problems.append(f"해시 불일치: {rel} 정본 {mine['sha256'][:8]} != 원격 {str(theirs['sha256'])[:8]}")

    hashed = sum(1 for rel in set(local) & set(remote) if remote[rel].get("sha256"))
    print(f"미러 대조: 정본 {len(local)} · 원격 {len(remote)} · 해시 신고 {hashed}건 (quarantine/ 제외)")
    if problems:
        print("판정: 미러 미완")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("판정: 미러 정합 통과")
    return 0


def main(argv):
    if not argv or argv[0].startswith("--"):
        print("사용법: mirrorcheck.py <정본 디렉터리> --emit <출력.json> | --expect <원격목록.json>")
        return 2
    base = argv[0]
    if not os.path.isdir(base):
        print(f"정본 디렉터리 없음: {base}")
        return 2
    if "--emit" in argv:
        return emit(base, argv[argv.index("--emit") + 1])
    if "--expect" in argv:
        return expect(base, argv[argv.index("--expect") + 1])
    print("사용법: mirrorcheck.py <정본 디렉터리> --emit <출력.json> | --expect <원격목록.json>")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
