const c = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  darkMode: 'class',
  content: ['./src/index.html', './src/app.js'],
  theme: {
    extend: {
      colors: {
        desk: c('desk'),         // mặt bàn: nền phía sau các tờ giấy
        panel: c('panel'),       // thanh bên, hộp thoại
        sunken: c('sunken'),     // ô nhập, vùng lõm
        line: c('line'),
        ink: c('ink'),
        muted: c('muted'),
        accent: c('accent'),
        'accent-ink': c('accent-ink'),
        paper: c('paper')
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', '"Segoe UI"', 'system-ui', 'sans-serif']
      },
      borderRadius: { sheet: '3px' },
      boxShadow: {
        sheet: 'var(--shadow-sheet)',
        lift: 'var(--shadow-lift)',
        pop: 'var(--shadow-pop)'
      }
    }
  },
  plugins: []
};
