#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
統合docxツールの§参照分類（内部参照 / 外部文書参照）の回帰テスト。

`build_spec_docx.py` と `verify_spec_docx.py` は、リポジトリ内の別文書
（完了報告・判断記録・実装指示書）への§参照を「本書の節ではないもの」として扱う。
判定の単一定義源は `build_spec_docx.EXTERNAL_DOC_REF_PREFIXES` /
`is_external_doc_ref()` であり、ビルダー（章番号への読み替えから除外）と
verify（内部参照の集計・健全性検査から除外）の双方がこれを使う。

このファイルは、その分類が壊れていないことを機械的に固定する。

実行:
  python tools/test_spec_docx_refs.py
"""

import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_spec_docx import (                                     # noqa: E402
    EXC_V09, EXC_V10, EXC_V11, EXC_V12, EXC_V13, EXC_V14, RefResolver,
    EXTERNAL_DOC_REF_PREFIXES, _prot, assert_external_refs_protected, is_external_doc_ref,
)
from verify_spec_docx import (                                    # noqa: E402
    collect_valid_sections, unresolved_section_refs,
)

FAILS = []


def check(cond, msg):
    if cond:
        print('  [OK]   %s' % msg)
    else:
        print('  [FAIL] %s' % msg)
        FAILS.append(msg)


def classify(text):
    """verifyと同じ手順で§参照を内部 / 外部へ振り分ける。"""
    internal, external = [], []
    for m in re.finditer(r'§(\d+(?:\.\d+)*)', text):
        ctx = text[max(0, m.start() - 40):m.start()]
        (external if is_external_doc_ref(ctx) else internal).append(m.group(1))
    return internal, external


def test_internal_refs_are_checked():
    """1. 内部の§17・§9.1は検証対象（内部参照）になる。"""
    print('\n=== 1. 内部参照は検証対象になる ===')
    cases = [
        ('本書§17の規定に従う。', '17'),
        ('（§9.1の発行表）を参照する。', '9.1'),
        ('詳細は§28.8.6を参照。', '28.8.6'),
    ]
    for text, expected in cases:
        internal, external = classify(text)
        check(internal == [expected] and external == [],
              '内部参照として扱う: %r → 内部=%s / 外部=%s' % (text, internal, external))


def test_external_refs_are_excluded():
    """2. 外部文書への§参照は除外される。"""
    print('\n=== 2. 外部文書参照は除外される ===')
    cases = [
        'Phase 8完了報告§17の持越し事項3番の解消。',
        'Phase 8完了報告§17の持越し事項の解消記録を追記する',
        '（Phase 5実装指示書§9.1）を本書§3.2で拡張する',
        'Phase 5実装指示書§9.1の発行表は',
        '既存のbranch root抑止規則（Phase 5指示§9.1）どおり',
        '`docs/phase-8-completion-report.md` §17の持越し事項3番へ',
        '`docs/phase-8-decisions.md` §9.1のA案の実施',
        '`docs/phase-6-decisions.md` §7.3の既存判断の踏襲',
        '`docs/phase-5-decisions.md` §14.3の判断',
        '（Phase 5 §14.4は「入力要素の収集完了に独立snapshotを設けない」判断であり',
    ]
    for text in cases:
        internal, external = classify(text)
        # 「本書§3.2」を含むケースは内部参照が1件残るのが正しい
        expected_internal = ['3.2'] if '本書§3.2' in text else []
        check(len(external) == 1 and internal == expected_internal,
              '外部参照として除外: %r → 内部=%s / 外部=%s' % (text[:34], internal, external))


def test_same_section_number_is_not_counted_internally():
    """3. 外部文書の§番号と同じ番号の内部節があっても、外部参照は内部件数へ入らない。"""
    print('\n=== 3. 同一番号の内部節があっても外部参照は加算されない ===')
    text = ('本書§17は既知の問題を述べる。'
            'これはPhase 8完了報告§17の持越し事項3番に対応する。'
            '`docs/phase-8-completion-report.md` §17も参照。')
    internal, external = classify(text)
    check(internal == ['17'], '内部§17は1件だけ数える（実際: %s）' % internal)
    check(external == ['17', '17'], '外部§17は2件とも除外される（実際: %s）' % external)


def test_missing_internal_ref_still_fails():
    """4. 存在しない内部参照はverifyの実在照合で未解決として検出される。

    分類だけでなく、**verifyが使う実在照合関数そのもの**（unresolved_section_refs）で
    確認する。分類の戻り値だけを見ていると、実在照合が壊れても合格してしまう。
    """
    print('\n=== 4. 存在しない内部参照はverifyの実在照合で失敗する ===')
    # verify本体の関数を使う（verifyの合否判定と同じ経路）
    texts = [
        ('p', '12. 状態モデル', 'Heading1', None),
        ('p', '12.3 Snapshot構造', 'Heading2', None),
        ('p', '31. v0.14差分：unmodifiable系Collector', 'Heading1', None),
    ]
    valid = collect_valid_sections(texts)
    check(valid == {'12', '12.3', '31'}, '見出しから実在節を収集できる（実際: %s）' % sorted(valid))

    ok_text = '本書§12.3と§31を参照する。'
    check(unresolved_section_refs(ok_text, valid) == [],
          '実在する内部参照は未解決にならない')

    bad_text = '本書§99.9を参照する。'
    unresolved = unresolved_section_refs(bad_text, valid)
    check(unresolved == ['99.9'],
          '実在しない内部参照§99.9が未解決として検出される（実際: %s）' % unresolved)
    # verifyはこの結果で check(not bad, ...) を失敗させる（＝非0終了になる）
    check(bool(unresolved), 'verifyの合否判定（check(not bad, …)）が失敗側になる')

    # 外部文書名を伴わない限り、似た文脈でも除外されない（除外で誤って隠さない）
    hidden = unresolved_section_refs('Phase 11実装§99.9を参照する。', valid)
    check(hidden == ['99.9'],
          '外部prefixに一致しない文脈は除外されず未解決として残る（実際: %s）' % hidden)
    # 外部文書参照は実在照合の対象外（未解決にならない）
    external_only = unresolved_section_refs('Phase 8完了報告§99.9を参照する。', valid)
    check(external_only == [],
          '外部文書への§参照は実在照合の対象外（実際: %s）' % external_only)


def test_prefixes_are_used():
    """外部prefixがすべて実際の入力で使われている（形骸化していない）。"""
    print('\n=== 5. 外部prefix定義の健全性 ===')
    docs = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
    corpus = ''
    for name in sorted(os.listdir(docs)):
        if name.startswith('Java_Stream_API_Visualization_Spec_v0.') and name.endswith('.md'):
            corpus += io.open(os.path.join(docs, name), encoding='utf-8').read() + '\n'
    unused = []
    for prefix in EXTERNAL_DOC_REF_PREFIXES:
        if not re.search(re.escape(prefix.replace('`', '')) + r'\s*§', corpus.replace('`', '')):
            unused.append(prefix)
    check(not unused, '全prefixが差分md中で実際に使われている（未使用: %s）' % (unused or 'なし'))


def test_protection_is_position_based():
    """保護判定が**参照位置**で行われる（同じ節番号の未保護参照を見逃さない）。

    「同じ節番号を含む例外文脈が文書のどこかにある」で判定すると、別位置の未保護参照を
    保護済みと誤判定し、`§<章>.9.1`へ誤変換されたまま合格してしまう。
    """
    print('\n=== 6. 保護判定は参照位置で行う ===')
    md = ('Phase 5実装指示書§9.1の発行表\n'
          'Phase 5指示§9.1の未登録参照')
    protected_only = [('Phase 5実装指示書§9.1の発行表',
                       'Phase 5実装指示書' + _prot('§9.1') + 'の発行表')]

    # 1. 保護済みと未保護が同じ§9.1で併存する場合、後者の位置を示して失敗する
    try:
        assert_external_refs_protected(md, 31, protected_only)
        check(False, '同番号の未保護参照を検出する（前者のみEXC登録）')
    except AssertionError as e:
        msg = str(e)
        check('§9.1' in msg and '位置' in msg,
              '同番号の未保護参照を位置つきで検出する（%s）' % msg[msg.find('§9.1'):][:36])

    # 2. 両方をEXCへ登録した場合だけ通過する
    both = protected_only + [('Phase 5指示§9.1の未登録参照',
                              'Phase 5指示' + _prot('§9.1') + 'の未登録参照')]
    try:
        assert_external_refs_protected(md, 31, both)
        check(True, '両方をEXCへ登録すれば通過する')
    except AssertionError as e:
        check(False, '両方をEXCへ登録すれば通過する（実際: %s）' % e)

    # 3. 未保護のままだと実際に §31.9.1 へ誤変換される（検出しなければ見逃す状態）
    resolved_bad = RefResolver(31, protected_only)(md)
    check('§31.9.1' in resolved_bad,
          '未保護参照は実際に§31.9.1へ誤変換される（検出が必要な理由）')
    # 4. 両方保護すれば誤変換されない
    resolved_ok = RefResolver(31, both)(md)
    check('§31.9.1' not in resolved_ok and resolved_ok.count('§9.1') == 2,
          '両方保護すれば§9.1のまま維持される')


def test_builder_protection_assertion():
    """ビルダー側の保護漏れ検出（assert_external_refs_protected）が機能する。"""
    print('\n=== 7. ビルダーの保護漏れ検出 ===')
    # 保護されていない外部参照（§9.1は§11〜§25の素通し範囲外）→ 失敗する
    unprotected = 'Phase 5実装指示書§9.1の発行表を拡張する。'
    try:
        assert_external_refs_protected(unprotected, 31, [])
        check(False, '保護漏れがAssertionErrorになる')
    except AssertionError as e:
        check('保護されていません' in str(e), '保護漏れがAssertionErrorになる（%s）' % str(e)[:40])
    # EXC で保護されていれば通る
    exc = [('Phase 5実装指示書§9.1の発行表', 'protected')]
    try:
        assert_external_refs_protected(unprotected, 31, exc)
        check(True, 'EXCで保護済みなら通過する')
    except AssertionError as e:
        check(False, 'EXCで保護済みなら通過する（実際: %s）' % e)
    # §11〜§25はRefResolverが素通しするため保護不要
    try:
        assert_external_refs_protected('Phase 8完了報告§17の持越し事項。', 31, [])
        check(True, '§11〜§25の外部参照は素通し範囲として許容される')
    except AssertionError as e:
        check(False, '§11〜§25の外部参照は素通し範囲として許容される（実際: %s）' % e)


def test_actual_specs_pass_protection():
    """実際の差分md全件がビルダーの保護漏れ検出を通る。"""
    print('\n=== 8. 実際の差分mdが保護漏れ検出を通る ===')
    docs = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs')
    targets = [
        ('Java_Stream_API_Visualization_Spec_v0.9_Gatherers.md', 26, EXC_V09),
        ('Java_Stream_API_Visualization_Spec_v0.10_Phase6_ManualLink.md', 27, EXC_V10),
        ('Java_Stream_API_Visualization_Spec_v0.11_toMap.md', 28, EXC_V11),
        ('Java_Stream_API_Visualization_Spec_v0.12_TeeingToMap.md', 29, EXC_V12),
        ('Java_Stream_API_Visualization_Spec_v0.13_NumericMerge.md', 30, EXC_V13),
        ('Java_Stream_API_Visualization_Spec_v0.14_Unmodifiable.md', 31, EXC_V14),
    ]
    for name, chapter, exc in targets:
        path = os.path.join(docs, name)
        if not os.path.exists(path):
            check(False, '%s が見つからない' % name)
            continue
        md = io.open(path, encoding='utf-8').read()
        try:
            assert_external_refs_protected(md, chapter, exc)
            check(True, '第%d章（%s）の外部参照はすべて保護済み' % (chapter, name.split('_Spec_')[1][:12]))
        except AssertionError as e:
            check(False, '第%d章: %s' % (chapter, e))


def main():
    print('統合docxツール: §参照分類の回帰テスト')
    test_internal_refs_are_checked()
    test_external_refs_are_excluded()
    test_same_section_number_is_not_counted_internally()
    test_missing_internal_ref_still_fails()
    test_prefixes_are_used()
    test_protection_is_position_based()
    test_builder_protection_assertion()
    test_actual_specs_pass_protection()
    print('\n===== 結果: %s（失敗 %d 件）====='
          % ('合格' if not FAILS else '不合格', len(FAILS)))
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
