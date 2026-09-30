/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        system: {
          bg: '#f1f1f1',
          text: '#333333',
          primary: '#f5b55f',
          active: '#005dbd',
        },
        orange: {
          50: '#fffbf5',
          100: '#fef3e2',
          200: '#fde5c4',
          300: '#fcd39f',
          400: '#fac175',
          500: '#f5b55f',
          600: '#df9940',
          700: '#b87528',
          800: '#92571b',
          900: '#734114',
          950: '#422106',
        }
      },
    },
  },
  plugins: [],
};
