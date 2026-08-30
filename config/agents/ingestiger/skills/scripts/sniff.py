# sniff.py — 매직바이트 형식 판별 (SKILL.md Workflow 1단계의 실행체)
# 사용: uv run python scripts/sniff.py <파일...>
# 출력: <실제형식>|<확장자일치 OK/MISMATCH>|<파일경로>  (한 줄씩)
# 종료코드: 위장 파일이 하나라도 있으면 1
import sys, os

SIGS = [
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole2"),      # doc/xls/ppt/hwp5 공통 컨테이너
    (b"%PDF-", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"PK\x03\x04", "zip"),                              # docx/xlsx/pptx/hwpx 공통
    (b"RIFF", "riff"),                                   # wav
    (b"\xff\xd8\xff", "jpg"),
]
# zip 계열은 내부 항목으로 세분
ZIP_HINTS = [(b"word/", "docx"), (b"xl/", "xlsx"), (b"ppt/", "pptx"),
             (b"Contents/section0.xml", "hwpx"), (b"mimetypeapplication/hwp", "hwpx")]
# ole2 계열 세분 (HWP 5.x는 "HWP Document File" 스트림)
TEXT_HINTS = [(b"MIME-Version", "mhtml"), (b"<?xml", "xml"), (b"{\\rtf", "rtf")]

EXT_OK = {  # 실제형식 -> 허용 확장자
    "pdf": {"pdf"}, "png": {"png"}, "jpg": {"jpg", "jpeg"},
    "docx": {"docx"}, "xlsx": {"xlsx"}, "pptx": {"pptx"}, "hwpx": {"hwpx"},
    "ole2-hwp": {"hwp"}, "ole2-doc": {"doc"}, "ole2-xls": {"xls"}, "ole2-ppt": {"ppt"},
    "ole2": {"doc", "xls", "ppt", "hwp"},  # 하위 스트림 판별 실패 시의 느슨한 폴백
    "wav": {"wav"}, "text": {"md", "txt", "csv"}, "mhtml": {"mht", "mhtml"},
    "xml": {"xml"}, "rtf": {"rtf"}, "zip": {"zip"},
}

def sniff(path):
    with open(path, "rb") as f:
        head = f.read(4096)
    for sig, kind in SIGS:
        if head.startswith(sig):
            if kind == "zip":
                # 앞 64KB만 보면 임베디드 미디어가 앞선 문서에서 세부 판별이 실패한다.
                # zip 목차를 읽어 확정하고, 목차를 못 읽을 때만 바이트 힌트로 물러선다.
                sub = _zip_subtype(path)
                if sub:
                    return sub
                for hint, s in ZIP_HINTS:
                    if hint in head or hint in _more(path):
                        return s
                return "zip"
            if kind == "riff":
                return "wav" if head[8:12] == b"WAVE" else "riff"
            if kind == "ole2":
                # OLE2는 doc/xls/ppt/hwp 공통 껍데기다. 하위 스트림으로 구분하지 않으면
                # xls를 .doc으로 위장해도 통과해 잘못된 변환기로 라우팅된다.
                blob = _more(path)
                if b"HWP Document" in blob:
                    return "ole2-hwp"
                if b"W\x00o\x00r\x00k\x00b\x00o\x00o\x00k" in blob or b"Workbook" in blob:
                    return "ole2-xls"
                if b"PowerPoint Document" in blob:
                    return "ole2-ppt"
                if b"WordDocument" in blob or b"W\x00o\x00r\x00d\x00D\x00o\x00c" in blob:
                    return "ole2-doc"
                return "ole2"
            return kind
    for hint, kind in TEXT_HINTS:
        if hint in head[:256]:
            return kind
    # 한국 실무의 기본 인코딩(cp949/euc-kr)까지 텍스트로 인정한다 —
    # utf-8만 시도하면 엑셀이 내보낸 한국어 CSV가 통째로 '형식 위장' 실패가 된다.
    for enc in ("utf-8", "cp949", "euc-kr"):
        try:
            head.decode(enc)
            return "text"
        except (UnicodeDecodeError, LookupError):
            continue
    return "unknown"

def _more(path):
    with open(path, "rb") as f:
        return f.read(65536)

def _zip_subtype(path):
    """zip 목차(전체 엔트리 목록)로 오피스 계열을 확정한다 — 엔트리 순서에 의존하지 않는다."""
    try:
        import zipfile
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
    except Exception:
        return None
    if any(n.startswith("word/") for n in names):
        return "docx"
    if any(n.startswith("xl/") for n in names):
        return "xlsx"
    if any(n.startswith("ppt/") for n in names):
        return "pptx"
    if any(n.startswith("Contents/") for n in names) or "settings.xml" in names and "version.xml" in names:
        return "hwpx"
    return None

def main(argv):
    bad = 0
    for p in argv:
        if not os.path.isfile(p):
            print(f"MISS|파일 없음|{p}"); bad += 1; continue
        kind = sniff(p)
        ext = os.path.splitext(p)[1].lstrip(".").lower()
        ok = ext in EXT_OK.get(kind, set())
        if not ok:
            bad += 1
        print(f"{kind}|{'OK' if ok else 'MISMATCH:확장자=' + ext}|{p}")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
