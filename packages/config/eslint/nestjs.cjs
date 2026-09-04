/** ESLint preset for the NestJS API and worker apps. */
module.exports = {
  extends: ['./base.cjs'],
  parserOptions: {
    sourceType: 'module',
  },
  rules: {
    // Decorators produce classes with no public members in some cases (empty modules).
    '@typescript-eslint/no-extraneous-class': 'off',
  },
};
