module.exports = {
  root: true,
  extends: [require.resolve('@fomo/config/eslint/base.cjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
};
