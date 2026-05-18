import eslint from '@eslint/js';
import n from 'eslint-plugin-n';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const ignores = ['eslint.config.js', 'tsdown.config.ts', 'dist/**'];

const sharedRules = {
	'no-console': 'off',
	curly: ['error', 'all'],
	eqeqeq: ['error', 'always'],
	'no-eval': 'error',
	'no-implied-eval': 'error',
	'no-throw-literal': 'error',
	'no-unused-expressions': 'error',
	'guard-for-in': 'warn',
	'no-var': 'error',
	'prefer-const': 'error',
	'prefer-template': 'error',
	'prefer-rest-params': 'error',
	'prefer-spread': 'error',
	'object-shorthand': ['error', 'always'],
	'unicorn/prevent-abbreviations': 'off',
	'unicorn/no-null': 'off',
	'unicorn/no-array-reduce': 'off',
	'unicorn/filename-case': 'off',
	'unicorn/no-process-exit': 'off',
	'unicorn/no-await-expression-member': 'off',
};

export default tseslint.config(
	eslint.configs.recommended,
	n.configs['flat/recommended-module'],
	unicorn.configs['flat/recommended'],
	{ ignores },
	{
		files: ['**/*.ts'],
		extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
		languageOptions: {
			ecmaVersion: 2025,
			sourceType: 'module',
			globals: {
				...globals.node,
			},
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		settings: {
			n: {
				version: '^22.17.0 || >=24.0.0',
			},
		},
		rules: {
			...sharedRules,
			'no-unused-vars': 'off',
			'no-shadow': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
			'@typescript-eslint/no-shadow': ['warn', { builtinGlobals: false, hoist: 'functions' }],
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { arguments: false } }],
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-import-type-side-effects': 'error',
		},
	},
	{
		files: ['**/*.js'],
		languageOptions: {
			ecmaVersion: 2025,
			sourceType: 'module',
			globals: {
				...globals.node,
			},
		},
		settings: {
			n: {
				version: '^22.17.0 || >=24.0.0',
			},
		},
		rules: {
			...sharedRules,
			'no-unused-vars': ['error', { argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
			'no-shadow': ['warn', { builtinGlobals: false, hoist: 'functions' }],
		},
	},
	prettier,
);
