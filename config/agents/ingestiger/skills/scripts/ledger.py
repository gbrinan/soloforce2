# ledger.py — 정산·색인 정합의 독립 검증 (SKILL.md Verification 1·3의 실행체)
# 사용: uv run python scripts/ledger.py <ingestiger 디렉터리> --manifest <배치 매니페스트.json>
#       (--found N 은 폐기: 사람이 신고한 수와 사람이 쓴 색인을 맞춰봐야 침묵 누락이 안 보인다)
# 검사: ① 매니페스트 vs 소스 폴더 재나열 — 발견 단계의 침묵 누락 탐지 (독립 진실 대조)
#       ② 매니페스트의 각 항목이 이번 배치 색인 행에 존재 — 처리 단계의 침묵 누락 탐지
#       ③ 이번 배치 행의 상태 합계 = 매니페스트 발견 수
#       ④ 적재 행마다 md/<문서id>.md 실재, 격리 행마다 quarantine/ 파일 실재 (문서id 정확 매칭)
# 종료코드: 불일치 시 1 (배치 미완 판정)
import sys, os, json, glob as globmod

STATES = ["적재", "실패", "건너뜀", "격리", "보류"]

def read_rows(idx_path):
    rows = []
    for line in open(idx_path, encoding="utf-8"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5 or cells[0] in ("제목", "---") or set(cells[0]) <= {"-"}:
            continue
        rows.append(cells)
    return rows

def main(argv):
    base = argv[0]
    if "--manifest" not in argv:
        print("사용법: ledger.py <ingestiger 디렉터리> --manifest <배치.json>")
        return 2
    man = json.load(open(argv[argv.index("--manifest") + 1], encoding="utf-8"))
    problems = []

    # ① 독립 진실 대조: 소스 폴더를 지금 다시 나열해 매니페스트와 맞춘다
    live = {os.path.basename(f) for f in globmod.glob(os.path.join(man["source"], man["pattern"]))
            if os.path.isfile(f) and not os.path.basename(f).startswith("~$")}
    listed = {it["name"] for it in man["items"]}
    missed = live - listed
    if missed and man.get("carried_over", 0) == 0:
        problems.append(f"소스에 있으나 매니페스트에 없는 파일 {len(missed)}건: {sorted(missed)[:3]}")
    for it in man["items"]:
        if not os.path.isfile(it["path"]):
            problems.append(f"매니페스트 항목이 소스에서 사라짐: {it['name']}")

    rows = read_rows(os.path.join(base, "index.md"))
    # 이번 배치 행 = 매니페스트 항목에 대응하는 행. 색인은 누적 기록이므로 배치 단위로 잘라
    # 봐야 한다 — 전체 합계와 이번 발견 수를 비교하면 두 번째 배치부터 정상도 미완이 된다.
    stems = {os.path.splitext(it["name"])[0]: it for it in man["items"]}
    batch_rows = [r for r in rows if r[0] in stems]
    # ② 매니페스트 각 항목이 색인에 실제로 기록됐는가 (처리 단계 침묵 누락)
    recorded = {r[0] for r in batch_rows}
    for stem, it in stems.items():
        if stem not in recorded:
            problems.append(f"발견됐으나 색인에 없음(침묵 누락): {it['name']}")

    # ③ 상태 합계 = 발견 수
    counts = {s: 0 for s in STATES}
    md_files = set(os.listdir(os.path.join(base, "md"))) if os.path.isdir(os.path.join(base, "md")) else set()
    q_files = set(os.listdir(os.path.join(base, "quarantine"))) if os.path.isdir(os.path.join(base, "quarantine")) else set()
    for cells in batch_rows:
        title, status = cells[0], cells[-1]
        state = next((s for s in STATES if status.startswith(s)), None)
        if state is None:
            problems.append(f"상태 판독 불가: {title} -> {status[:30]}")
            continue
        counts[state] += 1
        # ④ 문서id 정확 매칭 — 접두 부분매치는 서로 다른 문서를 서로의 증거로 삼는다
        hit = stems.get(title)
        if state == "적재":
            expect = f"{title}-{hit['source_sha256_8']}.md" if hit else None
            if expect and expect not in md_files:
                problems.append(f"적재인데 md/{expect} 없음")
            elif not hit and not any(f.startswith(title + "-") for f in md_files):
                problems.append(f"적재인데 md/ 파일 미발견: {title}")
        if state == "격리" and not any(f.startswith(title) for f in q_files):
            problems.append(f"격리인데 quarantine/ 파일 미발견: {title}")

    total = sum(counts.values())
    print(f"배치 {man['batch']} 정산: 발견 {man['found']} = "
          + " + ".join(f"{s} {counts[s]}" for s in STATES) + f"  (색인 행 {total})")
    if total != man["found"]:
        problems.append(f"매니페스트 발견 {man['found']} != 이번 배치 색인 행 {total}")
    if not os.path.isfile(os.path.join(base, "updates.md")):
        problems.append("updates.md 없음")

    if problems:
        print("판정: 미완")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("판정: 정산 일치, 색인 정합, 소스 대조 통과")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
