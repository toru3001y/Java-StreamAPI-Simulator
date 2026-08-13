#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Java Stream API 可視化シミュレーター 仕様書 統合docxビルダー

Draft v0.8 の docx（Pandoc生成）へ、v0.9（Gatherers差分）・v0.10（Phase 6手動連携差分）・
v0.11（Collectors.toMap差分）・v0.12（teeing × toMap差分）・v0.13（数値加算merge差分）・
v0.14（unmodifiable系Collector差分）の Markdown原本を章として取り込み、
1ファイルで読める統合版 docx を生成する。

方針:
  - v0.8 本文（第1〜25章・付録A〜F）は書き換えない。既存段落・表行への「追加」のみ行う。
  - 差分本文は第26章（v0.9）・第27章（v0.10）・第28章（v0.11）・第29章（v0.12）・
    第30章（v0.13）・第31章（v0.14）として末尾へ新設する。
  - v0.8 側の該当箇所には「→ §26.x / §27.x / §28.x 参照」の追加行（ポインタ）を挿入する
    （v0.12 / v0.13 / v0.14はv0.8本文への注記を追加せず、章の追加のみ）。
  - リポジトリ内の別文書（完了報告・判断記録・実装指示書）への§参照は本書の節ではないため、
    EXC_V* と EXTERNAL_DOC_REF_PREFIXES で章番号への読み替えから除外する。
    保護漏れは assert_external_refs_protected がビルド時に検出し、
    verify 側も同じ EXTERNAL_DOC_REF_PREFIXES で内部参照の集計から除外する。

制約:
  - pandoc / python-docx を使わず、Python標準ライブラリのみで word/document.xml を
    直接操作する。これにより v0.8 由来のXMLは挿入箇所以外バイト単位で不変になる。

使い方:
  python tools/build_spec_docx.py \
      --base  docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx \
      --v09   docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md \
      --v10   docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md \
      --v11   docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md \
      --v12   docs/Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md \
      --v13   docs/Java_Stream_API_Visualization_Spec_v0.13_NumericMerge.md \
      --v14   docs/Java_Stream_API_Visualization_Spec_v0.14_Unmodifiable.md \
      --date-label 2026-08-14 \
      --out   docs/Java_Stream_API_Visualization_Spec_v0.14.docx

  後段の差分（--v14 → --v13 → --v12 → --v11 → --v10）を省略すると、その手前までの統合を
  生成する（--v14 には --v13、--v13 には --v12、--v12 には --v11、--v11 には --v10 が必要）。
  出力は決定的で、同じ入力からは常にバイト単位で同一のdocxが得られる。

検証:
  python tools/verify_spec_docx.py --base <v0.8.docx> --out <統合.docx> \
      --v09 <v0.9.md> --v10 <v0.10.md> --v11 <v0.11.md> --v12 <v0.12.md> \
      --v13 <v0.13.md> --v14 <v0.14.md> --base-sha <v0.8のSHA-256>
