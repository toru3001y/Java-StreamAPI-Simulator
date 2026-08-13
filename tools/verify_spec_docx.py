#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
統合docxの検証。build_spec_docx.py の出力を機械的に照合する。

  1. v0.8 docx がバイト単位で不変であること
  2. ZIP/XML整合（全part存在・XMLとしてパース可能・styleとnumIdが定義済み）
  3. 差分の限定（v0.8の本文要素が削除されていないこと・変更要素が想定どおりであること）
  4. 転記の網羅性（差分mdの全ブロックが第26〜31章に存在すること）
  5. §参照の健全性（全参照が実在する見出しを指すこと。リポジトリ文書への§参照は
     build_spec_docx.is_external_doc_ref による共通判定で除外し、内部／外部を分けて集計する）

使い方:
  python tools/verify_spec_docx.py --base <v0.8.docx> --out <統合.docx> \
      --v09 <v0.9.md> [--v10 <v0.10.md>] [--v11 <v0.11.md>] [--v12 <v0.12.md>] \
      [--v13 <v0.13.md>] [--v14 <v0.14.md>] [--dump <章本文の書き出し先>]

  後段の差分には手前の差分が必要（ビルダーと同じ依存関係。--v14 には --v13、--v13 には --v12、
  --v12 には --v11、--v11 には --v10。省略すると該当章の転記検証が抜けたまま合格し得る）。

  版表記（Draft v0.14 / v1.00 など）は検証結果に影響しない。3の想定変更一覧は
  変更「前」のv0.8本文の断片で照合するため、確定版 v1.00 も同じ引数で検証できる。
