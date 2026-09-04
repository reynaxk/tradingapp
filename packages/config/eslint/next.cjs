/** ESLint preset for the Next.js web app. */
module.exports = {
  extends: ['./base.cjs', 'next/core-web-vitals'],
  rules: {
    // Server Components and route handlers legitimately log; keep the base rule
    // but let the web app's own config narrow it further if needed.
  },
};