"""

import argparse
import hashlib
import io
import os
import re
import sys
import zipfile

# ---------------------------------------------------------------- 定数（v0.8のXMLパターン）

FONT = ('<w:rFonts w:ascii="Noto Sans CJK JP" w:hAnsi="Noto Sans CJK JP"'
        ' w:eastAsia="Noto Sans CJK JP" w:cs="Noto Sans CJK JP"/>')
MONO = ('<w:rFonts w:ascii="Noto Sans Mono CJK JP" w:hAnsi="Noto Sans Mono CJK JP"'
        ' w:eastAsia="Noto Sans Mono CJK JP" w:cs="Noto Sans Mono CJK JP"/>')
VERB = '<w:rStyle w:val="VerbatimChar"/>'

CELL_RPR = FONT + '<w:color w:val="1B2430"/><w:sz w:val="17"/>'
HEAD_RPR = FONT + '<w:b/><w:color w:val="183153"/><w:sz w:val="17"/>'

TCMAR = ('<w:tcMar><w:top w:w="80" w:type="dxa"/><w:start w:w="120" w:type="dxa"/>'
         '<w:bottom w:w="80" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tcMar>')
CELL_PPR = ('<w:pPr><w:pStyle w:val="Compact"/><w:keepLines w:val="0"/>'
            '<w:spacing w:before="0" w:after="30" w:line="259" w:lineRule="auto"/>'
            '<w:jc w:val="left"/></w:pPr>')
HEAD_PPR = CELL_PPR.replace('w:val="left"', 'w:val="center"')

TBLPR = ('<w:tblPr><w:tblStyle w:val="Table"/><w:tblW w:type="dxa" w:w="9971"/>'
         '<w:tblLayout w:type="fixed"/>'
         '<w:tblLook w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0"'
         ' w:noHBand="0" w:noVBand="0" w:val="0020"/>'
         '<w:jc w:val="start"/><w:tblInd w:w="120" w:type="dxa"/>'
         '<w:tblBorders>'
         '<w:top w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'
         '<w:left w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'
         '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'
         '<w:right w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'
         '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'
         '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="B8C2CF"/>'
         '</w:tblBorders></w:tblPr>')

TABLE_TOTAL_W = 9971

SRC_PPR = ('<w:pPr><w:pStyle w:val="SourceCode"/><w:keepLines/><w:shd w:fill="F4F6F9"/>'
           '<w:spacing w:before="60" w:after="100"/>'
           '<w:ind w:left="227" w:right="227"/></w:pPr>')

LIST_IND = {0: '<w:ind w:left="540" w:hanging="271"/>',
            1: '<w:ind w:left="880" w:hanging="271"/>'}

NOTE_V09 = '【v0.9による追加】'
NOTE_V10 = '【v0.10による変更】'
NOTE_V11 = '【v0.11による追加】'


# ---------------------------------------------------------------- 低レベルXMLユーティリティ

def xesc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def wt(s):
    return '<w:t xml:space="preserve">%s</w:t>' % xesc(s)


def _with_bold(rpr_inner):
    """rPr内容へ <w:b/> を rFonts の直後（無ければ先頭）に挿入する。"""
    if '<w:b/>' in rpr_inner:
        return rpr_inner
    m = re.search(r'<w:rFonts[^>]*/>', rpr_inner)
    if m:
        return rpr_inner[:m.end()] + '<w:b/>' + rpr_inner[m.end():]
    return '<w:b/>' + rpr_inner


def _strip_style(rpr_inner):
    out = re.sub(r'<w:rStyle[^>]*/>', '', rpr_inner)
    return re.sub(r'<w:b/>', '', out)


def tokenize_inline(text):
    """`**bold**` と `` `code` `` を (text, bold, code) のトークン列へ分解する。"""
    tokens = []
    bold = False
    for i, seg in enumerate(text.split('`')):
        if i % 2 == 1:                       # バッククォート内 = コード
            if seg:
                tokens.append((seg, bold, True))
            continue
        parts = seg.split('**')
        for j, part in enumerate(parts):
            if j > 0:
                bold = not bold
            if part:
                tokens.append((part, bold, False))
    return tokens


def runs(text, base_rpr=FONT, code_font=None):
    """インライン記法を解決した <w:r> 列を返す。"""
    base = _strip_style(base_rpr)
    out = []
    for seg, bold, code in tokenize_inline(text):
        rpr = base
        if bold:
            rpr = _with_bold(rpr)
        if code:
            if code_font:
                rpr = re.sub(r'<w:rFonts[^>]*/>', code_font, rpr)
            rpr = VERB + rpr
        out.append('<w:r><w:rPr>%s</w:rPr>%s</w:r>' % (rpr, wt(seg)))
    if not out:
        out.append('<w:r><w:rPr>%s</w:rPr>%s</w:r>' % (base, wt('')))
    return ''.join(out)


def iter_elements(s, tag, start=0, end=None):
    """s の [start,end) 範囲にある tag 要素の (開始, 終了) を、入れ子を数えつつ列挙する。"""
    if end is None:
        end = len(s)
    open_pat = re.compile(r'<' + tag + r'(?:\s[^>]*)?>')
    close = '</' + tag + '>'
    i = start
    while True:
        m = open_pat.search(s, i, end)
        if not m:
            return
        depth, j = 1, m.end()
        while depth:
            no = open_pat.search(s, j, end)
            nc = s.find(close, j, end)
            if nc == -1:
                raise ValueError('閉じタグが見つからない: %s' % tag)
            if no and no.start() < nc:
                depth += 1
                j = no.end()
            else:
                depth -= 1
                j = nc + len(close)
        yield (m.start(), j)
        i = j


def element_span(s, tag, open_start):
    for a, b in iter_elements(s, tag, open_start):
        return a, b
    raise ValueError('要素が取れない: %s' % tag)


# ---------------------------------------------------------------- 文書手術

class Surgeon:
    """document.xml を文字列として編集する。すべての検索は一意性を検証する。"""

    def __init__(self, xml):
        self.xml = xml
        self.ops = 0

    def _pos(self, needle):
        n = self.xml.count(needle)
        if n != 1:
            raise AssertionError('アンカーが一意でない（%d件）: %r' % (n, needle[:60]))
        return self.xml.find(needle)

    def enclosing(self, tag, needle):
        pos = self._pos(needle)
        starts = [m.start() for m in
                  re.finditer(r'<' + tag + r'(?:\s[^>]*)?>', self.xml, 0)
                  if m.start() <= pos]
        for st in reversed(starts):
            a, b = element_span(self.xml, tag, st)
            if a <= pos < b:
                return a, b
        raise AssertionError('包含要素が見つからない: %s / %r' % (tag, needle[:40]))

    def insert_after(self, tag, needle, frag):
        _, b = self.enclosing(tag, needle)
        self.xml = self.xml[:b] + frag + self.xml[b:]
        self.ops += 1

    def insert_before(self, tag, needle, frag):
        a, _ = self.enclosing(tag, needle)
        self.xml = self.xml[:a] + frag + self.xml[a:]
        self.ops += 1

    def replace_text(self, old, new):
        """<w:t> 内テキストの置換。xml:space属性の有無を問わない。"""
        needle = '>' + xesc(old) + '</w:t>'
        pos = self._pos(needle)
        self.xml = (self.xml[:pos] + '>' + xesc(new) + '</w:t>'
                    + self.xml[pos + len(needle):])
        self.ops += 1

    def replace_text_in(self, scope_tag, scope_anchor, old, new):
        """scope_anchor を含む scope_tag 要素の内側に限定してテキスト置換する。"""
        a, b = self.enclosing(scope_tag, scope_anchor)
        seg = self.xml[a:b]
        needle = '>' + xesc(old) + '</w:t>'
        if seg.count(needle) != 1:
            raise AssertionError('範囲内で一意でない（%d件）: %r' % (seg.count(needle), old))
        seg = seg.replace(needle, '>' + xesc(new) + '</w:t>')
        self.xml = self.xml[:a] + seg + self.xml[b:]
        self.ops += 1

    # --- 表操作 ---------------------------------------------------

    def _table_of(self, needle):
        return self.enclosing('w:tbl', needle)

    def append_rows(self, needle, rows):
        """needle を含む表の末尾へ行を追加する（最終行を雛形として複製）。"""
        a, b = self._table_of(needle)
        tbl = self.xml[a:b]
        trs = list(iter_elements(tbl, 'w:tr'))
        tmpl = tbl[trs[-1][0]:trs[-1][1]]
        frag = ''.join(clone_row(tmpl, r) for r in rows)
        ins = a + trs[-1][1]
        self.xml = self.xml[:ins] + frag + self.xml[ins:]
        self.ops += 1

    def append_rows_after(self, needle, rows):
        """needle の直後にある最初の表の末尾へ行を追加する。

        表内のセルがインラインコードでrun分割されていて表内に一意な平文が取れない場合に、
        直前の段落をアンカーとして使う。
        """
        pos = self._pos(needle)
        ta = self.xml.find('<w:tbl>', pos)
        if ta == -1:
            raise AssertionError('後続の表が無い: %r' % needle[:40])
        a, b = element_span(self.xml, 'w:tbl', ta)
        tbl = self.xml[a:b]
        trs = list(iter_elements(tbl, 'w:tr'))
        tmpl = tbl[trs[-1][0]:trs[-1][1]]
        frag = ''.join(clone_row(tmpl, r) for r in rows)
        ins = a + trs[-1][1]
        self.xml = self.xml[:ins] + frag + self.xml[ins:]
        self.ops += 1

    def insert_rows_before(self, needle, rows):
        """needle を含む行の直前へ行を挿入する（その行を雛形として複製）。"""
        ra, rb = self.enclosing('w:tr', needle)
        tmpl = self.xml[ra:rb]
        frag = ''.join(clone_row(tmpl, r) for r in rows)
        self.xml = self.xml[:ra] + frag + self.xml[ra:]
        self.ops += 1

    def append_body(self, frag):
        """sectPr の直前（本文末尾）へ追加する。"""
        m = re.search(r'<w:sectPr(?:\s[^>]*)?>', self.xml)
        if not m:
            raise AssertionError('sectPr が無い')
        self.xml = self.xml[:m.start()] + frag + self.xml[m.start():]
        self.ops += 1

    def insert_chapter_before(self, needle, frag):
        """needle を含む段落の直前（先行するbookmarkStartより前）へ章を挿入する。

        第26・27章は本文の章であり、付録A〜Fより前に置く。目次の並びとも一致させる。
        """
        a, _ = self.enclosing('w:p', needle)
        # 直前に連続する bookmarkStart は次章のアンカーなので、その手前へ入れる
        while True:
            m = re.search(r'<w:bookmarkStart(?:\s[^>]*)?/>$', self.xml[:a])
            if not m:
                break
            a = m.start()
        self.xml = self.xml[:a] + frag + self.xml[a:]
        self.ops += 1


def clone_row(tr_xml, cells):
    """既存行のXMLを雛形に、セル本文だけ差し替えた <w:tr> を作る。"""
    tcs = [tr_xml[a:b] for a, b in iter_elements(tr_xml, 'w:tc')]
    if len(tcs) != len(cells):
        raise AssertionError('列数不一致: 雛形%d / 指定%d' % (len(tcs), len(cells)))
    out = ['<w:tr><w:trPr><w:cantSplit w:val="true"/></w:trPr>']
    for tc, text in zip(tcs, cells):
        m = re.search(r'<w:tcPr>.*?</w:tcPr>', tc, re.S)
        tcpr = m.group(0) if m else ''
        pa, pb = next(iter(iter_elements(tc, 'w:p')))
        p = tc[pa:pb]
        mp = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S)
        ppr = mp.group(0) if mp else ''
        mr = re.search(r'<w:rPr>(.*?)</w:rPr>', p, re.S)
        base = mr.group(1) if mr else FONT
        out.append('<w:tc>%s<w:p>%s%s</w:p></w:tc>' % (tcpr, ppr, runs(text, base)))
    out.append('</w:tr>')
    return ''.join(out)


# ---------------------------------------------------------------- 段落・表の生成

def para(text, style, first=False):
    return '<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>%s</w:p>' % (style, runs(text))


def heading(text, lvl, bookmark=None, bid=None):
    p = '<w:p><w:pPr><w:pStyle w:val="Heading%d"/></w:pPr>%s</w:p>' % (lvl, runs(text))
    if bookmark:
        p = ('<w:bookmarkStart w:id="%d" w:name="%s"/>' % (bid, bookmark)) + p + \
            ('<w:bookmarkEnd w:id="%d"/>' % bid)
    return p


def list_item(text, numid, ilvl=0):
    return ('<w:p><w:pPr><w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>'
            '<w:pStyle w:val="Compact"/>'
            '<w:spacing w:after="80" w:line="300" w:lineRule="auto"/>%s</w:pPr>%s</w:p>'
            % (ilvl, numid, LIST_IND[ilvl], runs(text)))


def source_block(lines):
    body = ''
    for i, ln in enumerate(lines):
        if i:
            body += '<w:br/>'
        body += wt(ln)
    return ('<w:p>%s<w:r><w:rPr>%s%s</w:rPr>%s</w:r></w:p>'
            % (SRC_PPR, VERB, MONO, body))


def _disp_width(s):
    """全角を2・半角を1として表示幅を数える。"""
    return sum(2 if ord(c) > 0x2E80 else 1 for c in s)


def _plain(s):
    """幅計算のため、インライン記法のマーカーを取り除く。"""
    return ''.join(seg for seg, _, _ in tokenize_inline(s))


def _longest_run(s):
    """途中で折り返せない最長のラテン文字列（`string`・`§27.4.3` 等）の長さ。

    日本語は任意位置で折り返せるので下限の根拠にしない。
    """
    parts = re.findall(r'[0-9A-Za-z_§.\-+()\[\]{}<>=~!?\'"`@#$%^&*]+', s)
    return max([len(p) for p in parts] or [0])


# 表示幅1単位あたりのdxa（Noto Sans CJK JP sz=17 ≒ 8.5pt での概算）
_DXA_PER_UNIT = 100         # 8.5pt のラテン文字1字 ≒ 4.7pt ≒ 94dxa。余裕を見て100
_MIN_COL_DXA = 1000         # どの列もこれ以上は確保する
_MAX_FLOOR_DXA = 3000       # 1列の下限が全幅を食い潰さないための頭打ち
_FLOOR_BUDGET = 0.75        # 下限の合計が全幅に占めてよい割合


def _widths(rows):
    """列ごとのグリッド幅を決める。

    最長セルの表示幅で按分したうえで、
      - 折り返せないラテン文字列（`string`・`§27.4.3` 等）が収まる幅
      - ヘッダー文字列が収まる幅
      - 全列共通の下限
    を満たすよう再配分する。単純な按分だけだと「型」「本書」「優先度」のような
    短い列が潰れ、1〜2文字ずつ改行される。
    """
    ncol = len(rows[0])
    cols = [[_plain(r[c]) for r in rows] for c in range(ncol)]
    weights, floors = [], []
    for c in range(ncol):
        longest = max(_disp_width(x) for x in cols[c])
        weights.append(max(6.0, min(float(longest), 110.0)))
        need = max(max(_longest_run(x) for x in cols[c]),
                   _disp_width(cols[c][0]))              # ヘッダーは折らない
        floors.append(float(min(max(_MIN_COL_DXA, need * _DXA_PER_UNIT + 320),
                                _MAX_FLOOR_DXA)))

    # 下限の合計が広がりすぎると按分が意味を失うので、全体を縮める
    budget = TABLE_TOTAL_W * _FLOOR_BUDGET
    if sum(floors) > budget:
        k = budget / sum(floors)
        floors = [f * k for f in floors]

    total = sum(weights)
    ws = [TABLE_TOTAL_W * w / total for w in weights]

    # 下限割れの分を、余裕のある列から比例配分で移す
    for _ in range(30):
        deficit = [max(0.0, floors[i] - ws[i]) for i in range(ncol)]
        need = sum(deficit)
        if need < 1.0:
            break
        surplus = [max(0.0, ws[i] - floors[i]) for i in range(ncol)]
        spare = sum(surplus)
        if spare < 1.0:
            break
        take = min(need, spare)
        ws = [ws[i] - take * surplus[i] / spare + take * deficit[i] / need
              for i in range(ncol)]

    ws = [int(round(x)) for x in ws]
    ws[-1] += TABLE_TOTAL_W - sum(ws)
    return ws


def table(rows):
    """1行目をヘッダーとする表を、v0.8と同じ書式で生成する。"""
    ws = _widths(rows)
    out = [TBLPR, '<w:tblGrid>']
    out += ['<w:gridCol w:w="%d"/>' % w for w in ws]
    out.append('</w:tblGrid>')
    for ri, row in enumerate(rows):
        head = (ri == 0)
        trpr = ('<w:trPr><w:tblHeader w:val="true"/><w:cantSplit w:val="true"/></w:trPr>'
                if head else '<w:trPr><w:cantSplit w:val="true"/></w:trPr>')
        out.append('<w:tr>' + trpr)
        for ci, cell in enumerate(row):
            shd = 'E8EEF5' if head else 'FFFFFF'
            ppr = HEAD_PPR if head else CELL_PPR
            rpr = HEAD_RPR if head else CELL_RPR
            out.append('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s'
                       '<w:vAlign w:val="center"/><w:shd w:fill="%s"/></w:tcPr>'
                       '<w:p>%s%s</w:p></w:tc>'
                       % (ws[ci], TCMAR, shd, ppr, runs(cell, rpr)))
        out.append('</w:tr>')
    return '<w:tbl>' + ''.join(out) + '</w:tbl>'


# ---------------------------------------------------------------- Markdownパーサ

def parse_markdown(text):
    """差分文書のMarkdownを block 列へ変換する。使用記法は見出し/箇条書き/番号付き/表/コード/段落。"""
    lines = text.replace('\r\n', '\n').split('\n')
    blocks = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue

        # コードフェンス
        if ln.lstrip().startswith('```'):
            i += 1
            buf = []
            while i < len(lines) and not lines[i].lstrip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            while buf and not buf[-1].strip():
                buf.pop()
            blocks.append({'k': 'code', 'lines': buf})
            continue

        # 見出し
        m = re.match(r'^(#{1,6})\s+(.*)$', ln)
        if m:
            blocks.append({'k': 'h', 'lvl': len(m.group(1)), 'text': m.group(2).strip()})
            i += 1
            continue

        # 表
        if ln.lstrip().startswith('|') and i + 1 < len(lines) \
                and re.match(r'^\s*\|[\s:|-]+\|\s*$', lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith('|'):
                raw = lines[i].strip()
                if not re.match(r'^\|[\s:|-]+\|$', raw):
                    cells = [c.strip() for c in raw.strip('|').split('|')]
                    rows.append(cells)
                i += 1
            width = max(len(r) for r in rows)
            rows = [r + [''] * (width - len(r)) for r in rows]
            blocks.append({'k': 'tbl', 'rows': rows})
            continue

        # リスト
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', ln)
        if m:
            ordered = not m.group(2) in ('-', '*')
            items = []
            while i < len(lines):
                m2 = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', lines[i])
                if not m2:
                    if lines[i].strip() and lines[i].startswith(('    ', '\t')) and items:
                        items[-1] = (items[-1][0], items[-1][1] + lines[i].strip(),
                                     items[-1][2])
                        i += 1
                        continue
                    break
                ilvl = 1 if len(m2.group(1)) >= 2 else 0
                # 項目ごとのマーカー種別を保持する。入れ子で親と種別が異なる例が
                # 両差分文書に16箇所あり（番号付きの下に箇条書き／その逆の双方）、
                # ブロック単位の種別だけでは記号が入れ替わってしまう。
                items.append((ilvl, m2.group(3).strip(), m2.group(2) not in ('-', '*')))
                i += 1
            blocks.append({'k': 'ol' if ordered else 'ul', 'items': items})
            continue

        # 段落
        buf = [ln.strip()]
        i += 1
        while i < len(lines) and lines[i].strip() \
                and not re.match(r'^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\s*\||```)', lines[i]):
            buf.append(lines[i].strip())
            i += 1
        blocks.append({'k': 'p', 'text': ''.join(buf)})
    return blocks


# ---------------------------------------------------------------- §参照の読み替え

PROT_A, PROT_B = '\x01', '\x02'


def _prot(s):
    return PROT_A + s + PROT_B


def _unprot(s):
    return s.replace(PROT_A, '').replace(PROT_B, '')


class RefResolver:
    """差分文書内の「§N」を統合docxの節番号へ読み替える。

    規則（適用順）:
      1. 明示的例外リスト（原文の一意な文脈で指定）
      2. 「v0.8 §X」「Draft v0.8 §X」→「§X」（v0.8参照。番号は不変）
      3. 「v0.10 §X」→「§27.X」、「v0.9 §X」→「§26.X」
      4. 「§X」で X の先頭番号が11以上 → v0.8参照（差分文書の節は10までのため）
      5. 残りの「§X」→ 自章の節（§<chapter>.X）

    確定した参照は不透明なトークンへ退避し、後続の規則で再マッチしないようにする。
    """

    def __init__(self, chapter, exceptions):
        self.chapter = chapter
        self.exceptions = exceptions
        self.used = set()

    def apply_exceptions(self, text):
        for ctx, rep in self.exceptions:
            if ctx in text:
                if text.count(ctx) != 1:
                    raise AssertionError('例外文脈が一意でない: %r' % ctx[:50])
                text = text.replace(ctx, rep)
                self.used.add(ctx)
        return text

    def __call__(self, text, policy='own'):
        toks = []

        def prot(s):
            toks.append(s)
            return '%d' % (len(toks) - 1)

        if PROT_A in text or PROT_B in text:
            raise AssertionError('制御文字が原文に混入')
        text = self.apply_exceptions(text)
        # 例外が埋めた確定参照をトークンへ退避
        text = re.sub(PROT_A + '([^' + PROT_B + ']*)' + PROT_B,
                      lambda m: prot(m.group(1)), text)
        text = re.sub(r'(?:Draft\s+)?v0\.8\s*(§\d+(?:\.\d+)*)',
                      lambda m: prot(m.group(1)), text)
        if self.chapter >= 31:
            # 第31章（v0.14）から導入。第26〜30章の出力を変えないため章番号で限定する
            text = re.sub(r'v0\.13\s*§(\d+(?:\.\d+)*)',
                          lambda m: prot('§30.' + m.group(1)), text)
        if self.chapter >= 30:
            # 第30章（v0.13）から導入。第26〜29章の出力を変えないため章番号で限定する
            text = re.sub(r'v0\.12\s*§(\d+(?:\.\d+)*)',
                          lambda m: prot('§29.' + m.group(1)), text)
        if self.chapter >= 29:
            # 第29章（v0.12）から導入。第26〜28章の出力を変えないため章番号で限定する
            text = re.sub(r'v0\.11\s*§(\d+(?:\.\d+)*)',
                          lambda m: prot('§28.' + m.group(1)), text)
        text = re.sub(r'v0\.10\s*§(\d+(?:\.\d+)*)',
                      lambda m: prot('§27.' + m.group(1)), text)
        text = re.sub(r'v0\.9\s*§(\d+(?:\.\d+)*)',
                      lambda m: prot('§26.' + m.group(1)), text)
        if policy == 'v08':
            text = re.sub(r'§\d+(?:\.\d+)*', lambda m: prot(m.group(0)), text)
        text = re.sub(r'§(1[1-9]|2[0-5])((?:\.\d+)*)',
                      lambda m: prot(m.group(0)), text)
        text = re.sub(r'§(\d+)((?:\.\d+)*)',
                      lambda m: prot('§%d.%s%s' % (self.chapter, m.group(1), m.group(2))),
                      text)
        return re.sub(PROT_A + r'(\d+)' + PROT_B, lambda m: toks[int(m.group(1))], text)


EXC_V09 = [
    # §1.1 前文：v0.8の該当章を無印で挙げている
    ('v0.8の該当章（§7 OperationCatalog、§8 Pipelineテンプレートモデル',
     'v0.8の該当章（' + _prot('§7') + ' OperationCatalog、' + _prot('§8') + ' Pipelineテンプレートモデル'),
    # §1.1 優先順位リスト：左辺がv0.8、右辺が本章
    ('§3.2（初版に含めないもの）への追加: §2.2',
     _prot('§3.2') + '（初版に含めないもの）への追加: ' + _prot('§26.2.2')),
    ('§6.1（Java表示モデル）・§6.2（補助データ）に対する実行値モデルの一般化: §6.3（合成値）',
     _prot('§6.1') + '（Java表示モデル）・' + _prot('§6.2')
     + '（補助データ）に対する実行値モデルの一般化: ' + _prot('§26.6.3') + '（合成値）'),
    ('§7（OperationCatalog）・§8（Pipelineテンプレート）・§9.1（DSL許可構造）への追加: §8',
     _prot('§7') + '（OperationCatalog）・' + _prot('§8') + '（Pipelineテンプレート）・'
     + _prot('§9.1') + '（DSL許可構造）への追加: ' + _prot('§26.8')),
]

EXC_V10 = [
    # 見出し：「v0.8 §5.1・§5.2」の後半が無印
    ('（v0.8 §5.1・§5.2の置換）', '（' + _prot('§5.1') + '・' + _prot('§5.2') + 'の置換）'),
    ('（v0.8 §10.4・§10.5の置換）', '（' + _prot('§10.4') + '・' + _prot('§10.5') + 'の置換）'),
    # §2 変更の背景
    ('（§5.1・§10.4）は、AI事業者のAPIキーをサーバー側に保持し（§10.4',
     '（' + _prot('§5.1') + '・' + _prot('§10.4') + '）は、AI事業者のAPIキーをサーバー側に保持し（'
     + _prot('§10.4')),
    ('本教材はfixtureのみで完結する設計であり（§10.5',
     '本教材はfixtureのみで完結する設計であり（' + _prot('§10.5')),
    ('ためのバリエーション生成に限られる（§8.4）。',
     'ためのバリエーション生成に限られる（' + _prot('§8.4') + '）。'),
    ('とGenerateRequest（v0.8 §10.1・§10.2）は、fixture用契約',
     'とGenerateRequest（' + _prot('§10.1') + '・' + _prot('§10.2') + '）は、fixture用契約'),
    # §3 アーキテクチャ
    ('§5.1のレイヤー図を次のとおり置換する。',
     _prot('§5.1') + 'のレイヤー図を次のとおり置換する。'),
    ('および§5.2のServer AI Adapter行', 'および' + _prot('§5.2') + 'のServer AI Adapter行'),
    ('§3.1「初版に含めるもの」', _prot('§3.1') + '「初版に含めるもの」'),
    ('依存方向の原則（§5.1「Simulation Core',
     '依存方向の原則（' + _prot('§5.1') + '「Simulation Core'),
    ('§5.2のレイヤー責務表へ次の2行を追加する。',
     _prot('§5.2') + 'のレイヤー責務表へ次の2行を追加する。'),
    ('と§5.3「Providerが返す値', 'と' + _prot('§5.3') + '「Providerが返す値'),
    # §4
    ('「fixtureをAI生成と表示しない」（§10.5）',
     '「fixtureをAI生成と表示しない」（' + _prot('§10.5') + '）'),
    ('§8.4「AIが変更できる範囲」の規定を', _prot('§8.4') + '「AIが変更できる範囲」の規定を'),
    ('§2の設計原則「AIと実評価を分離する」を', _prot('§2') + 'の設計原則「AIと実評価を分離する」を'),
    # §5
    ('ネットワーク・外部サービスへの依存がないため、旧§10.5の「AI利用不能時」',
     'ネットワーク・外部サービスへの依存がないため、旧' + _prot('§10.5') + 'の「AI利用不能時」'),
    ('旧§10.5「構造検証・型検証・教材制約検証に失敗した候補は再試行し',
     '旧' + _prot('§10.5') + '「構造検証・型検証・教材制約検証に失敗した候補は再試行し'),
    # §6
    ('`revision`は既存規則（§10.2:', '`revision`は既存規則（' + _prot('§10.2') + ':'),
    # §7
    ('**`eval`・`Function`等は使用しない**（§3.2の禁止事項',
     '**`eval`・`Function`等は使用しない**（' + _prot('§3.2') + 'の禁止事項'),
    ('通す。§9.3「不成立の候補はStep Engineへ渡さない」',
     '通す。' + _prot('§9.3') + '「不成立の候補はStep Engineへ渡さない」'),
    # v0.9への参照（§10-6 の特殊表記）
    ('v0.9 §8.4・§10-6「AI生成候補', _prot('§26.8.4') + '・' + _prot('§26.10') + 'の6「AI生成候補'),
]

EXC_V11 = [
    # §1.1 優先順位リスト：左辺がv0.8、右辺が本章
    ('§3.2（初版に含めないもの）への追加: §2.2',
     _prot('§3.2') + '（初版に含めないもの）への追加: ' + _prot('§28.2.2')),
    ('§9.1（Collector DSL許可構造）への追加: §8',
     _prot('§9.1') + '（Collector DSL許可構造）への追加: ' + _prot('§28.8')),
]

EXC_V12 = [
    # リポジトリ文書（phase-8-decisions.md）内の節番号であり、本書の節ではない
    ('`docs/phase-8-decisions.md` §9.1のA案の実施',
     '`docs/phase-8-decisions.md` ' + _prot('§9.1') + 'のA案の実施'),
]

EXC_V13 = [
    # リポジトリ文書（phase-6-decisions.md）内の節番号であり、本書の節ではない
    ('`docs/phase-6-decisions.md` §7.3の既存判断の踏襲',
     '`docs/phase-6-decisions.md` ' + _prot('§7.3') + 'の既存判断の踏襲'),
    ('（`docs/phase-6-decisions.md` §7.2）の根拠',
     '（`docs/phase-6-decisions.md` ' + _prot('§7.2') + '）の根拠'),
]

# ---------------------------------------------------------------- 外部文書への§参照
#
# 統合版の本文には、リポジトリ内の別文書（完了報告・判断記録・実装指示書）の節番号を指す
# §参照が現れる。これらは**本書の節ではない**ため、
#   - ビルド時: 章番号への読み替え（§N → §<章>.N）から除外する（EXC_V* の _prot で保護）
#   - 検証時 : §参照の健全性チェックと内部参照件数の集計から除外する
# の両方で外部参照として扱う必要がある。両者が乖離すると、
# 「保護はされているが内部参照として集計される」（＝件数が不正確・偶然合格）状態になるため、
# **判定の単一定義源をここに置き、verify_spec_docx.py からも読み込む**。
#
# 各要素は「§の直前に現れる文字列」。docxのテキスト抽出ではmarkdownのバッククォートが
# 落ちるため、判定側で ` を除去して比較する。
EXTERNAL_DOC_REF_PREFIXES = [
    # 完了報告・判断記録・実装指示書（文書名を明示して参照する形）
    'Phase 8完了報告',
    'Phase 5実装指示書',
    'Phase 5指示',
    # 「Phase 5 §14.4」のように文書名を省いてPhase番号だけで参照する形（末尾の空白まで含める）
    'Phase 5 ',
    # リポジトリパスを明示して参照する形（末尾の空白まで含める）
    'docs/phase-5-decisions.md ',
    'docs/phase-6-decisions.md ',
    'docs/phase-8-decisions.md ',
    'docs/phase-8-completion-report.md ',
]


def is_external_doc_ref(preceding_text):
    """`§`の直前テキストが外部文書への参照を示すか（ビルダーとverifyの共通判定）。

    `preceding_text`は本文中で`§`の直前にある文字列（末尾側が直近）。
    markdownのバッククォートはdocxテキストに残らないため除去して比較する。
    """
    normalized = preceding_text.replace('`', '')
    return any(normalized.endswith(prefix) for prefix in EXTERNAL_DOC_REF_PREFIXES)


EXC_V14 = [
    # リポジトリ文書（完了報告・実装指示書）内の節番号であり、本書の節ではない
    ('Phase 8完了報告§17の持越し事項3番の解消。',
     'Phase 8完了報告' + _prot('§17') + 'の持越し事項3番の解消。'),
    ('Phase 8完了報告§17の持越し事項の解消記録を追記する',
     'Phase 8完了報告' + _prot('§17') + 'の持越し事項の解消記録を追記する'),
    ('（Phase 5実装指示書§9.1）',
     '（Phase 5実装指示書' + _prot('§9.1') + '）'),
    ('Phase 5実装指示書§9.1の発行表',
     'Phase 5実装指示書' + _prot('§9.1') + 'の発行表'),
    ('（Phase 5指示§9.1）',
     '（Phase 5指示' + _prot('§9.1') + '）'),
    ('`docs/phase-8-completion-report.md` §17の持越し事項3番へ',
     '`docs/phase-8-completion-report.md` ' + _prot('§17') + 'の持越し事項3番へ'),
]

# v0.10 §1.2 対応表：第1列は v0.8 の箇所を無印で挙げている
V10_MAPPING_HEADER = ['v0.8箇所', '記述の要旨', '扱い', '本書']


# ---------------------------------------------------------------- 差分章の組み立て

class NumAlloc:
    def __init__(self, start=1031):
        self.n = start
        self.created = []

    def take(self, kind):
        v = self.n
        self.n += 1
        self.created.append((v, 99411 if kind == 'ol' else 991))
        return v


def exception_spans(md_text, exceptions):
    """例外文脈が本文中で占める位置区間 [(start, end), …] を返す。

    `RefResolver.apply_exceptions`は例外文脈の**出現位置**を置換するため、
    保護されるのはその区間内の§だけである。文脈は一意であることを前提とする
    （一意でなければ`apply_exceptions`自身が`AssertionError`を出す）。
    """
    spans = []
    for ctx, _ in exceptions:
        start = md_text.find(ctx)
        if start < 0:
            continue
        spans.append((start, start + len(ctx)))
    return spans


def assert_external_refs_protected(md_text, chapter, exceptions):
    """差分mdの外部文書§参照が、章番号への読み替えから確実に外れることを確認する。

    外部参照が保護されないと、`Phase 5実装指示書§9.1`のような参照が`§<章>.9.1`へ
    誤って読み替えられる。次のいずれかで保護されていなければ`AssertionError`とする。
      - EXC_V* の例外文脈の**占有区間内にある**（`_prot`で保護される）
      - §11〜§25（v0.8本文の節番号としてRefResolverが素通しする範囲）に該当する

    判定は**参照の出現位置**で行う。「同じ節番号を含む例外文脈が文書のどこかにある」で
    判定すると、別位置の未保護参照（例: 保護済み`Phase 5実装指示書§9.1`と未登録の
    `Phase 5指示§9.1`が併存する場合の後者）を見逃す。
    """
    spans = exception_spans(md_text, exceptions)
    unprotected = []
    for m in re.finditer(r'§(\d+(?:\.\d+)*)', md_text):
        preceding = md_text[max(0, m.start() - 40):m.start()]
        if not is_external_doc_ref(preceding):
            continue
        section = m.group(1)
        # RefResolverが素通しする範囲（§11〜§25。小数部があっても先頭が範囲内なら素通し）
        head = section.split('.')[0]
        if re.match(r'^(1[1-9]|2[0-5])$', head):
            continue
        # この参照が例外文脈の占有区間に収まっているか（位置で照合する）
        covered = any(start <= m.start() and m.end() <= end for start, end in spans)
        if not covered:
            unprotected.append(
                '%s（位置 %d、前後: …%s%s…）' % (m.group(0), m.start(), preceding[-20:], section)
            )
    if unprotected:
        raise AssertionError(
            '第%d章: 外部文書への§参照が保護されていません（EXC_V*へ追加が必要）: %s'
            % (chapter, ' / '.join(unprotected))
        )


def build_chapter(blocks, chapter, title, resolver, nums, bid_start, preface):
    """差分文書の block 列を第<chapter>章のXMLへ変換する。"""
    out = []
    bid = bid_start
    out.append(heading('%d. %s' % (chapter, title), 1, 'sec-%d' % chapter, bid))
    bid += 1
    for line in preface:
        out.append(para(line, 'BodyText'))

    sec = 0
    sub = 0
    first_para = True
    for b in blocks:
        if b['k'] == 'h':
            if b['lvl'] == 1:
                continue                              # 差分文書のタイトル行は章見出しで代替済み
            txt = resolver(b['text'])
            if b['lvl'] == 2:
                sec += 1
                sub = 0
                txt = re.sub(r'^\d+\.\s*', '', txt)
                out.append(heading('%d.%d %s' % (chapter, sec, txt), 2,
                                   'sec-%d-%d' % (chapter, sec), bid))
            else:
                sub += 1
                txt = re.sub(r'^\d+\.\d+\s*', '', txt)
                out.append(heading('%d.%d.%d %s' % (chapter, sec, sub, txt), 3,
                                   'sec-%d-%d-%d' % (chapter, sec, sub), bid))
            bid += 1
            first_para = True
        elif b['k'] == 'p':
            out.append(para(resolver(b['text']),
                            'FirstParagraph' if first_para else 'BodyText'))
            first_para = False
        elif b['k'] in ('ul', 'ol'):
            # 種別ごとに実体を分ける。入れ子の番号付きグループは、グループが
            # 始まるたびに新しい実体を取って1から振り直す。
            top_nid, sub_nid, prev = {}, None, None
            for ilvl, txt, od in b['items']:
                if ilvl == 0:
                    sub_nid = None
                    if od not in top_nid:
                        top_nid[od] = nums.take('ol' if od else 'ul')
                    use = top_nid[od]
                else:
                    if sub_nid is None or prev is None or prev[0] == 0 or prev[1] != od:
                        sub_nid = nums.take('ol' if od else 'ul')
                    use = sub_nid
                out.append(list_item(resolver(txt), use, ilvl))
                prev = (ilvl, od)
            first_para = False
        elif b['k'] == 'tbl':
            rows = b['rows']
            v08col = rows[0] == V10_MAPPING_HEADER
            new_rows = []
            for ri, row in enumerate(rows):
                new_rows.append([resolver(c, 'v08' if (v08col and ci == 0 and ri > 0) else 'own')
                                 for ci, c in enumerate(row)])
            out.append(table(new_rows))
            first_para = False
        elif b['k'] == 'code':
            out.append(source_block([resolver(l) for l in b['lines']]))
            first_para = False
    return ''.join(out), bid


# ---------------------------------------------------------------- v0.8本文へのポインタ

def apply_v09_pointers(s, nums):
    """v0.9（第26章）に対応するポインタを v0.8 本文へ差し込む。"""
    n = 0

    # B1 §3.2 初版に含めないもの
    s.insert_after('w:p', 'primitive特化Streamの3引数', list_item(
        NOTE_V09 + 'Gathererの対象外範囲（`Gatherers.mapConcurrent`、カスタムGathererの自由記述、'
        'short-circuitするGathererの実行、`Gatherer.andThen`による合成、複数gatherノードの連結、'
        'gather下流の短絡合成）は§26.2.2を参照。', 1003)); n += 1

    # B2 §4 分類表
    s.append_rows_after('実装対象の完全一覧と優先度は付録Aに示す', [
        ['Gatherer', '`Stream.gather()`、`Gatherers.windowFixed()` / `windowSliding()` / '
                     '`scan()` / `fold()`（§26.2.1）']]); n += 1

    # B3a §6.1 Java表示モデル（v0.9 §1.1項目5は§6.1・§6.2の双方を一般化対象とする）
    s.insert_after('w:tbl', '上位分類', para(
        NOTE_V09 + '実行値モデル（SimValue）は、窓＝「要素値のList」を保持できる形へ一般化する。'
        '合成値・合成要素の安定IDの契約は§26.6.3を参照。', 'BodyText')); n += 1

    # B3 §6.2 補助データ
    s.insert_after('w:p', '：必ず有限化検証を通す。', list_item(
        NOTE_V09 + '窓（`List<T>`）を要素とするStream：`Gatherers.windowFixed` / `windowSliding`。'
        '実行値モデルの一般化（合成値）は§26.6.3を参照。', 1030)); n += 1

    # B4 §7 OperationCatalog
    s.insert_after('w:p', 'TemplateやAI候補は', para(
        NOTE_V09 + '`gather`はINTERMEDIATE + STATEFULとして登録する。Gatherer固有のDSL・'
        '可視化パターン・Phase 7実装範囲は§26.8・§26.9を参照。', 'BodyText')); n += 1

    # B5 §8.4 AIが変更できる範囲
    s.insert_after('w:p', 'AIは自由なPipelineを生成しない。', para(
        NOTE_V09 + 'gatherノードを含むtemplateの合成許可範囲（1 Pipelineにgatherは1ノードまで、'
        'gather下流に短絡操作を置かない、基準必須template 4形）は§26.8.4を参照。', 'BodyText')); n += 1

    # B6 §9.1 DSL許可構造
    s.append_rows('collectorKind、引数、downstream、left / right Collector', [
        ['Gatherer', '`windowFixed` / `windowSliding` / `scan` / `fold` の識別可能Union（§26.8）']]); n += 1

    # B7 §12.3 Snapshot構造
    s.append_rows('short-circuit、通常完了、STREAM CONSUMED', [
        ['Gatherer', 'Gatherer専用context：中間状態、窓バッファ、累積値、合成要素のメンバー参照（§26.6）']]); n += 1

    # B8 §12.4 要素状態
    s.insert_after('w:p', '各要素は操作ノードごとの状態履歴を持つ。', para(
        NOTE_V09 + 'window系gathererでは既存の「□ バッファ済み」「○ 通過済み」をそのまま用いる。'
        '要素の最新状態と、バッファ所属・窓所属は分離し、後者はGatherer専用contextで表す（§26.6.3）。',
        'BodyText')); n += 1

    # B9 §12.5 操作固有状態
    s.append_rows('ノード別コンテナ、bucket、finisher状態', [
        ['gather', 'Gatherer中間状態、窓バッファ、累積値、放出済み合成要素（§26.6）']]); n += 1

    # B10 §13.2 独立snapshotになる処理
    s.insert_after('w:p', '終端結果確定とSTREAM CONSUMED。', list_item(
        NOTE_V09 + 'Gathererのinitializer確定、窓バッファ更新、累積値更新、finisher確定、'
        'gather出力の放出（§26.6.1）。', 1013)); n += 1

    # B11 §14.1 中間操作
    s.append_rows('値・型を変えずSide Effectビューへ表示', [
        ['gather', 'Gatherer構造（initializer / integrator / combiner / finisherの4行）と'
                   '現在の中間状態を表示。詳細は§26.5']]); n += 1

    # B12 §15.2 Collector ASTと画面
    s.insert_after('w:tbl', 'classifier / mapFactory / downstreamを分離表示', para(
        NOTE_V09 + 'Gathererの構造表示は、上記Collector構造ツリーのCSS・ツリー描画パターンのみを流用する。'
        'Collector AST・CollectorContextへは押し込めず、Gatherer専用のcontextと表示コンポーネントを'
        '新設する（§26.5）。', 'BodyText')); n += 1

    # B14 §24.1 Domain
    s.insert_after('w:p', 'Collector ASTと結果型。', list_item(
        NOTE_V09 + 'Gatherer 4種の標準・空ソース・窓サイズ境界と`P7-*`系列（§26.9）。', 1027)); n += 1

    # B15 付録A.2 中間操作
    s.append_rows('flatMapToDouble()', [['gather(Gatherer)', '高（§26.2.1）']]); n += 1

    # B16 付録A.5 新設
    a5 = heading('A.5 Gatherer / Gatherers', 2, 'sec-appendix-a5', 480) + table([
        ['メソッド', '優先度'],
        ['Gatherers.windowFixed(int)', '高'],
        ['Gatherers.windowSliding(int)', '中'],
        ['Gatherers.scan(Supplier, BiFunction)', '高'],
        ['Gatherers.fold(Supplier, BiFunction)', '中'],
    ])
    s.insert_before('w:p', '付録B. 0件時の結果', a5); n += 1

    # B17 付録B 0件時の結果
    s.append_rows('左右の空結果をmergerへ渡した結果', [
        ['windowFixed → toList', '窓0件 → `[]`（公式仕様で確定。§26.7）'],
        ['windowSliding → toList', '窓0件 → `[]`（公式仕様で確定。§26.7）'],
        ['scan → toList', '出力0件 → `[]`（公式定義から導出。§26.7）'],
        ['fold → findFirst', '`Optional[初期値]`（公式定義から導出。§26.7）'],
    ]); n += 1

    # B18 付録C 可視化パターン
    s.append_rows('nested groupingBy / groupingBy + downstream / teeing', [
        ['窓束ね型', 'windowFixed / windowSliding'],
        ['累積放出型', 'scan'],
        ['累積確定型', 'fold'],
    ]); n += 1

    # B19 付録E 根拠資料
    s.append_rows('https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/StringJoiner.html', [
        ['JDK25-GATHER', 'Stream.gather',
         'https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html'],
        ['JDK25-GATHERER', 'Gatherer',
         'https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherer.html'],
        ['JDK25-GATHERERS', 'Gatherers',
         'https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Gatherers.html'],
    ]); n += 1
    return n


def apply_v10_pointers(s):
    """v0.10（第27章）に対応するポインタを v0.8 本文へ差し込む。"""
    n = 0
    P = lambda t: para(NOTE_V10 + t, 'BodyText')

    # §2 設計原則
    s.insert_after('w:tbl', 'AIの生成誤差を結果の正しさへ持ち込まないため', P(
        '設計原則「AIと実評価を分離する」は「外部生成と実評価を分離する」へ一般化された。'
        '仕様は「外部の生成者（AIチャットを使う人間を含む）は検証前のScenarioCandidateを生成し、'
        '結果と途中状態はSimulation Coreが算出する」。→ §27.4.3')); n += 1

    # §3.1 初版に含めるもの
    s.insert_after('w:p', 'Phase 6のサーバー側AI adapterとRemoteScenarioProvider。', list_item(
        NOTE_V10 + '上記は「Phase 6の手動連携（Prompt GeneratorとCandidate Import）。」へ'
        '置換された。→ §27.3.1', 1002)); n += 1

    # §3.3 将来拡張（ノード数ガイドライン）
    s.insert_after('w:p', 'このガイドラインはPhase 6のAI生成制約への流用を想定する。', P(
        'ノード数ガイドラインの「AI生成制約への流用」は「取込候補の制約への流用」と読み替える。'
        '取込はtemplateId固定であるため、ノード数は実質的にtemplate定義が拘束する。→ §27.4.2')); n += 1

    # §5.1 レイヤーと依存方向
    s.insert_after('w:p', '依存方向は外側から内側へ向ける。', P(
        'レイヤー図から `RemoteScenarioProvider → 自アプリのサーバーAPI → AiScenarioAdapter` の'
        '系統を削除し、Application層へPrompt GeneratorとCandidate Importを置く。'
        '依存方向の原則そのものは不変。→ §27.3.1')); n += 1

    # §5.2 レイヤー責務
    s.insert_after('w:tbl', 'APIキーをフロントへ渡さない', P(
        '上表のServer AI Adapter行は削除され、Prompt Generator・Candidate Importの2行が追加された。'
        'Application行の「Provider選択」は「候補入手経路（fixture提示 / 取込受理）の選択」と'
        '読み替える。→ §27.3.1・§27.3.2')); n += 1

    # §1 文書概要表（「初版のAI接続」行はv0.8時点の記録）
    s.insert_after('w:tbl', 'Phase 1〜5は決定的fixture provider、Phase 6でサーバー側AI adapterへ接続', P(
        '上表の「初版のAI接続」行と、§1.1の改訂内容のうちAIに関する記述は、Draft v0.8時点の記録である。'
        'Phase 6のAI API接続（サーバーAPI・AiScenarioAdapter・RemoteScenarioProvider）は廃止され、'
        '手動連携方式へ置換された。現行仕様は§27、v0.8のAI関連記述の全対応表は§27.1.2。')); n += 1

    # §5.3 Source of Truth（v0.10 §1.2では「不変（取込候補にも適用）」）
    s.insert_after('w:p', 'Providerが返す値：検証前の候補であり、正解ではない。', P(
        '最終行の規定は取込候補にも同じく適用する。Candidate Importが組み立てるScenarioCandidateも'
        '検証前の候補であり、正解ではない。→ §27.3.2・§27.4.3')); n += 1

    # §7 OperationCatalog
    s.insert_after('w:p', 'TemplateやAI候補は', P(
        '「TemplateやAI候補は」は「Templateや取込候補は」と読み替える。→ §27.4.2')); n += 1

    # §8.1 PipelineTemplate
    s.insert_after('w:tbl', '500件以内に収まるかの事前検証情報', P(
        'parameterSlotsの「fixture / AIが設定可能なDSLパラメータ」は「fixture / 取込候補が'
        '設定可能なDSLパラメータ」と読み替える。→ §27.4.2')); n += 1

    # §8.4 AIが変更できる範囲
    s.insert_after('w:p', 'AIは自由なPipelineを生成しない。', P(
        '本節の規定は主体を「取込候補」に置き換えてそのまま適用する。'
        '許可外のノード・操作・コード文字列・schema versionを拒否する点は不変。→ §27.4.2')); n += 1

    # §9.3 検証順序
    s.insert_after('w:p', '不成立の候補はStep Engineへ渡さない。', P(
        '「AI返却のコード文字列」は「取込候補のコード文字列」と読み替え、貼付経路にも同じ規定を'
        '適用する。→ §27.7.2')); n += 1

    # §10.1 インターフェース責務
    s.insert_after('w:p', 'が返すのは候補データであり', P(
        '§10.1・§10.2はfixture用契約として無変更で存続する。手動連携の取込経路は'
        'ScenarioProviderを実装しない独立したApplicationサービスとする。→ §27.3.2')); n += 1

    # §10.3 ScenarioCandidate
    s.insert_after('w:p', 'provenance、生成時刻、DSL version、seedまたはrevision。', list_item(
        NOTE_V10 + 'provider種別は `FIXTURE | AI` から `FIXTURE | IMPORTED` へ変更された。'
        '表示名は「固定サンプル」「取込サンプル」。→ §27.4.1', 1024)); n += 1

    # §10.4 Provider構成
    s.insert_after('w:p', 'AI APIキー、モデル呼び出し、再試行はサーバー側だけに置く。', P(
        '§10.4のPhase 6行とAPIキー規定は廃止された。Phase 6は純フロントエンド構成（手動連携）と'
        'なり、保護すべきAPIキー・秘密情報そのものが存在しなくなる。→ §27.3・§27.5')); n += 1

    # §10.5 AI利用不能時
    s.insert_after('w:p', '構造検証・型検証・教材制約検証に失敗した候補は再試行し、最終失敗時は理由を示す。',
                   list_item(
        NOTE_V10 + '§10.5全体は§27.5.3へ置換された。AI利用不能状態は存在しない。'
        '「fixtureへ自動フォールバックしない」は「取込の検証が失敗しても現在表示中のシナリオを'
        '変更せず、失敗理由を表示するのみとする」へ読み替える。アプリ側の自動再試行は行わない。',
        1026)); n += 1

    # §11.1 Scenario
    s.insert_after('w:tbl', 'scenario revisionまたはseed', P(
        'provenanceの「FIXTURE / AI」は「FIXTURE / IMPORTED」へ変更された。取込候補の'
        'provenance・revisionはアプリ側が取込時に付与する。→ §27.4.1・§27.6.5')); n += 1

    # §12.1 SimulationSession
    s.insert_after('w:p', 'を1つ前へ移し、保存済み', P(
        'Applicationの「Provider選択」責務は「候補入手経路（fixture提示 / 取込受理）の選択」'
        'として存続する。→ §27.3.2')); n += 1

    # §17.1 画面領域
    s.insert_after('w:tbl', '最初から / 戻る / 進む / 自動・停止、現在位置、停止理由', P(
        '「操作選択・シナリオ」行の「固定またはAIサンプル」は「固定または取込サンプル」へ'
        '置換された。→ §27.8')); n += 1

    # §18 操作・履歴・UI一時状態
    s.insert_after('w:p', 'snapshot外に置くUI一時状態は、アニメーション進捗', P(
        '操作一覧の「AIで別サンプル」行は削除され、「プロンプトをコピー」「候補を貼り付け」の'
        '2操作が追加された。貼付テキスト・取込パネルの開閉状態はUI一時状態とし、履歴復元の'
        '対象にしない。→ §27.8')); n += 1

    # §19 非機能・品質要件
    s.insert_after('w:tbl', 'template version、DSL version、scenario revision、provenanceを保持', P(
        '安全性行は「任意コード実行なし。DSLホワイトリスト。貼付JSONはデータとしてのみ扱い、'
        '秘密情報を保持しない」へ改訂された。→ §27.7.1')); n += 1

    # §20 Phase別実装計画（Phase 7行の追加とPhase 6行の置換注記）
    s.append_rows('サーバーAPI、AI adapter、RemoteScenarioProvider、AI capability、候補検証', [
        ['7',
         '`Stream.gather`、`Gatherers.windowFixed` / `windowSliding` / `scan` / `fold` を'
         'OperationCatalog・DSL・Step Engine・template / fixture・UI・テスト・Oracleまで縦断実装',
         'Gatherer構造表示、§26.6.2のsnapshot列、§26.6.3のID契約、§26.7の空入力、型遷移が'
         'JDK 25実測との回帰照合を含めて成立し、既存P1〜P6テストが全件成功（詳細は§26.9）']])
    n += 1
    s.insert_after('w:tbl', 'サーバーAPI、AI adapter、RemoteScenarioProvider、AI capability、候補検証', P(
        '上表のPhase 6行は§27.9のとおり書き換えられた。サーバーAPI・AI adapter・'
        'RemoteScenarioProvider・AI capabilityは実装対象から削除され、手動連携'
        '（Import Contract、Prompt Generator、Candidate Import、取込UI）へ置換された。'
        '必須テストIDは`P6-*`。')); n += 1

    # §21.2 Phase 1で実装する範囲（表の直後。§21.4末尾だけでは離れすぎるため）
    s.insert_after('w:tbl', 'AI capabilityはdisabled理由を返す', P(
        '上表のProvider行「AI capabilityはdisabled理由を返す」は、当時のPhase 1実装契約の'
        '歴史的記録として不変のまま保持する。`AI_CAPABILITY`定数とdisabled AIボタンは廃止された。'
        '現行のUI規定は§27.8、回帰suiteの扱いは§27.1.3。')); n += 1

    # §21.4 Phase 1で実装しない範囲
    s.insert_after('w:p', '本番デプロイ構成。', list_item(
        NOTE_V10 + '§21.2・§21.4のAI関連記述（実AI接続、サーバーAPI、RemoteScenarioProvider、'
        'AIボタンの利用不能理由）は、当時のPhase 1実装契約の歴史的記録として不変のまま保持する。'
        '現行仕様は§27。', 1012)); n += 1

    # §22.1 機能・Domain
    s.insert_after('w:p', '初期状態、通過、除外、toList追加、結果確定、STREAM CONSUMEDが確定snapshotとして表現される。',
                   list_item(
        NOTE_V10 + '§22.1のAI capability関連の受入条件は歴史的記録として保持する。'
        '現行UIの規定は§27.8、現行の回帰suiteの扱いは§27.1.3を参照。', 1018)); n += 1

    # §23.2 履歴・Applicationテスト（P1-A08の直後）
    s.insert_after('w:tbl', 'AI利用不能理由とUI状態が一致', P(
        '上表のP1-A08は歴史的記録として保持する。AI capability廃止に伴い、P1-A08は廃止され、'
        '「取込検証の結果とUI表示の一致」をP6-A系の新IDで検証する。→ §27.1.3')); n += 1

    # §23.3 React統合テスト
    s.insert_after('w:tbl', 'disabled理由が読め、fixtureへ自動切替しない', P(
        '上表のP1-R07は歴史的記録として保持する。P1-R07は廃止され、「取込失敗時に現行シナリオを'
        '維持し理由を表示する」をP6-R系の新IDで検証する。AI capability廃止に伴う現行回帰suiteの'
        '更新範囲は§27.1.3の表のとおり（更新理由はPhase 6完了報告へ記録）。')); n += 1

    # §24.1 Domain
    s.insert_after('w:p', 'Collector ASTと結果型。', list_item(
        NOTE_V10 + '取込候補のclosed schema検証、数値値域、Javaコード表示のリテラル契約'
        '（`P6-*`系列）。→ §27.9', 1027)); n += 1
    return n


def apply_v11_pointers(s):
    """v0.11（第28章）に対応するポインタを v0.8 本文へ差し込む。

    v0.11 §1.1の優先順位リスト（付録A.4 / §3.2 / §12〜§13 / 付録B / §9.1 /
    §14〜§15 / §20・§24）を網羅する。v0.9ポインタが挿入済みの段落をアンカーに
    使う箇所があるため、apply_v09_pointers の後に呼ぶこと。
    """
    n = 0

    # C1 §3.2 初版に含めないもの（v0.9 B1の直後）
    s.insert_after('w:p', 'Gathererの対象外範囲', list_item(
        NOTE_V11 + 'toMapの対象外範囲（`toConcurrentMap`系、`toUnmodifiableMap`系、'
        '`Map.merge`のnull削除意味論、数値加算merge、keyMapper / valueMapper / '
        'mergeFunctionの自由記述）は§28.2.2を参照。', 1003)); n += 1

    # C2 §9.1 DSL許可構造表
    s.append_rows('collectorKind、引数、downstream、left / right Collector', [
        ['toMap', 'keyMapper（classifier流用）/ valueMapper（`identity` / `fieldAccess`）/ '
                  'mergeFunctionId（`first` / `last` / `concat`）/ mapFactoryId（§28.8）']]); n += 1

    # C3 §12.3 Snapshot構造表（実行失敗契約）
    s.append_rows('short-circuit、通常完了、STREAM CONSUMED', [
        ['実行失敗', '`ExecutionFailureView`（例外型、collectorPath、bucketPath、重複キー、'
                     '既存値・新しい値）。completionへEXECUTION_FAILEDを追加（§28.6.2）']]); n += 1

    # C4 §12.4 要素状態（実行失敗契約の所在）
    s.insert_after('w:p', '後者はGatherer専用contextで表す', para(
        NOTE_V11 + '正常完了しないPipeline（toMap 2引数版の重複キー）の実行失敗契約'
        '（`COLLECT_FAILED`終端・completion `EXECUTION_FAILED`・再生状態`FAILED`・'
        '戻る→進むの完全復元）は§28.6.2を参照。', 'BodyText')); n += 1

    # C5 §12.5 操作固有状態表
    s.append_rows('ノード別コンテナ、bucket、finisher状態', [
        ['toMap', 'Map entry蓄積（キー→値1件）、重複検出・merge適用のcontext、'
                  '実行失敗view（§28.6）']]); n += 1

    # C6 §13.2 独立snapshotになる処理（v0.9 B10の直後）
    s.insert_after('w:p', 'Gathererのinitializer確定、窓バッファ更新', list_item(
        NOTE_V11 + 'toMapのキー評価確定、値評価確定、重複キー検出、mergeFunction適用、'
        '実行失敗確定（§28.6.1〜§28.6.2）。', 1013)); n += 1

    # C7 §15.2 Collector ASTと画面（v0.9 B12の直後）
    s.insert_after('w:p', 'Gatherer専用のcontextと表示コンポーネントを', para(
        NOTE_V11 + 'toMapノードはCollector構造ツリーへkeyMapper / valueMapper / '
        'mergeFunction / mapFactoryの4行を常設表示する。蓄積entry・重複・merge・'
        '実行失敗の表示は§28.5を参照。', 'BodyText')); n += 1

    # C8 §20 Phase別実装計画表（Phase 8行）
    s.append_rows('サーバーAPI、AI adapter、RemoteScenarioProvider、AI capability、候補検証', [
        ['8',
         '`Collectors.toMap`（2・3・4引数）をCollector AST・validate・Runtime・Step Engine・'
         'セッション・template / fixture・UI・テスト・Oracleまで縦断実装（新operationIdなし）',
         '構造4行表示、§28.6のsnapshot列と実行失敗契約、§28.7の特殊ケース、§28.8のDSL検証が'
         'JDK 25実測回帰照合（例外は型のみ）を含めて成立し、既存P1〜P7テストが全件成功'
         '（詳細は§28.9）']]); n += 1

    # C9 §24.1 Domain（v0.10ポインタの直後）
    s.insert_after('w:p', '取込候補のclosed schema検証、数値値域', list_item(
        NOTE_V11 + 'toMapのDSL検証・実行失敗契約・`ExecutionFailureView`の6配置と'
        '`P8-*`系列（§28.9）。', 1027)); n += 1

    # C10 付録A.4 Collector / Collectors
    s.append_rows('Collectors.summarizingInt/Long/Double()', [
        ['Collectors.toMap(keyMapper, valueMapper)', '高（§28.2.1）'],
        ['Collectors.toMap(keyMapper, valueMapper, mergeFunction)', '高（§28.2.1）'],
        ['Collectors.toMap(keyMapper, valueMapper, mergeFunction, mapFactory)', '中（§28.2.1）'],
    ]); n += 1

    # C11 付録B 0件時の結果（v0.9 B17と同じ表）
    s.append_rows('左右の空結果をmergerへ渡した結果', [
        ['collect(toMap)（2・3・4引数）', '空stream → 空Map `{}`（公式定義から導出。§28.7）'],
        ['partitioningBy配下のtoMap・要素0件のpartition',
         '空Map（4引数版はTreeMap）が値になる（公式仕様で確定。§28.7）'],
    ]); n += 1

    # C12 付録E 根拠資料
    s.append_rows('https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/StringJoiner.html', [
        ['JDK25-MAP', 'Map.merge（mergeFunctionの適用順の根拠）',
         'https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html'],
    ]); n += 1
    return n


# ---------------------------------------------------------------- メタデータ更新

def apply_meta(s, version_label, date_label, has_v10, has_v11=False, has_v12=False,
               has_v13=False, has_v14=False):
    """本書自身の版を表す記述を更新し、読み方の凡例を冒頭へ置く。

    ここで書き換えるのは「この文書は何版か」を述べている箇所だけである。
    v0.8時点の経緯を述べた記述（§1.1の改訂内容、§21〜§23のPhase 1契約など）は
    歴史的記録として残し、注記で現行仕様の所在を示す。
    """
    # 表紙
    s.replace_text('Draft v0.8 / 2026-08-07', '%s / %s' % (version_label, date_label))
    # 文書ステータス行
    s.replace_text('文書ステータス：実装基準（Draft v0.8）',
                   '文書ステータス：実装基準（%s）' % version_label)
    # §1 文書概要表（該当行の内側に限定して置換する）
    s.replace_text_in('w:tr', '>版</w:t>', 'Draft v0.8', version_label)
    s.replace_text_in('w:tr', '>基準日</w:t>', '2026-08-07', date_label)
    # §1.1 の見出し（v0.9・v0.10行を追加したため「Draft v0.8の」では実態と合わない）
    s.replace_text('1.1 Draft v0.8の主な改訂点', '1.1 主な改訂点（Draft v0.8以降）')
    # 巻末
    s.replace_text('Draft v0.8 終了', '%s 終了' % version_label)

    # 冒頭の読み方（統合版を単独で読むための全体凡例）
    if has_v14:
        # v0.14もv0.8本文への注記を追加しない（変更は第31章の追加のみ）
        diff_names = ('、v0.10（Phase 6手動連携差分）、v0.11（Collectors.toMap差分）、'
                      'v0.12（teeing × toMap差分）、v0.13（数値加算merge差分）、'
                      'v0.14（unmodifiable系Collector差分）')
        vers = 'v0.9・v0.10・v0.11'
        notes = '【v0.9による追加】【v0.10による変更】【v0.11による追加】'
        chapters = '第26章〜第28章'
        chapter_map = ('第26章（v0.9）・第27章（v0.10）・第28章（v0.11）・第29章（v0.12）・'
                       '第30章（v0.13）・第31章（v0.14）')
    elif has_v13:
        # v0.13もv0.12と同様にv0.8本文への注記を追加しない（変更は第30章の追加のみ）
        diff_names = ('、v0.10（Phase 6手動連携差分）、v0.11（Collectors.toMap差分）、'
                      'v0.12（teeing × toMap差分）、v0.13（数値加算merge差分）')
        vers = 'v0.9・v0.10・v0.11'
        notes = '【v0.9による追加】【v0.10による変更】【v0.11による追加】'
        chapters = '第26章〜第28章'
        chapter_map = ('第26章（v0.9）・第27章（v0.10）・第28章（v0.11）・第29章（v0.12）・'
                       '第30章（v0.13）')
    elif has_v12:
        # v0.12はv0.8本文への注記を追加しない（変更は第28章の規定の実装確定と第29章の追加のみ）
        # ため、注記の凡例はv0.11までのまま、差分名と章対応だけを広げる
        diff_names = ('、v0.10（Phase 6手動連携差分）、v0.11（Collectors.toMap差分）、'
                      'v0.12（teeing × toMap差分）')
        vers = 'v0.9・v0.10・v0.11'
        notes = '【v0.9による追加】【v0.10による変更】【v0.11による追加】'
        chapters = '第26章〜第28章'
        chapter_map = '第26章（v0.9）・第27章（v0.10）・第28章（v0.11）・第29章（v0.12）'
    elif has_v11:
        diff_names = '、v0.10（Phase 6手動連携差分）、v0.11（Collectors.toMap差分）'
        vers = 'v0.9・v0.10・v0.11'
        notes = '【v0.9による追加】【v0.10による変更】【v0.11による追加】'
        chapters = '第26章・第27章・第28章'
        chapter_map = '第26章（v0.9）・第27章（v0.10）・第28章（v0.11）'
    elif has_v10:
        diff_names = 'と v0.10（Phase 6手動連携差分）'
        vers = 'v0.9・v0.10'
        notes = '【v0.9による追加】【v0.10による変更】'
        chapters = '第26章・第27章'
        chapter_map = '第26章（v0.9）・第27章（v0.10）'
    else:
        diff_names = ''
        vers = 'v0.9'
        notes = '【v0.9による追加】'
        chapters = '第26章'
        chapter_map = '第26章（v0.9）'
    guide = [
        '本書の読み方：本書は Draft v0.8 の本文へ、v0.9（Gatherers差分）'
        + diff_names
        + 'を統合したものである。第1〜25章および付録A〜Fは Draft v0.8 の記述をそのまま保持しており、'
          'v0.8時点の経緯・当時の契約を述べた記述も歴史的記録として残している。',
        'したがって、第1〜25章および付録A〜Fの記述のうち、'
        + vers
        + 'によって追加・置換・読み替えとなった箇所には、その直後に'
        + notes
        + 'の注記と参照先を付している。注記のある記述については、注記が指す'
        + chapters
        + 'の規定が現行仕様である。差分の本文は'
        + chapter_map
        + 'にある。',
    ]
    frag = ''.join(para(g, 'BodyText') for g in guide)
    s.insert_after('w:p', 'アプリの実装は本書の作成範囲に含まない。', frag)


def apply_footer(ftr_xml, version_label):
    """ページフッターの版表記を更新する（全ページに出るため統合版では必須）。"""
    if '>Draft v0.8  |  </w:t>' not in ftr_xml:
        return ftr_xml, False
    return ftr_xml.replace('>Draft v0.8  |  </w:t>',
                           '>%s  |  </w:t>' % xesc(version_label)), True


# ---------------------------------------------------------------- numbering.xml

def extend_numbering(num_xml, created):
    """新規の番号付け実体を追加する。

    番号付きリストが同じabstractNumを共有すると、描画側によっては連番が継続し、
    §26.1.1が「8.」始まりになる等の実害が出る。そこで番号付きリストは
      (1) リストごとに専用のabstractNumを複製し（nsidも別値にする）
      (2) さらに w:lvlOverride / w:startOverride で1から開始させる
    の二重で restart を保証する。箇条書き（bullet）は連番の概念がないため共有のままでよい。
    """
    m = re.search(r'<w:abstractNum w:abstractNumId="99411">.*?</w:abstractNum>',
                  num_xml, re.S)
    if not m:
        raise AssertionError('abstractNum 99411（decimal）が見つからない')
    ol_template = m.group(0)

    abstracts, nums = '', ''
    next_aid = 99500
    for nid, aid in created:
        if aid == 99411:
            new_aid = next_aid
            next_aid += 1
            block = ol_template.replace('w:abstractNumId="99411"',
                                        'w:abstractNumId="%d"' % new_aid)
            block = re.sub(r'<w:nsid w:val="[^"]*"/>',
                           '<w:nsid w:val="A%d"/>' % new_aid, block)
            abstracts += block
            ov = ''.join('<w:lvlOverride w:ilvl="%d"><w:startOverride w:val="1"/>'
                         '</w:lvlOverride>' % i for i in range(2))
            nums += ('<w:num w:numId="%d"><w:abstractNumId w:val="%d"/>%s</w:num>'
                     % (nid, new_aid, ov))
        else:
            nums += ('<w:num w:numId="%d"><w:abstractNumId w:val="%d"/></w:num>'
                     % (nid, aid))
    # abstractNum は num より前に置く必要がある
    first_num = num_xml.index('<w:num ')
    return (num_xml[:first_num] + abstracts + num_xml[first_num:]
            ).replace('</w:numbering>', nums + '</w:numbering>')


# ---------------------------------------------------------------- 本体

PREFACE_26 = [
    '本章は、v0.9差分文書（`docs/Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md`）の全文を'
    '章立てで収録したものである。第1〜25章および付録A〜Fの本文はDraft v0.8から変更しておらず、'
    '本章への参照行のみを追加している。',
    '本章の記述で「本書」とあるのは本章（v0.9差分）を、「v0.8」とあるのは本書の第1〜25章および'
    '付録A〜Fを指す。本章内の節を指す参照は§26.x、v0.8本文の節を指す参照は§1〜§25および付録の'
    '記号で表記している。',
]

PREFACE_27 = [
    '本章は、v0.10差分文書（`docs/Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md`）の'
    '全文を章立てで収録したものである。第1〜25章および付録A〜Fの本文はDraft v0.8から変更しておらず、'
    '本章への参照行のみを追加している。',
    '本章の記述で「本書」とあるのは本章（v0.10差分）を、「v0.8」とあるのは本書の第1〜25章および'
    '付録A〜F、「v0.9」とあるのは第26章を指す。本章内の節を指す参照は§27.x、v0.9の節を指す参照は'
    '§26.x、v0.8本文の節を指す参照は§1〜§25および付録の記号で表記している。',
]

PREFACE_28 = [
    '本章は、v0.11差分文書（`docs/Java_Stream_API_Visualization_Spec_v0.11_toMap.md`）の'
    '全文を章立てで収録したものである。第1〜25章および付録A〜Fの本文はDraft v0.8から変更しておらず、'
    '本章への参照行のみを追加している。',
    '本章の記述で「本書」とあるのは本章（v0.11差分）を、「v0.8」とあるのは本書の第1〜25章および'
    '付録A〜F、「v0.9」とあるのは第26章、「v0.10」とあるのは第27章を指す。本章内の節を指す参照は'
    '§28.x、v0.9・v0.10の節を指す参照は§26.x・§27.x、v0.8本文の節を指す参照は§1〜§25および付録の'
    '記号で表記している。なお本章内の`docs/phase-5-decisions.md`等のリポジトリ文書への§参照は、'
    '当該文書内の節番号であり本書の節ではない。',
]

PREFACE_29 = [
    '本章は、v0.12差分文書（`docs/Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md`）の'
    '全文を章立てで収録したものである。第1〜25章および付録A〜Fの本文はDraft v0.8から変更しておらず、'
    '本章への参照行のみを追加している。',
    '本章の記述で「本書」とあるのは本章（v0.12差分）を、「v0.8」とあるのは本書の第1〜25章および'
    '付録A〜F、「v0.9」とあるのは第26章、「v0.10」とあるのは第27章、「v0.11」とあるのは第28章を指す。'
    '本章内の節を指す参照は§29.x、v0.9〜v0.11の節を指す参照は§26.x〜§28.x、v0.8本文の節を指す参照は'
    '§1〜§25および付録の記号で表記している。なお本章内の`docs/phase-8-decisions.md`等のリポジトリ文書への'
    '§参照は、当該文書内の節番号であり本書の節ではない。',
]

PREFACE_31 = [
    '本章は、v0.14差分文書（`docs/Java_Stream_API_Visualization_Spec_v0.14_Unmodifiable.md`）の'
    '全文を章立てで収録したものである。第1〜25章および付録A〜Fは、先行差分で追加済みの参照行を除き'
    'Draft v0.8本文を変更しておらず、本章は末尾に追加している。',
    '本章の記述で「本書」とあるのは本章（v0.14差分）を、「v0.8」とあるのは本書の第1〜25章および'
    '付録A〜F、「v0.9」とあるのは第26章、「v0.10」とあるのは第27章、「v0.11」とあるのは第28章、'
    '「v0.12」とあるのは第29章、「v0.13」とあるのは第30章を指す。本章内の節を指す参照は§31.x、'
    'v0.9〜v0.13の節を指す参照は§26.x〜§30.xで表記している。なお本章内のPhase 5実装指示書・'
    'Phase 8完了報告等のリポジトリ文書への§参照は、当該文書内の節番号であり本書の節ではない。',
]

PREFACE_30 = [
    '本章は、v0.13差分文書（`docs/Java_Stream_API_Visualization_Spec_v0.13_NumericMerge.md`）の'
    '全文を章立てで収録したものである。第1〜25章および付録A〜Fは、先行差分で追加済みの参照行を除き'
    'Draft v0.8本文を変更しておらず、本章は末尾に追加している。',
    '本章の記述で「本書」とあるのは本章（v0.13差分）を、「v0.8」とあるのは本書の第1〜25章および'
    '付録A〜F、「v0.9」とあるのは第26章、「v0.10」とあるのは第27章、「v0.11」とあるのは第28章、'
    '「v0.12」とあるのは第29章を指す。本章内の節を指す参照は§30.x、v0.9〜v0.12の節を指す参照は'
    '§26.x〜§29.xで表記している。なおJLS（Java言語仕様）の節番号（JLS 15.18.2等）と、本章内の'
    '`docs/phase-6-decisions.md`等のリポジトリ文書への§参照は、外部文書の節番号であり本書の節ではない。',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--v09', required=True)
    ap.add_argument('--v10')
    ap.add_argument('--v11')
    ap.add_argument('--v12')
    ap.add_argument('--v13')
    ap.add_argument('--v14')
    ap.add_argument('--out', required=True)
    ap.add_argument('--version-label', default=None)
    ap.add_argument('--date-label', default='2026-08-12')
    args = ap.parse_args()

    if args.v11 and not args.v10:
        raise SystemExit('--v11 には --v10 が必要です（v0.11はv0.10までの統合を前提とする）')
    if args.v12 and not args.v11:
        raise SystemExit('--v12 には --v11 が必要です（v0.12はv0.11までの統合を前提とする）')
    if args.v13 and not args.v12:
        raise SystemExit('--v13 には --v12 が必要です（v0.13はv0.12までの統合を前提とする）')
    if args.v14 and not args.v13:
        raise SystemExit('--v14 には --v13 が必要です（v0.14はv0.13までの統合を前提とする）')
    version_label = args.version_label or (
        'Draft v0.14' if args.v14 else
        'Draft v0.13' if args.v13 else
        'Draft v0.12' if args.v12 else
        'Draft v0.11' if args.v11 else 'Draft v0.10' if args.v10 else 'Draft v0.9')

    base_bytes = open(args.base, 'rb').read()
    base_sha = hashlib.sha256(base_bytes).hexdigest()
    zin = zipfile.ZipFile(io.BytesIO(base_bytes))
    doc = zin.read('word/document.xml').decode('utf-8')
    numbering = zin.read('word/numbering.xml').decode('utf-8')
    core = zin.read('docProps/core.xml').decode('utf-8')
    custom = zin.read('docProps/custom.xml').decode('utf-8')
    footer1 = zin.read('word/footer1.xml').decode('utf-8')

    s = Surgeon(doc)
    nums = NumAlloc()
    report = {}

    # A: メタデータ（章追加より前に行う。章本文がv0.8の版表記を引用するため）
    apply_meta(s, version_label, args.date_label, bool(args.v10), bool(args.v11), bool(args.v12),
               bool(args.v13), bool(args.v14))
    report['A メタデータ'] = 7

    # 目次
    s.insert_rows_before('>A〜F</w:t>', [['26', 'v0.9差分：Stream.gather / Gatherers']]
                         + ([['27', 'v0.10差分：Phase 6 手動連携']] if args.v10 else [])
                         + ([['28', 'v0.11差分：Collectors.toMap']] if args.v11 else [])
                         + ([['29', 'v0.12差分：teeing × toMap']] if args.v12 else [])
                         + ([['30', 'v0.13差分：数値加算merge']] if args.v13 else [])
                         + ([['31', 'v0.14差分：unmodifiable系Collector']] if args.v14 else []))
    report['A 目次'] = 1

    # §1.1 改訂点
    rev_rows = [['v0.9', '`Stream.gather` / `Gatherers` を教材対象へ追加し、Phase 7を新設（第26章）。'
                         'v0.8の一般原則・不変条件・検証順序・UI原則は変更しない']]
    if args.v10:
        rev_rows.append(['v0.10', 'Phase 6のAI API接続（サーバーAPI・AiScenarioAdapter・'
                                  'RemoteScenarioProvider）を廃止し、手動連携方式へ置換（第27章）。'
                                  'v0.8のAI関連記述の全対応表は§27.1.2'])
    if args.v11:
        rev_rows.append(['v0.11', '`Collectors.toMap`（2・3・4引数）を教材対象へ追加し、'
                                  'Phase 8を新設（第28章）。実行失敗契約（正常完了しない'
                                  'Pipelineの教材化）をsnapshot契約へ追加'])
    if args.v12:
        rev_rows.append(['v0.12', 'teeing branchへのtoMap配置を解消するmerger record'
                                  '（RegionIndex）を追加（第29章）。Phase 8持越しの'
                                  'P8-D18 / P8-D15第6配置を完了'])
    if args.v13:
        rev_rows.append(['v0.13', 'toMapのmergeFunctionへ型付き数値加算ファミリー'
                                  '（Integer::sum / Long::sum / Double::sum）を追加（第30章）。'
                                  'オーバーフロー・safe integer範囲・doubleの丸めの整理を含む'])
    if args.v14:
        rev_rows.append(['v0.14', '`Collectors.toUnmodifiableList` / `toUnmodifiableSet` / '
                                  '`toUnmodifiableMap`を教材対象へ追加し、Phase 11を新設（第31章）。'
                                  '蓄積ラベルと結果ラベルの分離・finisher可視化・'
                                  '非null不変条件の機械検証を含む'])
    s.append_rows('教材Pipeline最大ノード数ガイドラインの運用方針', rev_rows)
    report['A §1.1改訂点'] = 1

    # B: v0.9 ポインタ
    report['B v0.9ポインタ'] = apply_v09_pointers(s, nums)

    # V: v0.10 ポインタ
    if args.v10:
        report['V v0.10ポインタ'] = apply_v10_pointers(s)

    # W: v0.11 ポインタ（v0.9ポインタ挿入済みの段落をアンカーに使うため、この順で呼ぶ）
    if args.v11:
        report['W v0.11ポインタ'] = apply_v11_pointers(s)

    # C: 差分章
    md09 = open(args.v09, encoding='utf-8').read()
    assert_external_refs_protected(md09, 26, EXC_V09)
    r09 = RefResolver(26, EXC_V09)
    x26, bid = build_chapter(parse_markdown(md09), 26,
                             'v0.9差分：Stream.gather / Gatherers', r09, nums, 500, PREFACE_26)
    s.insert_chapter_before('付録A. 実装対象メソッド一覧', x26)
    report['C 第26章'] = 1
    unused = [c for c, _ in EXC_V09 if c not in r09.used]
    if unused:
        raise AssertionError('v0.9の未適用例外: %r' % unused)

    if args.v10:
        md10 = open(args.v10, encoding='utf-8').read()
        assert_external_refs_protected(md10, 27, EXC_V10)
        r10 = RefResolver(27, EXC_V10)
        x27, bid = build_chapter(parse_markdown(md10), 27,
                                 'v0.10差分：Phase 6 手動連携', r10, nums, bid, PREFACE_27)
        s.insert_chapter_before('付録A. 実装対象メソッド一覧', x27)
        report['C 第27章'] = 1
        unused = [c for c, _ in EXC_V10 if c not in r10.used]
        if unused:
            raise AssertionError('v0.10の未適用例外: %r' % unused)

    if args.v11:
        md11 = open(args.v11, encoding='utf-8').read()
        assert_external_refs_protected(md11, 28, EXC_V11)
        r11 = RefResolver(28, EXC_V11)
        x28, bid = build_chapter(parse_markdown(md11), 28,
                                 'v0.11差分：Collectors.toMap', r11, nums, bid, PREFACE_28)
        s.insert_chapter_before('付録A. 実装対象メソッド一覧', x28)
        report['C 第28章'] = 1
        unused = [c for c, _ in EXC_V11 if c not in r11.used]
        if unused:
            raise AssertionError('v0.11の未適用例外: %r' % unused)

    if args.v12:
        md12 = open(args.v12, encoding='utf-8').read()
        assert_external_refs_protected(md12, 29, EXC_V12)
        r12 = RefResolver(29, EXC_V12)
        x29, bid = build_chapter(parse_markdown(md12), 29,
                                 'v0.12差分：teeing × toMap', r12, nums, bid, PREFACE_29)
        s.insert_chapter_before('付録A. 実装対象メソッド一覧', x29)
        report['C 第29章'] = 1
        unused = [c for c, _ in EXC_V12 if c not in r12.used]
        if unused:
            raise AssertionError('v0.12の未適用例外: %r' % unused)

    if args.v13:
        md13 = open(args.v13, encoding='utf-8').read()
        assert_external_refs_protected(md13, 30, EXC_V13)
        r13 = RefResolver(30, EXC_V13)
        x30, bid = build_chapter(parse_markdown(md13), 30,
                                 'v0.13差分：数値加算merge', r13, nums, bid, PREFACE_30)
        s.insert_chapter_before('付録A. 実装対象メソッド一覧', x30)
        report['C 第30章'] = 1
        unused = [c for c, _ in EXC_V13 if c not in r13.used]
        if unused:
            raise AssertionError('v0.13の未適用例外: %r' % unused)

    if args.v14:
        md14 = open(args.v14, encoding='utf-8').read()
        assert_external_refs_protected(md14, 31, EXC_V14)
        r14 = RefResolver(31, EXC_V14)
        x31, bid = build_chapter(parse_markdown(md14), 31,
                                 'v0.14差分：unmodifiable系Collector', r14, nums, bid, PREFACE_31)
        s.insert_chapter_before('付録A. 実装対象メソッド一覧', x31)
        report['C 第31章'] = 1
        unused = [c for c, _ in EXC_V14 if c not in r14.used]
        if unused:
            raise AssertionError('v0.14の未適用例外: %r' % unused)

    numbering = extend_numbering(numbering, nums.created)
    core = re.sub(r'(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)',
                  r'\g<1>%sT00:00:00Z\g<2>' % args.date_label, core)
    custom = re.sub(r'(<vt:lpwstr>)Draft v0\.7 / 2026-08-07(</vt:lpwstr>)',
                    r'\g<1>%s / %s\g<2>' % (version_label, args.date_label), custom)

    footer1, footer_hit = apply_footer(footer1, version_label)
    if not footer_hit:
        raise AssertionError('footer1.xml の版表記が見つからない')
    report['A フッター'] = 1

    replaced = {
        'word/footer1.xml': footer1.encode('utf-8'),
        'word/document.xml': s.xml.encode('utf-8'),
        'word/numbering.xml': numbering.encode('utf-8'),
        'docProps/core.xml': core.encode('utf-8'),
        'docProps/custom.xml': custom.encode('utf-8'),
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = replaced.get(item.filename, zin.read(item.filename))
            zout.writestr(item, data)
    zin.close()

    if hashlib.sha256(open(args.base, 'rb').read()).hexdigest() != base_sha:
        raise AssertionError('入力のv0.8 docxが変化した')

    print('生成: %s' % args.out)
    print('v0.8 SHA-256（不変を確認）: %s' % base_sha)
    for k, v in report.items():
        print('  %-18s %d 箇所' % (k, v))
    print('  合計挿入操作 %d' % s.ops)
    print('  追加numId %s' % [n for n, _ in nums.created])


if __name__ == '__main__':
    main()
