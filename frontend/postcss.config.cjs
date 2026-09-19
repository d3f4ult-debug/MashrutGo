module.exports = (() => {
  const plugins = {}
  try {
    // Prefer the new PostCSS plugin package for Tailwind
    // eslint-disable-next-line global-require
    require.resolve('@tailwindcss/postcss')
    plugins['@tailwindcss/postcss'] = {}
  } catch (e) {
    try {
      // Fallback to legacy `tailwindcss` plugin if the new package isn't present
      require.resolve('tailwindcss')
      plugins.tailwindcss = {}
    } catch (err) {
      // tailwind not installed — tests can run without it
    }
  }
  try {
    require.resolve('autoprefixer')
    plugins.autoprefixer = {}
  } catch (e) {
    // autoprefixer not installed
  }
  return { plugins }
})()
