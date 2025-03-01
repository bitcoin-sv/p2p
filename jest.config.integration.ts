import type { JestConfigWithTsJest } from 'ts-jest'

const config: JestConfigWithTsJest = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.ts?$': ['ts-jest', { isolatedModules: true }]
  },
  moduleNameMapper: {
    // Ensure Jest resolves TypeScript files without ".js" errors
    '^(.*)\\.js$': '$1'
  },
  testMatch: ['**/src/integration/**/*.test.ts'], // Only run integration tests
  verbose: true,
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  },
  testTimeout: 30000
}

export default config
