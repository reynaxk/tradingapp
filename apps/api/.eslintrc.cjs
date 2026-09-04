module.exports = {
  root: true,
  extends: [require.resolve('@fomo/config/eslint/nestjs.cjs')],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: './tsconfig.json',
  },
};
