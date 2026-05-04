export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: './babel.config.jest.js' }],
  },
  injectGlobals: true,
  globals: {
    'import.meta': {
      env: { DEV: false, VITE_NODE_ENV: 'test' },
    },
  },
};