# Open data

Everything in this folder may be published with the open-source app.

| file | what | license |
|---|---|---|
| `characters.json` | Every character used by the packs (+ their components): pinyin, English definition, decomposition, radical, etymology, and Hanyu's own `note`. | Derived from Make Me a Hanzi `dictionary.txt` (https://github.com/skishore/makemeahanzi), itself derived from Unihan and CJKlib: **LGPL-3.0**. |
| `char-notes.en.tsv` | Hanyu's hand-written English breakdown of each character. | Hanyu project. |
| `hsk-2025.json`, `source/hsk-2025-words.tsv` | The official HSK word list (11,000 words: level, word, pinyin, part of speech), from 《HSK考试大纲》, 中外语言交流合作中心, 2025. | Published syllabus; the data is reproduced as published. |
| `strokes.json` | Stroke order of every character the app teaches: the outline and pen path of each stroke, in order (the format of the Hanzi Writer library). | Derived from Make Me a Hanzi `graphics.txt`, itself derived from Arphic fonts: **Arphic Public License** (`ARPHIC-LICENSE.txt`). |
| `hsk-meanings.tsv` | Hanyu's own English and French meanings of the HSK words (HSK 1 so far). | Hanyu project. |
| `hsk-meanings.cedict.tsv` | English meanings of every other HSK word (HSK 2 to 7-9), taken from CC-CEDICT by `scripts/build_hsk_cedict.py` (shortened; a few written by hand). In `hsk-2025.json` they are marked `"enSource": "cedict"`. | From CC-CEDICT (https://www.mdbg.net/chinese/dictionary?page=cc-cedict): **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/). These meanings, and changes to them, stay under the same license. |
| `measure-words.json` | Which measure words go with which nouns (for exam questions). | Hanyu project. |
| `substitutions.json` | Words that can be swapped in a dialogue, with the words tied to them. | Hanyu project. |

Rebuild: `python3 scripts/extract_hsk_pdf.py <HSK考试大纲.pdf>` (only when a new syllabus comes out), download `https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz`, unzip it and run `python3 -I scripts/build_hsk_cedict.py <cedict_1_0_ts_utf-8_mdbg.txt>`, then `python3 scripts/build_hsk.py`, then download `https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt` and `.../graphics.txt` to a temporary folder and run `python3 -I scripts/build_characters.py <dictionary.txt>` and `python3 -I scripts/build_strokes.py <graphics.txt>`.