"""

import argparse
import difflib
import hashlib
import io
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from build_spec_docx import (parse_markdown, RefResolver, EXC_V09, EXC_V10, EXC_V11,
                             EXC_V12, EXC_V13, EXC_V14, V10_MAPPING_HEADER,
                             is_external_doc_ref, tokenize_inline)

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
FAILS = []
NOTES = []

# v0.8本文で変更されてよい要素の一覧（各要素の元テキストに含まれる一意な断片）。
# ここに無い要素が変更されていたら不合格にする。
EXPECTED_CHANGES = [
    'Draft v0.8 / 2026-08-07',                       # 表紙の版表記
    '文書ステータス：実装基準',                        # 文書ステータス行
    '章セクション1文書概要',                           # 目次（26・27行の追加）
    '項目内容文書名Java Stream API',                  # §1 文書概要表（版・基準日）
    '1.1 Draft v0.8の主な改訂点',                     # §1.1 見出し
    '区分改訂内容文書統合Draft v0.6',                  # §1.1 改訂点表（v0.9・v0.10行）
    '分類対象Stream生成Collection.stream()',          # §4 分類表
    '分類許可する主な構造値参照currentValue',            # §9.1 DSL許可構造表
    '区分主な内容識別snapshot ID',                     # §12.3 Snapshot構造表
    '操作内部状態distinct既出値',                       # §12.5 操作固有状態表
    '対象可視化仕様filter値取得',                       # §14.1 中間操作表
    'メソッド優先度filter()高map()高mapToInt()',       # 付録A.2
    '操作0件時の表示Stream.toList()',                  # 付録B
    '可視化パターン対象生成元型Collection.stream',       # 付録C
    '参照ID資料URLJDK25-STREAM',                      # 付録E
    'Draft v0.8 終了',                                # 巻末
]


def check(cond, msg):
    if cond:
        print('  [OK]   %s' % msg)
    else:
        print('  [FAIL] %s' % msg)
        FAILS.append(msg)


def body_elements(xml_bytes):
    root = ET.fromstring(xml_bytes)
    body = root.find(W + 'body')
    out = []
    for el in body:
        out.append(ET.tostring(el, encoding='unicode'))
    return out


def el_text(x):
    return ''.join(ET.fromstring(x).itertext())


def para_texts(xml_bytes):
    """段落・表を (種別, 本文, スタイル) で列挙する。"""
    root = ET.fromstring(xml_bytes)
    body = root.find(W + 'body')
    out = []
    for el in body:
        tag = el.tag.replace(W, '')
        if tag == 'p':
            pPr = el.find(W + 'pPr')
            style = ''
            numid = None
            if pPr is not None:
                ps = pPr.find(W + 'pStyle')
                if ps is not None:
                    style = ps.get(W + 'val')
                np = pPr.find(W + 'numPr')
                if np is not None:
                    ni = np.find(W + 'numId')
                    numid = ni.get(W + 'val') if ni is not None else None
            out.append(('p', ''.join(t.text or '' for t in el.iter(W + 't')), style, numid))
        elif tag == 'tbl':
            rows = []
            for tr in el.findall(W + 'tr'):
                rows.append([''.join(t.text or '' for t in tc.iter(W + 't'))
                             for tc in tr.findall(W + 'tc')])
            out.append(('tbl', rows, '', None))
    return out


def strip_md(s):
    return ''.join(seg for seg, _, _ in tokenize_inline(s))


def collect_valid_sections(texts):
    """本文の見出しから、実在する節・章番号の集合を作る。"""
    valid = set()
    for rec in texts:
        if rec[0] != 'p' or not rec[2].startswith('Heading'):
            continue
        t = rec[1]
        # 「12.3 Snapshot構造」形式（節）と「12. 状態モデル」形式（章）の両方を拾う
        m = re.match(r'^(\d+(?:\.\d+)+)\s', t)
        if m:
            valid.add(m.group(1))
        m = re.match(r'^(\d+)\.\s', t)
        if m:
            valid.add(m.group(1))
    return valid


def classify_section_refs(alltext):
    """本文中の§参照を内部参照 / 外部文書参照へ振り分ける。

    リポジトリ文書（完了報告・判断記録・実装指示書）への§参照は本書の節番号ではない。
    判定はビルダーと**同じ単一定義源**（build_spec_docx.is_external_doc_ref）を使う。
    個別のendswith条件をverify側に持つと、ビルダーのEXC_V*と乖離して
    「保護はされているが内部参照として集計される」状態になる。
    """
    refs, external = {}, {}
    for m in re.finditer(r'§(\d+(?:\.\d+)*)', alltext):
        ctx = alltext[max(0, m.start() - 40):m.start()]
        target = external if is_external_doc_ref(ctx) else refs
        target.setdefault(m.group(1), 0)
        target[m.group(1)] += 1
    return refs, external


def unresolved_section_refs(alltext, valid):
    """実在する見出しを指さない内部§参照（未解決参照）を返す。"""
    refs, _ = classify_section_refs(alltext)
    return sorted(r for r in refs if r not in valid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--v09', required=True)
    ap.add_argument('--v10')
    ap.add_argument('--v11')
    ap.add_argument('--v12')
    ap.add_argument('--v13')
    ap.add_argument('--v14')
    ap.add_argument('--dump')
    ap.add_argument('--base-sha')
    args = ap.parse_args()

    if args.v11 and not args.v10:
        raise SystemExit('--v11 には --v10 が必要です（省略すると第27章の転記検証が抜ける）')
    if args.v12 and not args.v11:
        raise SystemExit('--v12 には --v11 が必要です（省略すると第28章の転記検証が抜ける）')
    if args.v13 and not args.v12:
        raise SystemExit('--v13 には --v12 が必要です（省略すると第29章の転記検証が抜ける）')
    if args.v14 and not args.v13:
        raise SystemExit('--v14 には --v13 が必要です（省略すると第30章の転記検証が抜ける）')

    if args.v10:
        # §20 Phase表へのPhase 7行追加はapply_v10_pointers（--v10指定時）だけが行う。
        # 無条件に期待するとv0.9単独版の検証が常に偽陽性で不合格になる
        EXPECTED_CHANGES.append('Phase実装内容完了条件1React + TS + Vite')
    if args.v11:
        # v0.11は付録A.4（Collector / Collectors表）へも行を追加する
        EXPECTED_CHANGES.append('メソッド優先度Collectors.toList() / toSet()')

    print('=== 1. v0.8 docx の不変性 ===')
    sha = hashlib.sha256(open(args.base, 'rb').read()).hexdigest()
    print('  SHA-256 = %s' % sha)
    if args.base_sha:
        check(sha == args.base_sha, 'ビルド前後でハッシュ一致')
    else:
        NOTES.append('v0.8 SHA-256 = %s' % sha)

    zb = zipfile.ZipFile(args.base)
    zo = zipfile.ZipFile(args.out)

    print('\n=== 2. ZIP / XML 整合 ===')
    check(set(zb.namelist()) == set(zo.namelist()),
          'part構成が一致（%d件）' % len(zo.namelist()))
    for part in ('word/document.xml', 'word/numbering.xml', 'word/styles.xml',
                 'docProps/core.xml', 'docProps/custom.xml'):
        try:
            ET.fromstring(zo.read(part))
            ok = True
        except Exception as e:                                  # noqa: BLE001
            ok = False
            print('      %s: %s' % (part, e))
        check(ok, '%s がXMLとしてパース可能' % part)

    doc_b = zb.read('word/document.xml')
    doc_o = zo.read('word/document.xml')
    check(zb.read('word/media/rId84.png') == zo.read('word/media/rId84.png'),
          '画像 media/rId84.png がバイト一致')

    # style / numId の妥当性
    styles = set(re.findall(r'w:styleId="([^"]+)"',
                            zo.read('word/styles.xml').decode('utf-8')))
    used_styles = set(re.findall(r'<w:pStyle w:val="([^"]+)"/>', doc_o.decode('utf-8')))
    check(used_styles <= styles, '使用pStyleがすべてstyles.xmlに定義済み（未定義: %s）'
          % (sorted(used_styles - styles) or 'なし'))
    defined_num = set(re.findall(r'<w:num w:numId="(\d+)"',
                                 zo.read('word/numbering.xml').decode('utf-8')))
    used_num = set(re.findall(r'<w:numId w:val="(\d+)"/>', doc_o.decode('utf-8')))
    check(used_num <= defined_num, '使用numIdがすべてnumbering.xmlに定義済み（未定義: %s）'
          % (sorted(used_num - defined_num) or 'なし'))

    print('\n=== 3. 差分の限定（v0.8本文の保全）===')
    eb, eo = body_elements(doc_b), body_elements(doc_o)
    sm = difflib.SequenceMatcher(None, eb, eo, autojunk=False)
    deleted, replaced, inserted = [], [], 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'delete':
            deleted += eb[i1:i2]
        elif tag == 'replace':
            replaced += list(zip(eb[i1:i2], eo[j1:j2]))
            if (i2 - i1) < (j2 - j1):
                inserted += (j2 - j1) - (i2 - i1)
        elif tag == 'insert':
            inserted += j2 - j1
    check(not deleted, 'v0.8の本文要素が削除されていない（削除 %d 件）' % len(deleted))
    for old in deleted[:5]:
        print('      削除: %s' % el_text(old)[:70])
    print('  v0.8要素 %d → 統合後 %d（新規 %d / 変更 %d）'
          % (len(eb), len(eo), inserted, len(replaced)))
    print('  変更された既存要素:')
    actual = []
    for old, new in replaced:
        ot, nt = el_text(old), el_text(new)
        added = nt[len(ot):] if nt.startswith(ot) else '(内容置換)'
        sig = next((k for k in EXPECTED_CHANGES if k in ot), None)
        actual.append(sig if sig else '★未知: ' + ot[:40])
        print('    - [%s] %s' % (sig or '未知', ot[:46].replace('\n', ' ')))
        print('        → 追加/変更: %s' % added[:78].replace('\n', ' '))
    unknown = [a for a in actual if a.startswith('★')]
    dup = [k for k in set(actual) if actual.count(k) > 1]
    missing = [k for k in EXPECTED_CHANGES if k not in actual]
    check(not unknown, '想定外の要素が変更されていない（%s）' % (unknown or 'なし'))
    check(not missing, '想定した変更がすべて発生している（未発生: %s）' % (missing or 'なし'))
    check(not dup, '1つの想定へ複数の変更が寄っていない（重複: %s）' % (dup or 'なし'))

    print('\n=== 4. 転記の網羅性 ===')
    texts = para_texts(doc_o)
    heads = [(t[1], t[2]) for t in texts if t[0] == 'p' and t[2].startswith('Heading')]
    ch_start = {}
    for idx, rec in enumerate(texts):
        if rec[0] == 'p' and rec[2] == 'Heading1':
            if re.match(r'^(26|27|28|29|30|31)\. ', rec[1]):
                ch_start[rec[1][:2]] = idx
            elif rec[1].startswith('付録A'):
                ch_start['付録'] = idx
    exc_map = {'26': EXC_V09, '27': EXC_V10, '28': EXC_V11, '29': EXC_V12, '30': EXC_V13,
               '31': EXC_V14}
    next_ch = {'26': '27', '27': '28', '28': '29', '29': '30', '30': '31', '31': None}
    for ch, mdpath in (('26', args.v09), ('27', args.v10), ('28', args.v11), ('29', args.v12),
                       ('30', args.v13), ('31', args.v14)):
        if not mdpath:
            continue
        start = ch_start[ch]
        end = None
        nc = next_ch[ch]
        while nc and end is None:
            end = ch_start.get(nc)
            nc = next_ch[nc]
        if end is None:
            end = ch_start.get('付録', len(texts))
        seg = texts[start:end]
        segtext = '\n'.join(t[1] if t[0] == 'p' else
                            '\n'.join('|'.join(r) for r in t[1]) for t in seg)
        blocks = parse_markdown(open(mdpath, encoding='utf-8').read())
        res = RefResolver(int(ch), exc_map[ch])
        missing, n_items, n_rows, n_para, n_head = [], 0, 0, 0, 0
        for b in blocks:
            if b['k'] == 'h':
                if b['lvl'] == 1:
                    continue
                n_head += 1
                probe = strip_md(res(re.sub(r'^[\d.]+\s*', '', b['text'])))
            elif b['k'] == 'p':
                n_para += 1
                probe = strip_md(res(b['text']))
            elif b['k'] in ('ul', 'ol'):
                for item in b['items']:
                    it = item[1]
                    n_items += 1
                    if strip_md(res(it)) not in segtext:
                        missing.append(('list', it[:50]))
                continue
            elif b['k'] == 'tbl':
                v08col = b['rows'][0] == V10_MAPPING_HEADER
                for ri, row in enumerate(b['rows']):
                    n_rows += 1
                    for ci, c in enumerate(row):
                        if not c:
                            continue
                        pol = 'v08' if (v08col and ci == 0 and ri > 0) else 'own'
                        if strip_md(res(c, pol)) not in segtext:
                            missing.append(('cell', c[:50]))
                continue
            else:
                for l in b['lines']:
                    if l.strip() and strip_md(res(l)) not in segtext:
                        missing.append(('code', l[:50]))
                continue
            if probe not in segtext:
                missing.append((b['k'], probe[:50]))
        doc_heads = sum(1 for t, _, s, _ in seg if s in ('Heading2', 'Heading3'))
        doc_tbl_rows = sum(len(t[1]) for t in seg if t[0] == 'tbl')
        doc_items = sum(1 for t in seg if t[0] == 'p' and t[3])
        print('  第%s章: md見出し%d / docx見出し%d, md表行%d / docx表行%d, '
              'mdリスト%d / docxリスト%d, md段落%d'
              % (ch, n_head, doc_heads, n_rows, doc_tbl_rows, n_items, doc_items, n_para))
        check(n_head == doc_heads, '第%s章 見出し数が一致' % ch)
        check(n_rows == doc_tbl_rows, '第%s章 表の行数が一致' % ch)
        check(n_items == doc_items, '第%s章 リスト項目数が一致' % ch)
        check(not missing, '第%s章 全ブロックが本文に存在（欠落 %d 件）' % (ch, len(missing)))
        for kind, s in missing[:10]:
            print('      欠落[%s] %s' % (kind, s))

    print('\n=== 5. §参照の健全性 ===')
    valid = collect_valid_sections(texts)
    alltext = '\n'.join(t[1] if t[0] == 'p' else
                        '\n'.join('|'.join(r) for r in t[1]) for t in texts)
    refs, external = classify_section_refs(alltext)
    bad = unresolved_section_refs(alltext, valid)
    check(not bad, '全§参照が実在する見出しを指す（未解決: %s）' % (bad or 'なし'))
    print('  内部参照（検証対象）: %d種 / 延べ %d件' % (len(refs), sum(refs.values())))
    print('  外部文書参照（除外）: %d種 / 延べ %d件%s'
          % (len(external), sum(external.values()),
             ('（' + ' / '.join('§%s×%d' % (k, v) for k, v in sorted(external.items())) + '）')
             if external else ''))
    check('v0.8 §' not in alltext, '「v0.8 §」表記が残っていない')

    if args.dump:
        with io.open(args.dump, 'w', encoding='utf-8') as f:
            for t in texts:
                if t[0] == 'p':
                    f.write('[%s]%s %s\n' % (t[2], ('#' + t[3]) if t[3] else '', t[1]))
                else:
                    f.write('[TABLE]\n')
                    for r in t[1]:
                        f.write('   | ' + ' | '.join(r) + '\n')
        print('\n本文ダンプ: %s' % args.dump)

    print('\n===== 結果: %s（失敗 %d 件）====='
          % ('合格' if not FAILS else '不合格', len(FAILS)))
    for n in NOTES:
        print('  note: %s' % n)
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
