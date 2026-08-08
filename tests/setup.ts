import '@testing-library/jest-dom/vitest'

// jsdomはscrollIntoViewを実装していないため、React統合テスト用にno-opを補う
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
