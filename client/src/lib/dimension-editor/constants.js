export const TYPE_ICON  = { N: '○', C: '◆', S: '"' }
export const TYPE_COLOR = { N: 'text-blue-400', C: 'text-orange-400', S: 'text-green-400' }
export const TYPE_LABEL = { N: 'Numeric', C: 'Consolidated', S: 'String' }

export const COLOUR_HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export const TM1_FORMAT_PRESETS = [
  { group: 'Number',     items: [
    { fmt: '#,##0',       label: '1,000' },
    { fmt: '#,##0.0',     label: '1,000.0' },
    { fmt: '#,##0.00',    label: '1,000.00' },
    { fmt: '#,##0.000',   label: '1,000.000' },
    { fmt: '0',           label: '1000' },
    { fmt: '0.00',        label: '1000.00' },
  ]},
  { group: 'Currency',   items: [
    { fmt: '$#,##0',      label: '$1,000' },
    { fmt: '$#,##0.00',   label: '$1,000.00' },
    { fmt: '£#,##0.00',   label: '£1,000.00' },
    { fmt: '€#,##0.00',   label: '€1,000.00' },
  ]},
  { group: 'Percentage', items: [
    { fmt: '0%',          label: '10%' },
    { fmt: '0.0%',        label: '10.0%' },
    { fmt: '0.00%',       label: '10.00%' },
  ]},
  { group: 'Accounting', items: [
    { fmt: '#,##0;(#,##0)',       label: '1,000 / (1,000)' },
    { fmt: '#,##0.00;(#,##0.00)', label: '1,000.00 / (1,000.00)' },
    { fmt: '#,##0;[Red]-#,##0',   label: '1,000 / red −1,000' },
  ]},
  { group: 'Other',      items: [
    { fmt: 'General',     label: 'General' },
    { fmt: '@',           label: 'Text' },
  ]},
]
