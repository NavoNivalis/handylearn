"""构建插件用的离线词库 data/ecdict-mini.json。

数据来源（均为宽松许可）：
  ECDICT   https://github.com/skywind3000/ECDICT        MIT
  ipa-dict https://github.com/open-dict-data/ipa-dict   MIT

需要先下载三个源文件到 data/：
  data/ecdict.csv      （ECDICT 仓库根目录，约 66MB）
  data/ipa_en_US.txt   （ipa-dict data/ 目录）
  data/ipa_en_UK.txt   （ipa-dict data/ 目录）

用法：
    python scripts/build_dict_json.py
"""

import csv
import json

ECDICT_CSV = "data/ecdict.csv"
IPA_US = "data/ipa_en_US.txt"
IPA_UK = "data/ipa_en_UK.txt"
OUTPUT = "data/ecdict-mini.json"

# 词频排名在此之内的一并保留（覆盖日常阅读的绝大部分词）
MAX_FRQ = 30000


def load_ipa(path: str) -> dict[str, str]:
    """读取 ipa-dict 的 `word<TAB>/ipa/` 格式。"""
    result: dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 2:
                result[parts[0].strip().lower()] = parts[1].strip()
    return result


def clean(text: str) -> str:
    """ECDICT 的部分字段用字面量 "\\n" 分隔多行，这里还原成真正的换行。"""
    return text.replace("\\r", "").replace("\\n", "\n").strip()


def main() -> None:
    ipa_us = load_ipa(IPA_US)
    ipa_uk = load_ipa(IPA_UK)

    out: dict[str, dict[str, str]] = {}

    with open(ECDICT_CSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            word = (row.get("word") or "").strip().lower()
            if not word:
                continue

            tag = (row.get("tag") or "").strip()
            try:
                frq = int(row.get("frq") or 0)
            except ValueError:
                frq = 0

            # 考试大纲词 或 高频词 才收录
            if not tag and not (0 < frq <= MAX_FRQ):
                continue

            # 音标只取规范 IPA 来源：美式优先，其次英式，都没有则留空
            # （不用 ECDICT 自带音标——那是旧式注音，会破坏格式统一）
            # ipa-dict 用 ", " 分隔多个读音变体，只取第一个
            ipa = (ipa_us.get(word) or ipa_uk.get(word) or "").split(",")[0].strip()

            out[word] = {
                "ipa": ipa,
                "t": clean(row.get("translation") or ""),  # 中文释义
                "tag": tag,  # zk gk cet4 cet6 ky toefl ielts gre
                "bnc": (row.get("bnc") or "").strip(),  # BNC 语料库词频排名
                "frq": (row.get("frq") or "").strip(),  # 当代语料库词频排名
                "ex": (row.get("exchange") or "").strip(),  # 词形变化
            }

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    with_ipa = sum(1 for entry in out.values() if entry["ipa"])
    print(f"{len(out)} words -> {OUTPUT}")
    print(f"有音标 {with_ipa} ({with_ipa / len(out) * 100:.1f}%)，无音标 {len(out) - with_ipa}")


if __name__ == "__main__":
    main()
