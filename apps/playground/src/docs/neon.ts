import type { ThemeRegistration } from 'shiki/core'

/** A dark code theme in neon: pink keywords, mint strings, yellow calls, cyan types, all bright enough to read on near black. */
export const neon: ThemeRegistration = {
  name: 'neon',
  type: 'dark',
  colors: {
    'editor.background': '#0b0a10',
    'editor.foreground': '#ebe9f5',
  },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: '#76718f', fontStyle: 'italic' },
    },
    {
      scope: [
        'keyword',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'keyword.operator.new',
        'keyword.operator.expression',
        'variable.language.this',
        'punctuation.definition.template-expression',
      ],
      settings: { foreground: '#ff5fc8' },
    },
    {
      scope: ['keyword.operator', 'punctuation', 'meta.brace', 'storage.type.function.arrow'],
      settings: { foreground: '#9c97bd' },
    },
    {
      scope: ['string', 'punctuation.definition.string', 'string.unquoted.argument.shell'],
      settings: { foreground: '#6ff5d2' },
    },
    {
      scope: [
        'constant.numeric',
        'constant.language',
        'constant.character',
        'entity.other.attribute-name',
      ],
      settings: { foreground: '#c8a6ff' },
    },
    {
      scope: ['entity.name.function', 'support.function', 'entity.name.command'],
      settings: { foreground: '#ffe57a' },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'support.type',
        'support.class',
        'entity.other.inherited-class',
        'support.class.component',
      ],
      settings: { foreground: '#5ee4ff' },
    },
    {
      scope: ['entity.name.tag', 'punctuation.definition.tag'],
      settings: { foreground: '#ff8bd8' },
    },
    {
      scope: [
        'meta.object-literal.key',
        'variable.other.property',
        'variable.other.object.property',
        'support.variable.property',
      ],
      settings: { foreground: '#d3d0ec' },
    },
  ],
}
