module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0f62fe',
          50: '#eaf3ff',
          100: '#d6e9ff',
          200: '#add6ff',
          300: '#84c2ff',
          400: '#4fa9ff',
          500: '#0f62fe'
        },
        accent: {
          DEFAULT: '#00b894'
        },
        neutral: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280'
        }
      },
      spacing: {
        '18': '4.5rem'
      },
      borderRadius: {
        lg: '0.75rem'
      }
    }
  },
  plugins: []
}
