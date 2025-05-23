// jest.config.ts
import type { JestConfigWithTsJest } from 'ts-jest'

const config: JestConfigWithTsJest = {
  // Use the preset specifically designed for ESM
  preset: 'ts-jest/presets/default-esm',

  // Use the Node environment for testing
  testEnvironment: 'node',

  // Ignore compiled output
  testPathIgnorePatterns: [
    'dist/',
    '/node_modules/',
    './src/__tests/integration/'
  ],

  // These globals configure ts-jest to output ESM
  globals: {
    'ts-jest': {
      useESM: true
    }
  },

  // Tell Jest that files ending in .ts should be treated as ESM modules
  extensionsToTreatAsEsm: ['.ts'],

  // Optionally, if you have imports with a .js extension in your source (or tests)
  // but your source files are actually TypeScript, this mapper will remove the extension.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
}

export default config
